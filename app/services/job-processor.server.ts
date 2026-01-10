import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { getPlatformService } from "./platforms/factory";
import type { ConversionJob } from "@prisma/client";

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
  logger.debug(`processConversionJobs called but conversionJob table no longer exists`, { shopId, limit });
  return {
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  };
}

async function processSingleJob(job: ConversionJob & { Shop: { shopDomain: string; plan: string; consentStrategy: string } }): Promise<void> {
  logger.debug(`processSingleJob called but conversionJob table no longer exists`, { jobId: job.id });
  return;
}

export function getBatchBackoffDelay(batchNumber: number): number {
  return Math.min(1000 * Math.pow(2, batchNumber), 30000);
}
