/**
 * ConversionJob Processing Service
 * 
 * Handles async processing of conversion jobs queued from webhooks.
 * Includes consent verification, trust validation, and platform sending.
 */

import prisma from "../db.server";
import { checkBillingGate, incrementMonthlyUsage, type PlanId } from "./billing.server";
import { getDecryptedCredentials } from "./credentials.server";
import { sendConversionToGoogle } from "./platforms/google.service";
import { sendConversionToMeta } from "./platforms/meta.service";
import { sendConversionToTikTok } from "./platforms/tiktok.service";
import { generateEventId, matchKeysEqual } from "../utils/crypto.server";
import { logger } from "../utils/logger.server";
import {
  evaluatePlatformConsentWithStrategy,
  getEffectiveConsentCategory,
  type ConsentState,
} from "../utils/platform-consent";
import {
  verifyReceiptTrust,
  isSendAllowedByTrust,
  buildTrustMetadata,
  buildShopAllowedDomains,
  type ReceiptTrustResult,
} from "../utils/receipt-trust";
import type {
  ConversionData,
  GoogleCredentials,
  MetaCredentials,
  TikTokCredentials,
  PlatformCredentials,
  ConversionApiResponse,
} from "../types";
import type { PlatformSendResult } from "./platforms/interface";
import {
  JobStatus,
  SignatureStatus,
  parseCapiInput,
  parseConsentState,
  parsePixelClientConfig,
} from "../types";

// Constants for retry timing
const BASE_DELAY_MS = 60 * 1000;
const MAX_DELAY_MS = 2 * 60 * 60 * 1000;

/**
 * Calculate next retry time with exponential backoff and jitter.
 */
export function calculateNextRetryTime(attempts: number): Date {
  const delayMs = Math.min(BASE_DELAY_MS * Math.pow(5, attempts - 1), MAX_DELAY_MS);
  const jitter = delayMs * 0.1 * Math.random();
  return new Date(Date.now() + delayMs + jitter);
}

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
 * Receipt fields needed for trust verification
 */
interface ReceiptFields {
  consentState: unknown;
  isTrusted: boolean;
  checkoutToken: string | null;
  orderId: string;
  trustLevel: string;
  signatureStatus: string;
  originHost: string | null;
  pixelTimestamp: Date | null;
  createdAt: Date;
}

const RECEIPT_SELECT_FIELDS = {
  consentState: true,
  isTrusted: true,
  checkoutToken: true,
  orderId: true,
  trustLevel: true,
  signatureStatus: true,
  originHost: true,
  pixelTimestamp: true,
  createdAt: true,
  shopId: true,
};

/**
 * Batch prefetch receipts for multiple jobs.
 * Returns a Map for O(1) lookup during job processing.
 */
async function batchFetchReceipts(
  jobs: Array<{
    shopId: string;
    orderId: string;
    capiInput: unknown;
    createdAt: Date;
  }>
): Promise<Map<string, ReceiptFields>> {
  if (jobs.length === 0) return new Map();

  // Collect all shop IDs and order IDs
  const shopIds = [...new Set(jobs.map(j => j.shopId))];
  const orderIds = jobs.map(j => j.orderId);
  const checkoutTokens = jobs
    .map(j => {
      const parsed = parseCapiInput(j.capiInput);
      return parsed?.checkoutToken;
    })
    .filter((t): t is string => !!t);

  // Single batch query for all potential receipts
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId: { in: shopIds },
      eventType: "purchase",
      OR: [
        { orderId: { in: orderIds } },
        ...(checkoutTokens.length > 0 ? [{ checkoutToken: { in: checkoutTokens } }] : []),
      ],
    },
    select: RECEIPT_SELECT_FIELDS,
  });

  // Build lookup map with multiple keys for each receipt
  const receiptMap = new Map<string, ReceiptFields>();
  
  for (const receipt of receipts) {
    // Key by orderId
    const orderKey = `${receipt.shopId}:order:${receipt.orderId}`;
    receiptMap.set(orderKey, receipt);
    
    // Key by checkoutToken if available
    if (receipt.checkoutToken) {
      const tokenKey = `${receipt.shopId}:token:${receipt.checkoutToken}`;
      receiptMap.set(tokenKey, receipt);
    }
  }

  return receiptMap;
}

