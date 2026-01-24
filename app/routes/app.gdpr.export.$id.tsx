import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { addSecurityHeaders } from "../utils/security-headers";

function pickObject(obj: unknown, allow: string[]): Record<string, unknown> | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of allow) {
    if (k in o) out[k] = o[k];
  }
  return out;
}

function sanitizePayload(payload: unknown): Record<string, unknown> | null {
  return pickObject(payload, [
    "topic",
    "shopDomain",
    "webhookId",
    "requestId",
    "jobType",
    "ordersRequestedCount",
    "ordersToRedactCount",
  ]);
}

function sanitizeResult(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const deletedCounts = pickObject(r.deletedCounts, [
    "conversionLogs",
    "conversionJobs",
    "pixelEventReceipts",
    "surveyResponses",
    "sessions",
    "webhookLogs",
    "gdprJobs",
    "verificationRuns",
    "scanReports",
    "auditAssets",
    "pixelConfigs",
    "shop",
  ]);
  const dataLocated = pickObject(r.dataLocated, ["conversionLogs", "surveyResponses", "pixelEventReceipts"]);
  const summarizeLocated = (v: unknown) => pickObject(v, ["count"]);
  return {
    ordersIncludedCount: typeof r.ordersIncludedCount === "number" ? r.ordersIncludedCount : undefined,
    ordersRedactedCount: typeof r.ordersRedactedCount === "number" ? r.ordersRedactedCount : undefined,
    dataLocated: dataLocated
      ? {
          conversionLogs: summarizeLocated((dataLocated as Record<string, unknown>).conversionLogs),
          surveyResponses: summarizeLocated((dataLocated as Record<string, unknown>).surveyResponses),
          pixelEventReceipts: summarizeLocated((dataLocated as Record<string, unknown>).pixelEventReceipts),
        }
      : undefined,
    deletedCounts: deletedCounts || undefined,
    exportedAt: typeof r.exportedAt === "string" ? r.exportedAt : undefined,
    exportFormat: typeof r.exportFormat === "string" ? r.exportFormat : undefined,
    exportVersion: typeof r.exportVersion === "string" ? r.exportVersion : undefined,
  };
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const id = params.id;
  if (!id) {
    return addSecurityHeaders(new Response("Not found", { status: 404 }));
  }
  const job = await prisma.gDPRJob.findUnique({
    where: { id },
    select: {
      id: true,
      shopDomain: true,
      jobType: true,
      status: true,
      payload: true,
      result: true,
      errorMessage: true,
      createdAt: true,
      processedAt: true,
      completedAt: true,
    },
  });
  if (!job || job.shopDomain !== shopDomain) {
    return addSecurityHeaders(new Response("Not found", { status: 404 }));
  }
  const safeJob = {
    id: job.id,
    shopDomain: job.shopDomain,
    jobType: job.jobType,
    status: job.status,
    payload: sanitizePayload(job.payload),
    result: sanitizeResult(job.result),
    errorMessage: job.errorMessage,
    createdAt: job.createdAt?.toISOString?.() ?? job.createdAt,
    processedAt: job.processedAt?.toISOString?.() ?? job.processedAt ?? null,
    completedAt: job.completedAt?.toISOString?.() ?? job.completedAt ?? null,
  };
  const body = JSON.stringify(safeJob);
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set(
    "Content-Disposition",
    `attachment; filename="gdpr_${job.jobType}_${job.id}.json"`
  );
  return addSecurityHeaders(new Response(body, { status: 200, headers }));
};

