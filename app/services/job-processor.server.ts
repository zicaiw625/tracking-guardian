/**
 * Conversion Job Processor
 *
 * Main entry point for processing conversion jobs.
 * Coordinates receipt matching, trust evaluation, and platform sending.
 *
 * Optimized with:
 * - Batch database operations
 * - Parallel platform sending
 * - Structured result collection
 */

import prisma from "../db.server";
import { checkBillingGate, incrementMonthlyUsage, type PlanId } from "./billing.server";
import { decryptCredentials } from "./credentials.server";
import { sendConversionToPlatform } from "./platforms/factory";
import { generateEventId } from "../utils/crypto.server";
import { logger } from "../utils/logger.server";
import { JOB_PROCESSING_CONFIG } from "../utils/config";
import { JobStatus, parseCapiInput, parsePixelClientConfig } from "../types";
import type { ConversionData, PlatformCredentials } from "../types";

// Import from split modules
import {
  batchFetchReceipts,
  findReceiptForJob,
  updateReceiptTrustLevel,
  type ReceiptFields,
} from "./receipt-matcher.server";
import {
  evaluateTrust,
  checkPlatformEligibility,
  buildConsentEvidence,
  didReceiptMatchByToken,
  type ShopTrustContext,
} from "./trust-evaluator.server";

// =============================================================================
// Types
// =============================================================================

/**
 * Result of processing conversion jobs batch.
 */
export interface ProcessConversionJobsResult {
  processed: number;
  succeeded: number;
  failed: number;
  limitExceeded: number;
  skipped: number;
}

/**
 * Job with shop and pixel configs.
 */
interface JobWithRelations {
  id: string;
  shopId: string;
  orderId: string;
  orderNumber: string | null;
  orderValue: number | { toNumber(): number };
  currency: string;
  capiInput: unknown;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  shop: {
    id: string;
    shopDomain: string;
    plan: string | null;
    piiEnabled: boolean;
    consentStrategy: string | null;
    primaryDomain: string | null;
    storefrontDomains: string[];
    pixelConfigs: Array<{
      id: string;
      platform: string;
      platformId: string | null;
      credentialsEncrypted: string | null;
      credentials: unknown;
      clientConfig: unknown;
    }>;
  };
}

/**
 * Result of processing a single job
 */
type JobProcessResult = "succeeded" | "failed" | "limit_exceeded" | "skipped";

/**
 * Batch update entry
 */
interface JobUpdateEntry {
  id: string;
  status: string;
  data: Record<string, unknown>;
}

// =============================================================================
// Constants (from centralized config)
// =============================================================================

const {
  BASE_DELAY_MS,
  MAX_DELAY_MS,
  BACKOFF_MULTIPLIER,
  BATCH_SIZE: DEFAULT_BATCH_SIZE,
} = JOB_PROCESSING_CONFIG;

// =============================================================================
// P2-2: Batch-Level Backoff Configuration
// =============================================================================

/**
 * P2-2: Batch backoff state for adaptive processing rate
 * 
 * When too many failures occur in a batch, we reduce processing speed
 * to allow external systems (platforms, DB) to recover.
 */
interface BatchBackoffState {
  consecutiveHighFailureBatches: number;
  lastBatchFailureRate: number;
  currentDelayMs: number;
}

const BATCH_BACKOFF_CONFIG = {
  /** Failure rate threshold to trigger backoff (e.g., 0.5 = 50%) */
  FAILURE_RATE_THRESHOLD: 0.5,
  /** Initial delay between batches when backoff is triggered */
  INITIAL_BATCH_DELAY_MS: 1000,
  /** Maximum delay between batches */
  MAX_BATCH_DELAY_MS: 30000,
  /** Multiplier for exponential backoff */
  BACKOFF_MULTIPLIER: 2,
  /** Number of consecutive good batches to reset backoff */
  RESET_THRESHOLD: 3,
} as const;

// Global backoff state (per process)
let batchBackoffState: BatchBackoffState = {
  consecutiveHighFailureBatches: 0,
  lastBatchFailureRate: 0,
  currentDelayMs: 0,
};

/**
 * P2-2: Update batch backoff state based on batch results
 */
