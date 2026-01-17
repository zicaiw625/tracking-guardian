import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { getPlatformService } from "./platforms/factory";
import type { ConversionJob } from "@prisma/client";
import { getPendingJobs, updateJobStatus, claimJobsForProcessing } from "./db/conversion-repository.server";
import { JobStatus } from "../types";

export interface ProcessConversionJobsResult {
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ jobId: string; error: string }>;
}

const BATCH_SIZE = 10;
const MAX_RETRIES = 5;

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
  let succeeded = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await processSingleJob(job);
      await updateJobStatus(job.id, {
        status: JobStatus.COMPLETED,
        completedAt: new Date(),
      });
      succeeded++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const attempts = job.attempts + 1;
      const shouldRetry = attempts < job.maxAttempts;
      await updateJobStatus(job.id, {
        status: shouldRetry ? JobStatus.QUEUED : JobStatus.FAILED,
        attempts,
        lastAttemptAt: new Date(),
        errorMessage,
      });
      failed++;
      errors.push({ jobId: job.id, error: errorMessage });
    }
  }
  return {
    processed: jobs.length,
    succeeded,
    failed,
    errors,
  };
}

async function processSingleJob(job: { id: string; shopId: string; orderId: string; orderNumber: string | null; orderValue: any; currency: string; capiInput: any; shop: { id: string; shopDomain: string; plan: string | null; consentStrategy: string; pixelConfigs: Array<{ platform: string; serverSideEnabled: boolean; credentialsEncrypted: string | null; credentials_legacy: any }> } }): Promise<void> {
  const { decryptCredentials } = await import("./credentials.server");
  const { sendConversionToPlatform } = await import("./platforms");
  const { generateEventId } = await import("./capi-dedup.server");
  
  if (!job.capiInput || typeof job.capiInput !== "object") {
    throw new Error(`Job ${job.id} missing capiInput`);
  }
  
  const capiInput = job.capiInput as {
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
  };
  const conversionData = {
    orderId: job.orderId,
    orderNumber: job.orderNumber,
    value: capiInput.value ?? Number(job.orderValue),
    currency: capiInput.currency ?? job.currency,
    lineItems: capiInput.lineItems,
  };
  const eventType = typeof capiInput.eventType === "string" ? capiInput.eventType : "purchase";
  const serverSideConfigs = job.shop.pixelConfigs.filter(config => config.serverSideEnabled === true);
  
  if (serverSideConfigs.length === 0) {
    logger.debug(`No server-side configs for job ${job.id}, skipping platform send`);
    return;
  }
  
  const results: Array<{ platform: string; success: boolean; error?: string }> = [];
  
  for (const config of serverSideConfigs) {
    try {
      const credentialsResult = await decryptCredentials({
        credentialsEncrypted: config.credentialsEncrypted,
        credentials_legacy: config.credentials_legacy,
        platform: config.platform,
      });
      
      if (!credentialsResult.ok) {
        logger.warn(`Failed to decrypt credentials for ${config.platform} in job ${job.id}`, {
          error: credentialsResult.error.message,
        });
        results.push({ platform: config.platform, success: false, error: credentialsResult.error.message });
        continue;
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
        results.push({
          platform: config.platform,
          success: false,
          error: sendResult.error?.message || "Unknown error",
        });
      } else {
        results.push({ platform: config.platform, success: true });
      }
    } catch (error) {
      logger.error(`Error processing ${config.platform} for job ${job.id}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      results.push({
        platform: config.platform,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  
  const allFailed = results.length > 0 && results.every(r => !r.success);
  if (allFailed) {
    throw new Error(`All platform sends failed for job ${job.id}: ${results.map(r => `${r.platform}: ${r.error}`).join("; ")}`);
  }
}

export function getBatchBackoffDelay(batchNumber: number): number {
  return Math.min(1000 * Math.pow(2, batchNumber), 30000);
}
