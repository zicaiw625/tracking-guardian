import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { getPlatformService } from "./platforms/factory";
import type { ConversionJob } from "@prisma/client";
import { getPendingJobs, updateJobStatus, claimJobsForProcessing, type JobForProcessing } from "./db/conversion-repository.server";
import { JobStatus, type JobStatusType } from "../types";
import type { Prisma } from "@prisma/client";
import { normalizeDecimalValue } from "../utils/common";

export interface ProcessConversionJobsResult {
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ jobId: string; error: string }>;
}

const BATCH_SIZE = 10;
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("timeout") || message.includes("network") || message.includes("connection")) {
      return true;
    }
    if (message.includes("rate limit") || message.includes("429")) {
      return true;
    }
    if (message.includes("500") || message.includes("502") || message.includes("503")) {
      return true;
    }
  }
  return false;
}

export async function processConversionJobs(
  shopId?: string,
  limit: number = BATCH_SIZE
): Promise<ProcessConversionJobsResult> {
  const jobs = await getPendingJobs({ limit });
  if (jobs.length === 0) {
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
    };
  }
  const jobIds = jobs.map(j => j.id);
  await claimJobsForProcessing(jobIds);
  const errors: Array<{ jobId: string; error: string }> = [];
  const completedJobs: Array<{ id: string; completedAt: Date }> = [];
  const failedJobs: Array<{ id: string; status: JobStatusType; attempts: number; errorMessage: string; lastAttemptAt: Date }> = [];
  let succeeded = 0;
  let failed = 0;
  const now = new Date();
  for (const job of jobs) {
    try {
      await processSingleJob(job);
      completedJobs.push({ id: job.id, completedAt: now });
      succeeded++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const attempts = job.attempts + 1;
      const isRetryable = isRetryableError(error) && attempts < job.maxAttempts;
      const status = isRetryable ? JobStatus.QUEUED : JobStatus.FAILED;
      failedJobs.push({
        id: job.id,
        status,
        attempts,
        errorMessage,
        lastAttemptAt: now,
      });
      failed++;
      errors.push({ jobId: job.id, error: errorMessage });
    }
  }
  const updatePromises: Promise<unknown>[] = [];
  if (completedJobs.length > 0) {
    updatePromises.push(
      ...completedJobs.map(job =>
        updateJobStatus(job.id, {
          status: JobStatus.COMPLETED,
          completedAt: job.completedAt,
        })
      )
    );
  }
  if (failedJobs.length > 0) {
    updatePromises.push(
      ...failedJobs.map(job =>
        updateJobStatus(job.id, {
          status: job.status,
          attempts: job.attempts,
          lastAttemptAt: job.lastAttemptAt,
          errorMessage: job.errorMessage,
        })
      )
    );
  }
  if (updatePromises.length > 0) {
    await Promise.all(updatePromises);
  }
  return {
    processed: jobs.length,
    succeeded,
    failed,
    errors,
  };
}

interface JobWithShop extends JobForProcessing {
  shop: {
    id: string;
    shopDomain: string;
    plan: string | null;
    consentStrategy: string;
    pixelConfigs: Array<{
      platform: string;
      serverSideEnabled: boolean;
      credentialsEncrypted: string | null;
      credentials_legacy: Prisma.JsonValue | null;
    }>;
  };
}

interface CapiInput {
  value?: number;
  currency?: string;
  lineItems?: Array<{
    id: string;
    quantity: number;
    price: number;
    productId?: string;
    variantId?: string;
    name?: string;
  }>;
  eventType?: string;
}

function isCapiInput(value: unknown): value is CapiInput {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function extractConversionData(job: JobWithShop, capiInput: CapiInput) {
  return {
    orderId: job.orderId,
    orderNumber: job.orderNumber,
    value: capiInput.value ?? normalizeDecimalValue(job.orderValue),
    currency: capiInput.currency ?? job.currency,
    lineItems: capiInput.lineItems,
  };
}

function getEventType(capiInput: CapiInput): string {
  return typeof capiInput.eventType === "string" ? capiInput.eventType : "purchase";
}

interface PlatformSendResult {
  platform: string;
  success: boolean;
  error?: string;
}

async function sendToPlatform(
  config: { platform: string; credentialsEncrypted: string | null; credentials_legacy: Prisma.JsonValue | null },
  job: JobWithShop,
  conversionData: ReturnType<typeof extractConversionData>,
  eventType: string
): Promise<PlatformSendResult> {
  const { decryptCredentials } = await import("./credentials.server");
  const { sendConversionToPlatform } = await import("./platforms");
  const { generateEventId } = await import("./capi-dedup.server");
  
  try {
    const credentialsResult = await decryptCredentials(
      {
        credentialsEncrypted: config.credentialsEncrypted,
        credentials_legacy: config.credentials_legacy,
      },
      config.platform
    );
    
    if (!credentialsResult.ok) {
      logger.warn(`Failed to decrypt credentials for ${config.platform} in job ${job.id}`, {
        error: credentialsResult.error.message,
      });
      return { platform: config.platform, success: false, error: credentialsResult.error.message };
    }
    
    const sendResult = await sendConversionToPlatform(
      config.platform,
      credentialsResult.value.credentials,
      conversionData,
      generateEventId(job.orderId, eventType, job.shop.shopDomain, config.platform)
    );
    
    if (!sendResult.success) {
      logger.warn(`Failed to send conversion to ${config.platform} for job ${job.id}`, {
        error: sendResult.error?.message,
      });
      return {
        platform: config.platform,
        success: false,
        error: sendResult.error?.message || "Unknown error",
      };
    }
    
    return { platform: config.platform, success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error processing ${config.platform} for job ${job.id}`, {
      error: errorMessage,
    });
    return {
      platform: config.platform,
      success: false,
      error: errorMessage,
    };
  }
}

async function processSingleJob(job: JobWithShop): Promise<void> {
  if (!isCapiInput(job.capiInput)) {
    throw new Error(`Job ${job.id} missing capiInput`);
  }
  
  const capiInput = job.capiInput;
  const conversionData = extractConversionData(job, capiInput);
  const eventType = getEventType(capiInput);
  const serverSideConfigs = job.shop.pixelConfigs.filter(config => config.serverSideEnabled === true);
  
  if (serverSideConfigs.length === 0) {
    logger.debug(`No server-side configs for job ${job.id}, skipping platform send`);
    return;
  }
  
  const results = await Promise.allSettled(
    serverSideConfigs.map(config => sendToPlatform(config, job, conversionData, eventType))
  );
  
  const platformResults: PlatformSendResult[] = results.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    const platform = serverSideConfigs[index]?.platform || "unknown";
    const errorMessage = result.reason instanceof Error ? result.reason.message : String(result.reason);
    logger.error(`Unexpected error sending to platform ${platform} for job ${job.id}`, {
      error: errorMessage,
      platform,
      jobId: job.id,
    });
    return { platform, success: false, error: errorMessage };
  });
  
  const allFailed = platformResults.length > 0 && platformResults.every(r => !r.success);
  if (allFailed) {
    const errors = platformResults.map(r => `${r.platform}: ${r.error ?? "Unknown error"}`).join("; ");
    throw new Error(`All platform sends failed for job ${job.id}: ${errors}`);
  }
}

export function getBatchBackoffDelay(batchNumber: number): number {
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, batchNumber), MAX_BACKOFF_MS);
}