/**
 * Find matching receipt for a job from pre-fetched map.
 * Falls back to individual queries only when needed for fuzzy matching.
 */
function findReceiptFromMap(
  receiptMap: Map<string, ReceiptFields>,
  shopId: string,
  orderId: string,
  webhookCheckoutToken: string | undefined
): ReceiptFields | null {
  // Strategy 1: Direct lookup by orderId
  const orderKey = `${shopId}:order:${orderId}`;
  let receipt = receiptMap.get(orderKey);
  if (receipt) return receipt;

  // Strategy 2: Lookup by checkoutToken
  if (webhookCheckoutToken) {
    const tokenKey = `${shopId}:token:${webhookCheckoutToken}`;
    receipt = receiptMap.get(tokenKey);
    if (receipt) return receipt;
  }

  return null;
}

/**
 * Find matching receipt with fuzzy matching fallback.
 * Only calls database if simple lookups fail.
 */
async function findReceiptForJob(
  receiptMap: Map<string, ReceiptFields>,
  shopId: string,
  orderId: string,
  webhookCheckoutToken: string | undefined,
  jobCreatedAt: Date
): Promise<ReceiptFields | null> {
  // Try fast map lookup first
  const fromMap = findReceiptFromMap(receiptMap, shopId, orderId, webhookCheckoutToken);
  if (fromMap) return fromMap;

  // Fallback: Fuzzy matching within time window (rare case)
  if (webhookCheckoutToken) {
    const potentialReceipts = await prisma.pixelEventReceipt.findMany({
      where: {
        shopId,
        eventType: "purchase",
        createdAt: {
          gte: new Date(jobCreatedAt.getTime() - 60 * 60 * 1000),
          lte: new Date(jobCreatedAt.getTime() + 60 * 60 * 1000),
        },
      },
      select: RECEIPT_SELECT_FIELDS,
      take: 10,
    });

    for (const candidate of potentialReceipts) {
      if (
        matchKeysEqual(
          { orderId, checkoutToken: webhookCheckoutToken },
          { orderId: candidate.orderId, checkoutToken: candidate.checkoutToken }
        )
      ) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Send conversion to a specific platform.
 * Returns typed result for type-safe error handling.
 */
async function sendToPlatform(
  platform: string,
  credentials: PlatformCredentials,
  conversionData: ConversionData,
  eventId: string
): Promise<PlatformSendResult> {
  let result: PlatformSendResult;
  
  switch (platform) {
    case "google":
      result = await sendConversionToGoogle(
        credentials as GoogleCredentials,
        conversionData,
        eventId
      );
      break;
    case "meta":
      result = await sendConversionToMeta(
        credentials as MetaCredentials,
        conversionData,
        eventId
      );
      break;
    case "tiktok":
      result = await sendConversionToTikTok(
        credentials as TikTokCredentials,
        conversionData,
        eventId
      );
      break;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
  
  if (!result.success) {
    throw new Error(result.error?.message || "Platform send failed");
  }
  
  return result;
}

/**
 * Result of processing conversion jobs batch
 */
export interface ProcessConversionJobsResult {
  processed: number;
  succeeded: number;
  failed: number;
  limitExceeded: number;
  skipped: number;
}

/**
 * Process a batch of conversion jobs.
 * 
 * This function:
 * 1. Claims jobs atomically using FOR UPDATE SKIP LOCKED
 * 2. Verifies billing limits
 * 3. Finds and verifies pixel receipts for consent
 * 4. Sends conversions to enabled platforms
 * 5. Updates job status and retry state
 */
export async function processConversionJobs(): Promise<ProcessConversionJobsResult> {
  const now = new Date();
  const batchSize = 50;

  const claimedJobIds = await claimJobsForProcessing(batchSize);

  if (claimedJobIds.length === 0) {
    logger.debug("processConversionJobs: No jobs to process");
    return { processed: 0, succeeded: 0, failed: 0, limitExceeded: 0, skipped: 0 };
  }

  logger.info(`processConversionJobs: Claimed ${claimedJobIds.length} jobs for processing`);

  const jobsToProcess = await prisma.conversionJob.findMany({
    where: { id: { in: claimedJobIds } },
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

  // Batch prefetch all receipts for better performance
  const receiptMap = await batchFetchReceipts(
    jobsToProcess.map(j => ({
      shopId: j.shopId,
      orderId: j.orderId,
      capiInput: j.capiInput,
      createdAt: j.createdAt,
    }))
  );

  let succeeded = 0;
  let failed = 0;
  let limitExceeded = 0;
  let skipped = 0;

  for (const job of jobsToProcess) {
    try {
      // Check billing limit
      const billingCheck = await checkBillingGate(
        job.shopId,
        (job.shop.plan || "free") as PlanId
      );

      if (!billingCheck.allowed) {
        logger.info(
          `Billing gate blocked job ${job.id}: ${billingCheck.reason}, ` +
            `usage=${billingCheck.usage.current}/${billingCheck.usage.limit}`
        );
        await prisma.conversionJob.update({
          where: { id: job.id },
          data: {
            status: JobStatus.LIMIT_EXCEEDED,
            errorMessage: `Monthly limit exceeded: ${billingCheck.usage.current}/${billingCheck.usage.limit}`,
            lastAttemptAt: now,
          },
        });
        limitExceeded++;
        continue;
      }

      // Skip if no platforms configured
      if (job.shop.pixelConfigs.length === 0) {
        logger.debug(`Job ${job.id}: No active platforms configured`);
        await prisma.conversionJob.update({
          where: { id: job.id },
          data: {
            status: JobStatus.COMPLETED,
            processedAt: now,
            completedAt: now,
            platformResults: { message: "No platforms configured" },
          },
        });
        skipped++;
        continue;
      }

      const eventId = generateEventId(job.orderId, "purchase", job.shop.shopDomain);
      const capiInputParsed = parseCapiInput(job.capiInput);
      const webhookCheckoutToken = capiInputParsed?.checkoutToken;

      // Find matching receipt from pre-fetched map (falls back to DB for fuzzy matching)
      const receipt = await findReceiptForJob(
        receiptMap,
        job.shopId,
        job.orderId,
        webhookCheckoutToken ?? undefined,
        job.createdAt
      );

      // Build allowed domains and verify trust
      const shopAllowedDomains = buildShopAllowedDomains(
        job.shop.shopDomain,
        job.shop.primaryDomain,
        job.shop.storefrontDomains
      );

      const trustResult: ReceiptTrustResult = verifyReceiptTrust({
        receiptCheckoutToken: receipt?.checkoutToken,
        webhookCheckoutToken,
        ingestionKeyMatched: receipt?.signatureStatus === SignatureStatus.KEY_MATCHED,
        receiptExists: !!receipt,
        receiptOriginHost: receipt?.originHost,
        allowedDomains: shopAllowedDomains,
        clientCreatedAt: receipt?.pixelTimestamp,
        serverCreatedAt: receipt?.createdAt,
        options: {
          strictOriginValidation: true,
          allowNullOrigin: true,
          maxReceiptAgeMs: 60 * 60 * 1000,
          maxTimeSkewMs: 15 * 60 * 1000,
        },
      });

      // Update receipt trust level if matched
      if (receipt && webhookCheckoutToken && receipt.checkoutToken === webhookCheckoutToken) {
        try {
          await prisma.pixelEventReceipt.update({
            where: {
              shopId_orderId_eventType: {
                shopId: job.shopId,
                orderId: receipt.orderId,
                eventType: "purchase",
              },
            },
            data: {
              trustLevel: trustResult.level,
              untrustedReason: trustResult.reason,
            },
          });
        } catch (updateError) {
          logger.debug(`Failed to update receipt trust level for job ${job.id}`, {
            error: updateError instanceof Error ? updateError.message : String(updateError),
          });
        }
      }

      // Parse consent state using type-safe parser
      // P0-04: saleOfData must be EXPLICITLY true, not just "not false"
      // undefined/null/missing = NOT allowed (strict deny-by-default interpretation)
      const rawConsentState = parseConsentState(receipt?.consentState);

      const consentState: ConsentState | null = rawConsentState
        ? {
            marketing: rawConsentState.marketing,
            analytics: rawConsentState.analytics,
            saleOfDataAllowed: rawConsentState.saleOfData === true,
          }
        : null;

      const trustMetadata = buildTrustMetadata(trustResult, {
        hasReceipt: !!receipt,
        receiptTrustLevel: receipt?.trustLevel,
        webhookHasCheckoutToken: !!webhookCheckoutToken,
      });

      // Process each platform
      const platformResults: Record<string, string> = {};
      let allSucceeded = true;
      let anySucceeded = false;
      const strategy = job.shop.consentStrategy || "strict";

      for (const pixelConfig of job.shop.pixelConfigs) {
        const clientConfig = parsePixelClientConfig(pixelConfig.clientConfig);
        const treatAsMarketing = clientConfig?.treatAsMarketing === true;
        const platformCategory = getEffectiveConsentCategory(pixelConfig.platform, treatAsMarketing);

        // Check sale of data opt-out
        if (consentState?.saleOfDataAllowed === false) {
          logger.debug(
            `[P0-04] Skipping ${pixelConfig.platform} for job ${job.id}: sale_of_data opt-out`
          );
          platformResults[pixelConfig.platform] = "skipped:sale_of_data_opted_out";
          continue;
        }

        // Check trust level
        const trustAllowed = isSendAllowedByTrust(
          trustResult,
          pixelConfig.platform,
          platformCategory,
          strategy
        );

        if (!trustAllowed.allowed) {
          logger.debug(
            `[P0-01] Skipping ${pixelConfig.platform} for job ${job.id}: ` +
              `trust check failed - ${trustAllowed.reason}`
          );
          platformResults[pixelConfig.platform] = `skipped:trust_${trustAllowed.reason}`;
          continue;
        }

        // Check consent
        const hasVerifiedReceipt = trustResult.trusted || trustResult.level === "partial";
        const consentDecision = evaluatePlatformConsentWithStrategy(
          pixelConfig.platform,
          strategy,
          consentState,
          hasVerifiedReceipt,
          treatAsMarketing
        );

        if (!consentDecision.allowed) {
          const skipReason = consentDecision.reason || "consent_denied";
          const usedConsent = consentDecision.usedConsent || "unknown";
          logger.debug(
            `[P0-07] Skipping ${pixelConfig.platform} for job ${job.id}: ` +
              `${skipReason} (consent type: ${usedConsent}, strategy: ${strategy})`
          );
          platformResults[pixelConfig.platform] = `skipped:${skipReason.replace(/\s+/g, "_").toLowerCase()}`;
          continue;
        }

        logger.debug(
          `[P0-07] Consent check passed for ${pixelConfig.platform} (job ${job.id}): ` +
            `strategy=${strategy}, usedConsent=${consentDecision.usedConsent}, ` +
            `trustLevel=${trustResult.level}`
        );

        try {
          // Decrypt credentials
          const { credentials } = getDecryptedCredentials(pixelConfig, pixelConfig.platform);

          if (!credentials) {
            platformResults[pixelConfig.platform] = "failed:no_credentials";
            allSucceeded = false;
            continue;
          }

          // Build conversion data using type-safe parsed input
          const lineItems = capiInputParsed?.items?.map((item) => ({
            productId: item.productId || "",
            variantId: item.variantId || "",
            name: item.name || "",
            quantity: item.quantity || 1,
            price: item.price || 0,
          }));

          const conversionData: ConversionData = {
            orderId: job.orderId,
            orderNumber: job.orderNumber,
            value: Number(job.orderValue),
            currency: job.currency,
            lineItems,
          };

          // Send to platform
          await sendToPlatform(pixelConfig.platform, credentials, conversionData, eventId);
          platformResults[pixelConfig.platform] = "sent";
          anySucceeded = true;
        } catch (platformError) {
          const errorMsg = platformError instanceof Error ? platformError.message : "Unknown error";
          platformResults[pixelConfig.platform] = `failed:${errorMsg.substring(0, 50)}`;
          allSucceeded = false;
        }
      }

      // Update job status
      const newAttempts = job.attempts + 1;

      if (allSucceeded || anySucceeded) {
        await prisma.conversionJob.update({
          where: { id: job.id },
          data: {
            status: JobStatus.COMPLETED,
            attempts: newAttempts,
            lastAttemptAt: now,
            processedAt: now,
            completedAt: now,
            platformResults,
            errorMessage: null,
            trustMetadata: trustMetadata as object,
            consentEvidence: JSON.parse(JSON.stringify({
              strategy,
              hasReceipt: !!receipt,
              receiptTrusted: trustResult.trusted,
              trustLevel: trustResult.level,
              consentState: consentState || null,
            })),
          },
        });
        await incrementMonthlyUsage(job.shopId, job.orderId);
        succeeded++;
      } else {
        if (newAttempts >= job.maxAttempts) {
          await prisma.conversionJob.update({
            where: { id: job.id },
            data: {
              status: JobStatus.DEAD_LETTER,
              attempts: newAttempts,
              lastAttemptAt: now,
              platformResults,
              errorMessage: "All platforms failed after max attempts",
            },
          });
        } else {
          const nextRetryAt = calculateNextRetryTime(newAttempts);
          await prisma.conversionJob.update({
            where: { id: job.id },
            data: {
              status: JobStatus.FAILED,
              attempts: newAttempts,
              lastAttemptAt: now,
              nextRetryAt,
              platformResults,
              errorMessage: "All platforms failed, retrying...",
            },
          });
        }
        failed++;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      logger.error(`Failed to process job ${job.id}: ${errorMsg}`);

      await prisma.conversionJob
        .update({
          where: { id: job.id },
          data: {
            status: JobStatus.FAILED,
            attempts: job.attempts + 1,
            lastAttemptAt: now,
            nextRetryAt: calculateNextRetryTime(job.attempts + 1),
            errorMessage: errorMsg,
          },
        })
        .catch((dbError) => {
          logger.error(`Failed to update job ${job.id} status after error`, dbError);
        });

      failed++;
    }
  }

  logger.info(
    `processConversionJobs: Completed - ` +
      `${succeeded} succeeded, ${failed} failed, ` +
      `${limitExceeded} limit exceeded, ${skipped} skipped`
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
// Re-exports from Split Modules (for new consumers)
// =============================================================================

/**
 * The conversion job processing logic has been modularized into:
 * - receipt-matcher.server.ts: Receipt lookup and matching
 * - trust-evaluator.server.ts: Trust and consent evaluation
 * - job-processor.server.ts: Main processing orchestration
 * 
 * This file is kept for backwards compatibility.
 * New code should import from job-processor.server.ts.
 */
export { 
  batchFetchReceipts,
  findReceiptForJob,
  updateReceiptTrustLevel,
  type ReceiptFields as ReceiptFieldsNew,
  type JobForReceiptMatch,
} from './receipt-matcher.server';

export {
  evaluateTrust,
  checkPlatformEligibility,
  buildConsentEvidence,
  DEFAULT_TRUST_OPTIONS,
  type ShopTrustContext,
  type TrustEvaluationResult,
  type PlatformEligibilityResult,
} from './trust-evaluator.server';

export {
  processConversionJobs as processConversionJobsNew,
} from './job-processor.server';
