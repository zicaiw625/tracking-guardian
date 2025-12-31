import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "~/db.server";
import { getShareableReport, recordShareAccess } from "~/services/report-sharing.server";
import {
  fetchScanReportData,
  fetchVerificationReportData,
  fetchReconciliationReportData,
  generateScanReportHtml,
  generateVerificationReportHtml,
  generateReconciliationReportHtml,
} from "~/services/report-generator.server";
import { logger } from "~/utils/logger.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { token } = params;
  if (!token) {
    return new Response("Missing token", { status: 400 });
  }

  try {

    const shareableReport = await getShareableReport(token);
    if (!shareableReport) {
      return new Response("Report not found or expired", { status: 404 });
    }

    await recordShareAccess(token);

    let html: string;
    switch (shareableReport.reportType) {
      case "scan": {
        const data = await fetchScanReportData(shareableReport.shopId, shareableReport.reportId);
        if (!data) {
          return new Response("Scan report data not found", { status: 404 });
        }
        html = generateScanReportHtml(data);
        break;
      }
      case "verification": {
        const data = await fetchVerificationReportData(shareableReport.shopId, shareableReport.reportId);
        if (!data) {
          return new Response("Verification report data not found", { status: 404 });
        }
        html = generateVerificationReportHtml(data);
        break;
      }
      case "reconciliation": {
        const data = await fetchReconciliationReportData(shareableReport.shopId, 7);
        if (!data) {
          return new Response("Reconciliation report data not found", { status: 404 });
        }
        html = generateReconciliationReportHtml(data);
        break;
      }
      case "migration": {

        return new Response("Migration report not yet implemented", { status: 501 });
      }
      default:
        return new Response(`Invalid report type: ${shareableReport.reportType}`, { status: 400 });
    }

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    logger.error("Failed to load shareable report", { error, token });
    return new Response("Failed to load report", { status: 500 });
  }
};

