import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useTranslation } from "react-i18next";
import { resolvePublicScanReportByToken } from "../services/report-share.server";
import { SHARE_PAGE_ROBOTS_TAG } from "../utils/security-headers";

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const token = params.token?.trim();
  if (!token) {
    throw new Response("Invalid share link", { status: 400 });
  }
  const report = await resolvePublicScanReportByToken(token);
  if (!report) {
    throw new Response("Share link expired or revoked", { status: 404 });
  }
  return json(
    { report },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
        "X-Robots-Tag": SHARE_PAGE_ROBOTS_TAG,
      },
    }
  );
};

export default function PublicScanReportPage() {
  const { t } = useTranslation();
  const { report } = useLoaderData<typeof loader>();
  return (
    <main style={{ maxWidth: 960, margin: "40px auto", fontFamily: "Inter, Arial, sans-serif", padding: "0 16px" }}>
      <h1 style={{ marginBottom: 8 }}>{t("scan.public.title")}</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        {t("scan.public.meta", {
          prefix: report.share.tokenPrefix,
          expiresAt: new Date(report.share.expiresAt).toLocaleString(),
        })}
      </p>

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>{t("scan.public.summaryTitle")}</h2>
        <p>{t("scan.public.reportId")} {report.reportId}</p>
        <p>{t("scan.public.status")} {report.status}</p>
        <p>{t("scan.public.riskScore")} {report.riskScore}/100</p>
        <p>{t("scan.public.platforms")} {report.identifiedPlatforms.join(", ") || "-"}</p>
        <p>{t("scan.public.createdAt")} {new Date(report.createdAt).toLocaleString()}</p>
        <p>{t("scan.public.completedAt")} {report.completedAt ? new Date(report.completedAt).toLocaleString() : "-"}</p>
      </section>

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>{t("scan.public.risksTitle")}</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "8px 6px" }}>{t("scan.public.riskHeadings.name")}</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "8px 6px" }}>{t("scan.public.riskHeadings.severity")}</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "8px 6px" }}>{t("scan.public.riskHeadings.platform")}</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "8px 6px" }}>{t("scan.public.riskHeadings.description")}</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "8px 6px" }}>{t("scan.public.riskHeadings.recommendation")}</th>
              </tr>
            </thead>
            <tbody>
              {report.riskItems.map((item, idx) => (
                <tr key={`${item.id}-${idx}`}>
                  <td style={{ borderBottom: "1px solid #f3f4f6", padding: "8px 6px" }}>{item.name}</td>
                  <td style={{ borderBottom: "1px solid #f3f4f6", padding: "8px 6px" }}>{item.severity}</td>
                  <td style={{ borderBottom: "1px solid #f3f4f6", padding: "8px 6px" }}>{item.platform || "-"}</td>
                  <td style={{ borderBottom: "1px solid #f3f4f6", padding: "8px 6px" }}>{item.description || "-"}</td>
                  <td style={{ borderBottom: "1px solid #f3f4f6", padding: "8px 6px" }}>{item.recommendation || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
