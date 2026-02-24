import { logger } from "../../utils/logger.server";
import prisma from "../../db.server";
import { GDPRJobStatus } from "../../types/enums";
import { processDataRequest } from "./handlers/data-request";
import { processCustomerRedact } from "./handlers/customer-redact";
import { processShopRedact } from "./handlers/shop-redact";
import {
  parseCustomerRedactPayload,
  parseDataRequestPayload,
  parseShopRedactPayload,
} from "./types";
import type { ProcessGDPRJobsResult, GDPRJobResult } from "./types";

function summarizeGdprResult(jobType: string, result: GDPRJobResult | unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== "object") return undefined;
  const r = result as Record<string, unknown>;
  if (jobType === "data_request") {
    const dataLocated = (r.dataLocated && typeof r.dataLocated === "object") ? (r.dataLocated as Record<string, unknown>) : undefined;
    const summarizeLocated = (v: unknown) => {
      if (!v || typeof v !== "object") return { count: 0 };
      const o = v as Record<string, unknown>;
      const count = typeof o.count === "number" ? o.count : 0;
      return { count };
    };
    return {
      ordersIncludedCount: Array.isArray(r.ordersIncluded) ? r.ordersIncluded.length : 0,
      dataLocated: dataLocated
        ? {
            conversionLogs: summarizeLocated(dataLocated.conversionLogs),
            pixelEventReceipts: summarizeLocated(dataLocated.pixelEventReceipts),
          }
        : undefined,
      exportedAt: typeof r.exportedAt === "string" ? r.exportedAt : undefined,
      exportFormat: r.exportFormat === "json" ? "json" : undefined,
      exportVersion: typeof r.exportVersion === "string" ? r.exportVersion : undefined,
    };
  }
  if (jobType === "customer_redact") {
    const deletedCounts = (r.deletedCounts && typeof r.deletedCounts === "object") ? (r.deletedCounts as Record<string, unknown>) : undefined;
    return {
      ordersRedactedCount: Array.isArray(r.ordersRedacted) ? r.ordersRedacted.length : 0,
      deletedCounts,
    };
  }
  if (jobType === "shop_redact") {
    const deletedCounts = (r.deletedCounts && typeof r.deletedCounts === "object") ? (r.deletedCounts as Record<string, unknown>) : undefined;
    return {
      deletedCounts,
    };
  }
  return undefined;
}

export async function processGDPRJobs(): Promise<ProcessGDPRJobsResult> {
  const jobs = await prisma.gDPRJob.findMany({
    where: {
      status: { in: ["queued", "pending", "PENDING", "QUEUED"] },
    },
    take: 5,
    orderBy: { createdAt: "asc" },
  });

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const job of jobs) {
    processed++;
    const { id, shopDomain, jobType, payload } = job;
    
    try {
      await prisma.gDPRJob.update({
        where: { id },
        data: { status: GDPRJobStatus.PROCESSING, processedAt: new Date() },
      });

      let result: any;
      const payloadRecord =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : null;
      const actualPayload =
        payloadRecord?.parsedPayload &&
        typeof payloadRecord.parsedPayload === "object" &&
        !Array.isArray(payloadRecord.parsedPayload)
          ? payloadRecord.parsedPayload
          : payloadRecord;

      if (!actualPayload) {
        throw new Error("Missing parsed payload in job data");
      }

      if (jobType === "data_request") {
        result = await processDataRequest(
          shopDomain,
          parseDataRequestPayload(actualPayload)
        );
      } else if (jobType === "customer_redact") {
        result = await processCustomerRedact(
          shopDomain,
          parseCustomerRedactPayload(actualPayload)
        );
      } else if (jobType === "shop_redact") {
        result = await processShopRedact(
          shopDomain,
          parseShopRedactPayload(actualPayload)
        );
      } else {
        throw new Error(`Unknown job type: ${jobType}`);
      }

      await prisma.gDPRJob.update({
        where: { id },
        data: {
          status: GDPRJobStatus.COMPLETED,
          completedAt: new Date(),
          result: summarizeGdprResult(jobType, result) as any,
        },
      });
      succeeded++;
    } catch (error) {
      failed++;
      logger.error(`Failed to process GDPR job ${id}`, { error: String(error) });
      await prisma.gDPRJob.update({
        where: { id },
        data: {
          status: GDPRJobStatus.FAILED,
          errorMessage: error instanceof Error ? error.message : String(error),
          completedAt: new Date(),
        },
      });
    }
  }

  return { processed, succeeded, failed };
}

export async function getGDPRJobStatus(shopDomain?: string): Promise<{
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  recentJobs: Array<{
    id: string;
    shopDomain: string;
    jobType: string;
    status: string;
    createdAt: Date;
    completedAt: Date | null;
  }>;
}> {
  const where = shopDomain ? { shopDomain } : {};
  const [queued, processing, completed, failed, recentJobs] = await Promise.all([
    prisma.gDPRJob.count({ where: { ...where, status: "queued" } }),
    prisma.gDPRJob.count({ where: { ...where, status: "processing" } }),
    prisma.gDPRJob.count({ where: { ...where, status: "completed" } }),
    prisma.gDPRJob.count({ where: { ...where, status: "failed" } }),
    prisma.gDPRJob.findMany({
      where,
      take: 10,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        shopDomain: true,
        jobType: true,
        status: true,
        createdAt: true,
        completedAt: true,
      },
    }),
  ]);

  return {
    queued,
    processing,
    completed,
    failed,
    recentJobs,
  };
}

export async function processGDPRJob(_jobId: string): Promise<any> {
    // Deprecated, use processGDPRJobs
    return { success: false, error: "Use processGDPRJobs" };
}
