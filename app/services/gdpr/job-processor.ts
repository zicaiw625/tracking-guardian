/**
 * GDPR Job Processor
 *
 * Handles processing of queued GDPR jobs.
 * Manages job lifecycle: queued -> processing -> completed/failed.
 */

import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { processDataRequest, processCustomerRedact, processShopRedact } from "./handlers";
import type {
  DataRequestPayload,
  CustomerRedactPayload,
  ShopRedactPayload,
  DataRequestResult,
  CustomerRedactResult,
  ShopRedactResult,
  ProcessGDPRJobResult,
  ProcessGDPRJobsResult,
  GDPRJobResult,
} from "./types";

// =============================================================================
// Single Job Processing
// =============================================================================

/**
 * Process a single GDPR job by ID.
 *
 * @param jobId - The job ID to process
 * @returns Processing result with success status
 */
export async function processGDPRJob(jobId: string): Promise<ProcessGDPRJobResult> {
  const job = await prisma.gDPRJob.findUnique({
    where: { id: jobId },
  });

  if (!job) {
    return { success: false, error: "Job not found" };
  }

  // Skip already completed jobs
  if (job.status === "completed") {
    logger.debug(`[GDPR] Job ${jobId} already completed, skipping`);
    return {
      success: true,
      result: job.result as unknown as GDPRJobResult,
    };
  }

  // Mark as processing
  await prisma.gDPRJob.update({
    where: { id: jobId },
    data: { status: "processing" },
  });

  try {
    let result: DataRequestResult | CustomerRedactResult | ShopRedactResult;

    // Process based on job type
    switch (job.jobType) {
      case "data_request":
        result = await processDataRequest(job.shopDomain, job.payload as DataRequestPayload);
        break;
      case "customer_redact":
        result = await processCustomerRedact(job.shopDomain, job.payload as CustomerRedactPayload);
        break;
      case "shop_redact":
        result = await processShopRedact(job.shopDomain, job.payload as ShopRedactPayload);
        break;
      default:
        throw new Error(`Unknown GDPR job type: ${job.jobType}`);
    }

    // Mark as completed
    await prisma.gDPRJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        result: result as object,
        payload: {}, // Clear payload after processing for privacy
        processedAt: new Date(),
        completedAt: new Date(),
      },
    });

    logger.info(`[GDPR] Job ${jobId} completed successfully`, {
      jobType: job.jobType,
      shopDomain: job.shopDomain,
    });

    return { success: true, result };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Mark as failed
    await prisma.gDPRJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        errorMessage,
        processedAt: new Date(),
      },
    });

    logger.error(`[GDPR] Job ${jobId} failed: ${errorMessage}`, error);
    return { success: false, error: errorMessage };
  }
}

// =============================================================================
// Batch Job Processing
// =============================================================================

/**
 * Process pending GDPR jobs in batch.
 * Processes up to 10 jobs per run.
 *
 * @returns Batch processing result with counts
 */
export async function processGDPRJobs(): Promise<ProcessGDPRJobsResult> {
  // Find pending jobs
  const pendingJobs = await prisma.gDPRJob.findMany({
    where: {
      status: { in: ["queued", "failed"] },
    },
    orderBy: { createdAt: "asc" },
    take: 10,
  });

  if (pendingJobs.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  logger.info(`[GDPR] Processing ${pendingJobs.length} GDPR jobs`);

  let succeeded = 0;
  let failed = 0;

  for (const job of pendingJobs) {
    const result = await processGDPRJob(job.id);
    if (result.success) {
      succeeded++;
    } else {
      failed++;
    }
  }

  logger.info(`[GDPR] Processed ${pendingJobs.length} jobs: ${succeeded} succeeded, ${failed} failed`);

  return {
    processed: pendingJobs.length,
    succeeded,
    failed,
  };
}

// =============================================================================
// Job Status
// =============================================================================

/**
 * Get GDPR job status summary.
 *
 * @param shopDomain - Optional shop domain filter
 * @returns Status counts and recent jobs
 */
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
      orderBy: { createdAt: "desc" },
      take: 10,
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