function updateBatchBackoff(
  succeeded: number,
  failed: number,
  limitExceeded: number
): void {
  const total = succeeded + failed + limitExceeded;
  if (total === 0) return;

  const failureRate = (failed + limitExceeded) / total;
  batchBackoffState.lastBatchFailureRate = failureRate;

  if (failureRate >= BATCH_BACKOFF_CONFIG.FAILURE_RATE_THRESHOLD) {
    // High failure rate - increase backoff
    batchBackoffState.consecutiveHighFailureBatches++;
    
    if (batchBackoffState.currentDelayMs === 0) {
      batchBackoffState.currentDelayMs = BATCH_BACKOFF_CONFIG.INITIAL_BATCH_DELAY_MS;
    } else {
      batchBackoffState.currentDelayMs = Math.min(
        batchBackoffState.currentDelayMs * BATCH_BACKOFF_CONFIG.BACKOFF_MULTIPLIER,
        BATCH_BACKOFF_CONFIG.MAX_BATCH_DELAY_MS
      );
    }

    logger.warn(
      `[P2-2] High batch failure rate: ${(failureRate * 100).toFixed(1)}%. ` +
      `Consecutive: ${batchBackoffState.consecutiveHighFailureBatches}. ` +
      `Next batch delay: ${batchBackoffState.currentDelayMs}ms`
    );
  } else {
    // Good batch - reduce backoff
    if (batchBackoffState.consecutiveHighFailureBatches > 0) {
      batchBackoffState.consecutiveHighFailureBatches--;
    }
    
    if (batchBackoffState.consecutiveHighFailureBatches === 0) {
      // Reset if we've had enough good batches
      batchBackoffState.currentDelayMs = 0;
    } else {
      // Gradually reduce delay
      batchBackoffState.currentDelayMs = Math.floor(
        batchBackoffState.currentDelayMs / BATCH_BACKOFF_CONFIG.BACKOFF_MULTIPLIER
      );
    }
  }
}

/**
 * P2-2: Get current batch delay (for external callers)
 */
export function getBatchBackoffDelay(): number {
  return batchBackoffState.currentDelayMs;
}

/**
 * P2-2: Apply batch backoff delay if needed
 */
async function applyBatchBackoff(): Promise<void> {
  if (batchBackoffState.currentDelayMs > 0) {
    logger.info(`[P2-2] Applying batch backoff delay: ${batchBackoffState.currentDelayMs}ms`);
    await new Promise(resolve => setTimeout(resolve, batchBackoffState.currentDelayMs));
  }
}

// =============================================================================
// Retry Logic
// =============================================================================

/**
 * Calculate next retry time with exponential backoff and jitter.
 */
export function calculateNextRetryTime(attempts: number): Date {
  const delayMs = Math.min(
    BASE_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, attempts - 1),
    MAX_DELAY_MS
  );
  const jitter = delayMs * 0.1 * Math.random();
  return new Date(Date.now() + delayMs + jitter);
}

// =============================================================================
// Job Claiming
// =============================================================================

/**
 * Claim jobs for processing using SELECT FOR UPDATE SKIP LOCKED.
 * This ensures atomic claim across multiple instances.
 */
async function claimJobsForProcessing(batchSize: number): Promise<string[]> {
  const now = new Date();

  const claimedIds = await prisma.$transaction(
    async (tx) => {
      const availableJobs = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "ConversionJob"
        WHERE (
          status = 'queued'
          OR (
            status = 'failed'
            AND "nextRetryAt" <= ${now}
            AND attempts < "maxAttempts"
          )
        )
        ORDER BY "createdAt" ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `;

      if (availableJobs.length === 0) {
        return [];
      }

      const jobIds = availableJobs.map((j) => j.id);
      await tx.conversionJob.updateMany({
        where: { id: { in: jobIds } },
        data: { status: JobStatus.PROCESSING },
      });

      return jobIds;
    },
    { timeout: 10000 }
  );

  return claimedIds;
}

/**
 * Fetch jobs with relations for processing.
 */
async function fetchJobsWithRelations(
  jobIds: string[]
): Promise<JobWithRelations[]> {
  return prisma.conversionJob.findMany({
    where: { id: { in: jobIds } },
    include: {
      shop: {
        select: {
          id: true,
          shopDomain: true,
          plan: true,
          piiEnabled: true,
          consentStrategy: true,
          primaryDomain: true,
          storefrontDomains: true,
          pixelConfigs: {
            where: { isActive: true, serverSideEnabled: true },
            select: {
              id: true,
              platform: true,
              platformId: true,
              credentialsEncrypted: true,
              credentials: true,
              clientConfig: true,
            },
          },
        },
      },
    },
  });
}

// =============================================================================
// Batch Update Operations
// =============================================================================

/**
 * Batch update multiple jobs efficiently.
 * Groups updates by status for optimal query performance.
 */
async function batchUpdateJobs(updates: JobUpdateEntry[]): Promise<void> {
  if (updates.length === 0) return;

  // For single updates, use direct update
  if (updates.length === 1) {
    const { id, status, data } = updates[0];
    await prisma.conversionJob.update({
      where: { id },
      data: { status, ...data },
    });
    return;
  }

  // For multiple updates, use transaction
  await prisma.$transaction(
    updates.map(({ id, status, data }) =>
      prisma.conversionJob.update({
        where: { id },
        data: { status, ...data },
      })
    )
  );
}

// =============================================================================
// Platform Sending (Parallelized)
// =============================================================================

/**
 * Send to all platforms in parallel.
 * Returns results for each platform.
 */
async function sendToPlatformsParallel(
  pixelConfigs: JobWithRelations["shop"]["pixelConfigs"],
  job: JobWithRelations,
  capiInput: ReturnType<typeof parseCapiInput>,
  eventId: string,
  trustResult: ReturnType<typeof evaluateTrust>["trustResult"],
  consentState: ReturnType<typeof evaluateTrust>["consentState"],
  strategy: string
): Promise<{ platformResults: Record<string, string>; anySucceeded: boolean }> {
  const platformResults: Record<string, string> = {};

  // Build send tasks
  const sendTasks = pixelConfigs.map(async (pixelConfig) => {
    const clientConfig = parsePixelClientConfig(pixelConfig.clientConfig);
    const treatAsMarketing = clientConfig?.treatAsMarketing === true;

    // Check platform eligibility
    const eligibility = checkPlatformEligibility(
      pixelConfig.platform,
      trustResult,
      consentState,
      strategy,
      treatAsMarketing
    );

    if (!eligibility.allowed) {
      return {
        platform: pixelConfig.platform,
        success: false,
        status: `skipped:${eligibility.skipReason}`,
        skipped: true,
      };
    }

    // Send to platform
    const sendResult = await sendToPlatformWithCredentials(
      pixelConfig,
      job,
      capiInput,
      eventId
    );

    return {
      platform: pixelConfig.platform,
      success: sendResult.success,
      status: sendResult.status,
      skipped: false,
    };
  });

  // Execute all sends in parallel
  const results = await Promise.allSettled(sendTasks);

  let anySucceeded = false;
  for (const result of results) {
    if (result.status === "fulfilled") {
      platformResults[result.value.platform] = result.value.status;
      if (result.value.success) {
        anySucceeded = true;
      }
    } else {
      // Promise rejected - should be rare as we catch errors in sendToPlatformWithCredentials
      logger.error("Platform send task rejected:", result.reason);
    }
  }

  return { platformResults, anySucceeded };
}

/**
 * Send to platform with credential decryption.
 */
async function sendToPlatformWithCredentials(
  pixelConfig: JobWithRelations["shop"]["pixelConfigs"][0],
  job: JobWithRelations,
  capiInput: ReturnType<typeof parseCapiInput>,
  eventId: string
): Promise<{ success: boolean; status: string }> {
  try {
    const credResult = decryptCredentials(pixelConfig, pixelConfig.platform);

    if (!credResult.ok) {
      logger.warn(`Failed to decrypt credentials for ${pixelConfig.platform}: ${credResult.error.message}`);
      return { success: false, status: "failed:no_credentials" };
    }
    
    const credentials = credResult.value.credentials;

    // Build conversion data
    const lineItems = capiInput?.items?.map((item) => ({
      productId: item.productId || "",
      variantId: item.variantId || "",
      name: item.name || "",
      quantity: item.quantity || 1,
      price: item.price || 0,
    }));

    const orderValue =
      typeof job.orderValue === "number"
        ? job.orderValue
        : job.orderValue.toNumber();

    const conversionData: ConversionData = {
      orderId: job.orderId,
      orderNumber: job.orderNumber,
      value: orderValue,
      currency: job.currency,
      lineItems,
    };

    // Send to platform using factory
    const result = await sendConversionToPlatform(
      pixelConfig.platform,
      credentials as PlatformCredentials,
      conversionData,
      eventId
    );

    if (result.success) {
      return { success: true, status: "sent" };
    }

    return {
      success: false,
      status: `failed:${result.error?.message?.substring(0, 50) || "unknown"}`,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    return { success: false, status: `failed:${errorMsg.substring(0, 50)}` };
  }
}

// =============================================================================
// Single Job Processing
// =============================================================================

/**
 * Process a single conversion job.
 * Returns result and any necessary updates.
 */
async function processSingleJob(
  job: JobWithRelations,
  receiptMap: Map<string, ReceiptFields>,
  now: Date
): Promise<{ result: JobProcessResult; update: JobUpdateEntry }> {
  // Check billing limit
  const billingCheck = await checkBillingGate(
    job.shopId,
    (job.shop.plan || "free") as PlanId
  );

  if (!billingCheck.allowed) {
    logger.info(`Billing gate blocked job ${job.id}`, {
      reason: billingCheck.reason,
      usage: billingCheck.usage,
    });
    return {
      result: "limit_exceeded",
      update: {
        id: job.id,
        status: JobStatus.LIMIT_EXCEEDED,
        data: {
          errorMessage: `Monthly limit exceeded: ${billingCheck.usage.current}/${billingCheck.usage.limit}`,
          lastAttemptAt: now,
        },
      },
    };
  }

  // Skip if no platforms configured
  if (job.shop.pixelConfigs.length === 0) {
    logger.debug(`Job ${job.id}: No active platforms configured`);
    return {
      result: "skipped",
      update: {
        id: job.id,
        status: JobStatus.COMPLETED,
        data: {
          processedAt: now,
          completedAt: now,
          platformResults: { message: "No platforms configured" },
        },
      },
    };
  }

  const eventId = generateEventId(job.orderId, "purchase", job.shop.shopDomain);
  const capiInputParsed = parseCapiInput(job.capiInput);
  const webhookCheckoutToken = capiInputParsed?.checkoutToken;

  // Find matching receipt
  const receipt = await findReceiptForJob(
    receiptMap,
    job.shopId,
    job.orderId,
    webhookCheckoutToken || undefined,
    job.createdAt
  );

  // Build shop context for trust evaluation
  const shopContext: ShopTrustContext = {
    shopDomain: job.shop.shopDomain,
    primaryDomain: job.shop.primaryDomain,
    storefrontDomains: job.shop.storefrontDomains,
    consentStrategy: job.shop.consentStrategy || "strict",
  };

  // Evaluate trust and consent
  const { trustResult, trustMetadata, consentState } = evaluateTrust(
    receipt,
    webhookCheckoutToken || undefined,
    shopContext
  );

  // Update receipt trust level if matched (fire and forget)
  if (didReceiptMatchByToken(receipt, webhookCheckoutToken || undefined)) {
    updateReceiptTrustLevel(
      job.shopId,
      receipt!.orderId,
      trustResult.level,
      trustResult.reason
    ).catch((err) =>
      logger.warn(`Failed to update receipt trust level: ${err}`)
    );
  }

  const strategy = job.shop.consentStrategy || "strict";

  // Send to all platforms in parallel
  const { platformResults, anySucceeded } = await sendToPlatformsParallel(
    job.shop.pixelConfigs,
    job,
    capiInputParsed,
    eventId,
    trustResult,
    consentState,
    strategy
  );

  // Build consent evidence
  const consentEvidence = buildConsentEvidence(
    strategy,
    !!receipt,
    trustResult,
    consentState
  );

  // Prepare update
  const newAttempts = job.attempts + 1;

  if (anySucceeded) {
    // Increment usage asynchronously
    incrementMonthlyUsage(job.shopId, job.orderId).catch((err) =>
      logger.warn(`Failed to increment monthly usage: ${err}`)
    );

    return {
      result: "succeeded",
      update: {
        id: job.id,
        status: JobStatus.COMPLETED,
        data: {
          attempts: newAttempts,
          lastAttemptAt: now,
          processedAt: now,
          completedAt: now,
          platformResults,
          errorMessage: null,
          trustMetadata: trustMetadata as object,
          consentEvidence: JSON.parse(JSON.stringify(consentEvidence)),
        },
      },
    };
  }

  // Handle failure
  if (newAttempts >= job.maxAttempts) {
    return {
      result: "failed",
      update: {
        id: job.id,
        status: JobStatus.DEAD_LETTER,
        data: {
          attempts: newAttempts,
          lastAttemptAt: now,
          platformResults,
          errorMessage: "All platforms failed after max attempts",
        },
      },
    };
  }

  return {
    result: "failed",
    update: {
      id: job.id,
      status: JobStatus.FAILED,
      data: {
        attempts: newAttempts,
        lastAttemptAt: now,
        nextRetryAt: calculateNextRetryTime(newAttempts),
        platformResults,
        errorMessage: "All platforms failed, retrying...",
      },
    },
  };
}

// =============================================================================
// Main Processing Function
// =============================================================================

/**
 * Process a batch of conversion jobs.
 *
 * This function:
 * 1. Applies batch-level backoff if previous batches had high failure rates (P2-2)
 * 2. Claims jobs atomically using FOR UPDATE SKIP LOCKED
 * 3. Verifies billing limits
 * 4. Finds and verifies pixel receipts for consent
 * 5. Sends conversions to enabled platforms (in parallel)
 * 6. Batch updates job statuses
 * 7. Updates backoff state based on results (P2-2)
 */
export async function processConversionJobs(
  batchSize: number = DEFAULT_BATCH_SIZE
): Promise<ProcessConversionJobsResult> {
  const now = new Date();

  // P2-2: Apply batch-level backoff if needed
  await applyBatchBackoff();

  // Claim jobs
  const claimedJobIds = await claimJobsForProcessing(batchSize);

  if (claimedJobIds.length === 0) {
    logger.debug("processConversionJobs: No jobs to process");
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      limitExceeded: 0,
      skipped: 0,
    };
  }

  logger.info(`processConversionJobs: Claimed ${claimedJobIds.length} jobs`);

  // Fetch jobs with relations
  const jobsToProcess = await fetchJobsWithRelations(claimedJobIds);

  // Batch prefetch receipts
  const receiptMap = await batchFetchReceipts(
    jobsToProcess.map((j) => ({
      shopId: j.shopId,
      orderId: j.orderId,
      checkoutToken: parseCapiInput(j.capiInput)?.checkoutToken,
      createdAt: j.createdAt,
    }))
  );

  // Process each job and collect updates
  const updates: JobUpdateEntry[] = [];
  let succeeded = 0;
  let failed = 0;
  let limitExceeded = 0;
  let skipped = 0;

  // Process jobs concurrently in smaller batches for efficiency
  const CONCURRENCY = 10;
  for (let i = 0; i < jobsToProcess.length; i += CONCURRENCY) {
    const batch = jobsToProcess.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map(async (job) => {
        try {
          return await processSingleJob(job, receiptMap, now);
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : "Unknown error";
          logger.error(`Failed to process job ${job.id}: ${errorMsg}`);

          return {
            result: "failed" as JobProcessResult,
            update: {
              id: job.id,
              status: JobStatus.FAILED,
              data: {
                attempts: job.attempts + 1,
                lastAttemptAt: now,
                nextRetryAt: calculateNextRetryTime(job.attempts + 1),
                errorMessage: errorMsg,
              },
            },
          };
        }
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        updates.push(result.value.update);

        switch (result.value.result) {
          case "succeeded":
            succeeded++;
            break;
          case "failed":
            failed++;
            break;
          case "limit_exceeded":
            limitExceeded++;
            break;
          case "skipped":
            skipped++;
            break;
        }
      } else {
        failed++;
        logger.error("Job processing promise rejected:", result.reason);
      }
    }
  }

  // Batch update all jobs
  try {
    await batchUpdateJobs(updates);
  } catch (error) {
    logger.error("Failed to batch update jobs:", error);
    // Fall back to individual updates
    for (const update of updates) {
      try {
        await prisma.conversionJob.update({
          where: { id: update.id },
          data: { status: update.status, ...update.data },
        });
      } catch (updateError) {
        logger.error(`Failed to update job ${update.id}:`, updateError);
      }
    }
  }

  // P2-2: Update batch backoff state
  updateBatchBackoff(succeeded, failed, limitExceeded);

  logger.info(
    `processConversionJobs: Completed - ` +
      `${succeeded} succeeded, ${failed} failed, ` +
      `${limitExceeded} limit exceeded, ${skipped} skipped` +
      (batchBackoffState.currentDelayMs > 0 
        ? ` (backoff: ${batchBackoffState.currentDelayMs}ms)` 
        : "")
  );

  return {
    processed: jobsToProcess.length,
    succeeded,
    failed,
    limitExceeded,
    skipped,
  };
}

// =============================================================================
// Re-exports for backwards compatibility
// =============================================================================

export { batchFetchReceipts, findReceiptForJob } from "./receipt-matcher.server";
export { evaluateTrust, checkPlatformEligibility } from "./trust-evaluator.server";
