/**
 * Retry Service for Server-Side Conversions
 * 
 * P1-5: Enhanced with standardized error handling from platform services
 * 
 * Implements:
 * - Exponential backoff retry strategy
 * - Dead letter queue for permanently failed conversions
 * - Manual retry capability for dead letter items
 * - Failure reason classification for better diagnostics
 * - Integration with platform-specific error parsers
 */

import prisma from "../db.server";
import { 
  type PlatformError,
  calculateBackoff,
  shouldRetry as shouldRetryPlatform,
  formatErrorForLog,
} from "./platforms/base.server";
import { 
  checkBillingGate, 
  incrementMonthlyUsage, 
  type PlanId 
} from "./billing.server";
import { generateEventId, normalizeOrderId } from "../utils/crypto";
import { extractPIISafely, logPIIStatus } from "../utils/pii";
import type { OrderWebhookPayload } from "../types";
// P0-13: Use logger instead of console for proper sanitization
import { logger } from "../utils/logger";

// ==========================================
// Failure Reason Classification
// ==========================================

export type FailureReason = 
  | "token_expired"     // 401 - needs re-authorization
  | "rate_limited"      // 429 - retry later
  | "platform_error"    // 5xx - platform issue
  | "validation_error"  // 4xx - field/data issue
  | "network_error"     // timeout/connection issue
  | "config_error"      // credential/config issue
  | "unknown";          // unclassified

/**
 * P1-5: Convert PlatformError type to FailureReason
 */
export function platformErrorToFailureReason(error: PlatformError): FailureReason {
  switch (error.type) {
    case "auth_error":
      return "token_expired";
    case "rate_limited":
      return "rate_limited";
    case "server_error":
      return "platform_error";
    case "validation_error":
      return "validation_error";
    case "timeout":
    case "network_error":
      return "network_error";
    case "invalid_config":
      return "config_error";
    case "quota_exceeded":
      return "config_error"; // Treat as config issue (needs plan upgrade)
    default:
      return "unknown";
  }
}

/**
 * P1-5: Determine if an error should be retried based on PlatformError
 */
export function shouldRetryFromPlatformError(
  error: PlatformError, 
  currentAttempt: number, 
  maxAttempts: number
): boolean {
  return shouldRetryPlatform(error, currentAttempt, maxAttempts);
}

/**
 * P1-5: Get retry delay based on PlatformError
 */
export function getRetryDelay(error: PlatformError, attempt: number): number {
  // If platform specified a retry-after, use it
  if (error.retryAfter) {
    return error.retryAfter * 1000; // Convert to ms
  }
  
  // Otherwise use exponential backoff
  return calculateBackoff(attempt);
}

/**
 * Classify error message into a failure reason category
 */
export function classifyFailureReason(errorMessage: string | null): FailureReason {
  if (!errorMessage) return "unknown";
  
  const lowerError = errorMessage.toLowerCase();
  
  // Token/Auth issues
  if (
    lowerError.includes("401") ||
    lowerError.includes("unauthorized") ||
    lowerError.includes("token expired") ||
    lowerError.includes("invalid token") ||
    lowerError.includes("access token")
  ) {
    return "token_expired";
  }
  
  // Rate limiting
  if (
    lowerError.includes("429") ||
    lowerError.includes("rate limit") ||
    lowerError.includes("too many requests")
  ) {
    return "rate_limited";
  }
  
  // Platform errors (5xx)
  if (
    lowerError.includes("500") ||
    lowerError.includes("502") ||
    lowerError.includes("503") ||
    lowerError.includes("504") ||
    lowerError.includes("internal server error") ||
    lowerError.includes("service unavailable")
  ) {
    return "platform_error";
  }
  
  // Network errors
  if (
    lowerError.includes("timeout") ||
    lowerError.includes("network") ||
    lowerError.includes("econnrefused") ||
    lowerError.includes("enotfound") ||
    lowerError.includes("fetch failed")
  ) {
    return "network_error";
  }
  
  // Validation errors
  if (
    lowerError.includes("400") ||
    lowerError.includes("invalid") ||
    lowerError.includes("validation") ||
    lowerError.includes("missing required")
  ) {
    return "validation_error";
  }
  
  // Config errors
  if (
    lowerError.includes("credential") ||
    lowerError.includes("decrypt") ||
    lowerError.includes("not configured") ||
    lowerError.includes("api secret")
  ) {
    return "config_error";
  }
  
  return "unknown";
}

/**
 * Check if a failure reason should trigger immediate notification
 */
export function shouldNotifyImmediately(reason: FailureReason): boolean {
  // Token expiration needs immediate attention
  return reason === "token_expired" || reason === "config_error";
}
import { sendConversionToGoogle } from "./platforms/google.server";
import { sendConversionToMeta } from "./platforms/meta.server";
import { sendConversionToTikTok } from "./platforms/tiktok.server";
import { decryptJson } from "../utils/crypto";
import type {
  ConversionData,
  GoogleCredentials,
  MetaCredentials,
  TikTokCredentials,
  PlatformCredentials,
} from "../types";

// Retry configuration
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 60 * 1000; // 1 minute
const MAX_DELAY_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Calculate next retry time using exponential backoff
 * Delays: 1m, 5m, 25m, 2h, 2h (capped)
 */
export function calculateNextRetryTime(attempts: number): Date {
  // Exponential backoff: baseDelay * 5^(attempts-1)
  const delayMs = Math.min(
    BASE_DELAY_MS * Math.pow(5, attempts - 1),
    MAX_DELAY_MS
  );
  
  // Add some jitter (±10%) to prevent thundering herd
  const jitter = delayMs * 0.1 * (Math.random() * 2 - 1);
  
  return new Date(Date.now() + delayMs + jitter);
}

/**
 * Mark a conversion log for retry with exponential backoff
 * Classifies the failure reason for better diagnostics
 * 
 * NOTE: This function does NOT increment attempts - the caller is responsible for
 * incrementing attempts after each send attempt (success or failure).
 * This function only schedules the next retry based on the current attempts count.
 * 
 * Retry delays based on attempts:
 * - attempts=1 (first failure): retry in 1 minute
 * - attempts=2: retry in 5 minutes  
 * - attempts=3: retry in 25 minutes
 * - attempts=4: retry in 2 hours
 * - attempts=5: move to dead letter
 */
export async function scheduleRetry(
  logId: string,
  errorMessage: string
): Promise<{ scheduled: boolean; failureReason: FailureReason }> {
  const log = await prisma.conversionLog.findUnique({
    where: { id: logId },
  });

  if (!log) return { scheduled: false, failureReason: "unknown" };

  const failureReason = classifyFailureReason(errorMessage);
  // Use current attempts (already incremented by caller) to determine next action
  const currentAttempts = log.attempts;
  const maxAttempts = log.maxAttempts || MAX_ATTEMPTS;

  // For token_expired or config errors, don't retry - it won't help without re-auth
  if (failureReason === "token_expired" || failureReason === "config_error") {
    await prisma.conversionLog.update({
      where: { id: logId },
      data: {
        status: "dead_letter",
        lastAttemptAt: new Date(),
        errorMessage: `[${failureReason}] ${errorMessage}`,
        deadLetteredAt: new Date(),
      },
    });
    logger.warn(`Conversion ${logId} moved to dead letter: ${failureReason}`);
    return { scheduled: false, failureReason };
  }

  if (currentAttempts >= maxAttempts) {
    // Move to dead letter queue
    await prisma.conversionLog.update({
      where: { id: logId },
      data: {
        status: "dead_letter",
        lastAttemptAt: new Date(),
        errorMessage: `[${failureReason}] ${errorMessage}`,
        deadLetteredAt: new Date(),
      },
    });
    logger.warn(`Conversion ${logId} moved to dead letter after ${currentAttempts} attempts`);
    return { scheduled: false, failureReason };
  } else {
    // Schedule retry with exponential backoff based on current attempts
    const nextRetryAt = calculateNextRetryTime(currentAttempts);
    await prisma.conversionLog.update({
      where: { id: logId },
      data: {
        status: "retrying",
        lastAttemptAt: new Date(),
        nextRetryAt,
        errorMessage: `[${failureReason}] ${errorMessage}`,
      },
    });
    logger.info(`Conversion ${logId} scheduled for retry at ${nextRetryAt.toISOString()} (attempt ${currentAttempts}, reason: ${failureReason})`);
    return { scheduled: true, failureReason };
  }
}

/**
 * P1-2: Process pending conversions (newly created, not yet sent)
 * P0-1: Includes billing gate check before processing
 * This is called by the cron job to process webhooks asynchronously
 * Should be called frequently (e.g., every minute)
 */
export async function processPendingConversions(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  limitExceeded: number;
}> {
  // Find logs that are pending and have never been attempted
  const pendingLogs = await prisma.conversionLog.findMany({
    where: {
      status: "pending",
      attempts: 0, // Only process new logs, not ones that have failed
    },
    include: {
      shop: {
        select: {
          id: true,
          shopDomain: true,
          plan: true,
          piiEnabled: true,
          pixelConfigs: {
            where: { isActive: true, serverSideEnabled: true },
            select: {
              id: true,
              platform: true,
              platformId: true,
              credentialsEncrypted: true,
              credentials: true,
            },
          },
        },
      },
    },
    take: 100, // Process in batches
    orderBy: { createdAt: "asc" }, // Process oldest first
  });

  logger.info(`Processing ${pendingLogs.length} pending conversions`);

  let succeeded = 0;
  let failed = 0;
  let limitExceeded = 0;

  for (const log of pendingLogs) {
    try {
      // P0-1: Check billing gate BEFORE processing
      const billingCheck = await checkBillingGate(
        log.shopId,
        (log.shop.plan || "free") as PlanId
      );

      if (!billingCheck.allowed) {
        logger.info(
          `Billing gate blocked conversion ${log.id}: ${billingCheck.reason}, ` +
          `usage=${billingCheck.usage.current}/${billingCheck.usage.limit}`
        );

        await prisma.conversionLog.update({
          where: { id: log.id },
          data: {
            status: "failed",
            errorMessage: `Monthly limit exceeded: ${billingCheck.usage.current}/${billingCheck.usage.limit}`,
            lastAttemptAt: new Date(),
          },
        });

        limitExceeded++;
        continue;
      }

      // Find the pixel config for this platform
      const pixelConfig = log.shop.pixelConfigs.find(
        (pc) => pc.platform === log.platform
      );

      if (!pixelConfig) {
        // Mark as failed if no config
        await prisma.conversionLog.update({
          where: { id: log.id },
          data: {
            status: "failed",
            attempts: 1,
            lastAttemptAt: new Date(),
            errorMessage: "Pixel config not found or disabled",
          },
        });
        failed++;
        continue;
      }

      // Get credentials
      let credentials: PlatformCredentials | null = null;
      
      if (pixelConfig.credentialsEncrypted) {
        try {
          credentials = decryptJson<PlatformCredentials>(
            pixelConfig.credentialsEncrypted
          );
        } catch {
          // Fall through to try legacy field
        }
      }
      
      if (!credentials && (pixelConfig as Record<string, unknown>).credentials) {
        try {
          const legacyCredentials = (pixelConfig as Record<string, unknown>).credentials;
          if (typeof legacyCredentials === "string") {
            credentials = decryptJson<PlatformCredentials>(legacyCredentials);
          } else if (typeof legacyCredentials === "object" && legacyCredentials !== null) {
            credentials = legacyCredentials as PlatformCredentials;
          }
        } catch {
          // Continue with null credentials
        }
      }

      if (!credentials) {
        await prisma.conversionLog.update({
          where: { id: log.id },
          data: {
            status: "failed",
            attempts: 1,
            lastAttemptAt: new Date(),
            errorMessage: "No credentials configured",
          },
        });
        failed++;
        continue;
      }

      // P0-1: Get or generate eventId for platform deduplication
      const eventId = log.eventId || generateEventId(log.orderId, log.eventType, log.shop.shopDomain);

      // Build conversion data (minimal - no PII stored in logs)
      const conversionData: ConversionData = {
        orderId: log.orderId,
        orderNumber: log.orderNumber,
        value: Number(log.orderValue),
        currency: log.currency,
      };

      // Send to platform with eventId for deduplication
      let result;
      switch (log.platform) {
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
          throw new Error(`Unsupported platform: ${log.platform}`);
      }

      // Success!
      await prisma.conversionLog.update({
        where: { id: log.id },
        data: {
          status: "sent",
          serverSideSent: true,
          sentAt: new Date(),
          platformResponse: result as object,
          errorMessage: null,
          attempts: 1,
          lastAttemptAt: new Date(),
        },
      });

      // P0-1: Increment monthly usage on successful send
      await incrementMonthlyUsage(log.shopId, log.orderId);

      succeeded++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      // Mark as failed and schedule retry
      await prisma.conversionLog.update({
        where: { id: log.id },
        data: { attempts: 1, lastAttemptAt: new Date() },
      });
      
      await scheduleRetry(log.id, errorMessage);
      failed++;
    }
  }

  return { processed: pendingLogs.length, succeeded, failed, limitExceeded };
}

/**
 * Process pending retries
 * P0-1: Includes billing gate check before retrying
 * Should be called periodically (e.g., by a cron job)
 */
export async function processRetries(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  limitExceeded: number;
}> {
  const now = new Date();
  
  // Find logs that are due for retry
  const logsToRetry = await prisma.conversionLog.findMany({
    where: {
      status: "retrying",
      nextRetryAt: { lte: now },
    },
    include: {
      shop: {
        select: {
          id: true,
          shopDomain: true,
          plan: true,
          pixelConfigs: {
            where: { isActive: true, serverSideEnabled: true },
          },
        },
      },
    },
    take: 50, // Process in batches
  });

  logger.info(`Processing ${logsToRetry.length} pending retries`);

  let succeeded = 0;
  let failed = 0;
  let limitExceeded = 0;

  for (const log of logsToRetry) {
    try {
      // P0-1: Check billing gate BEFORE retrying
      const billingCheck = await checkBillingGate(
        log.shopId,
        (log.shop.plan || "free") as PlanId
      );

      if (!billingCheck.allowed) {
        logger.info(
          `Billing gate blocked retry for ${log.id}: ${billingCheck.reason}, ` +
          `usage=${billingCheck.usage.current}/${billingCheck.usage.limit}`
        );

        await prisma.conversionLog.update({
          where: { id: log.id },
          data: {
            status: "limit_exceeded",
            errorMessage: `Monthly limit exceeded: ${billingCheck.usage.current}/${billingCheck.usage.limit}`,
            lastAttemptAt: now,
          },
        });

        limitExceeded++;
        continue;
      }

      // Find the pixel config for this platform
      const pixelConfig = log.shop.pixelConfigs.find(
        (pc) => pc.platform === log.platform
      );

      if (!pixelConfig) {
        await scheduleRetry(log.id, "Pixel config not found or disabled");
        failed++;
        continue;
      }

      // Get credentials - prefer credentialsEncrypted, fallback to legacy credentials field
      let credentials: PlatformCredentials | null = null;
      
      // Try credentialsEncrypted first (new field)
      if (pixelConfig.credentialsEncrypted) {
        try {
          credentials = decryptJson<PlatformCredentials>(
            pixelConfig.credentialsEncrypted
          );
        } catch (decryptError) {
          const errorMsg = decryptError instanceof Error ? decryptError.message : "Unknown error";
          logger.warn(`Failed to decrypt credentialsEncrypted for ${log.platform}: ${errorMsg}`);
          // Fall through to try legacy field
        }
      }
      
      // Fallback: try legacy credentials field (for backwards compatibility with old data)
      // Note: Prisma schema maps this to credentials_legacy column
      if (!credentials && (pixelConfig as Record<string, unknown>).credentials) {
        try {
          const legacyCredentials = (pixelConfig as Record<string, unknown>).credentials;
          // Legacy field might be:
          // 1. An encrypted string (old format)
          // 2. A JSON object stored directly
          if (typeof legacyCredentials === "string") {
            credentials = decryptJson<PlatformCredentials>(legacyCredentials);
          } else if (typeof legacyCredentials === "object" && legacyCredentials !== null) {
            credentials = legacyCredentials as PlatformCredentials;
          }
          logger.info(`Using legacy credentials field for ${log.platform} - please migrate to credentialsEncrypted`);
        } catch (legacyError) {
          const errorMsg = legacyError instanceof Error ? legacyError.message : "Unknown error";
          logger.warn(`Failed to read legacy credentials for ${log.platform}: ${errorMsg}`);
        }
      }
      
      if (!credentials) {
        // Increment attempts before scheduling retry
        await prisma.conversionLog.update({
          where: { id: log.id },
          data: { attempts: { increment: 1 } },
        });
        await scheduleRetry(log.id, "No credentials configured - please set up in Settings");
        failed++;
        continue;
      }

      if (!credentials) {
        await scheduleRetry(log.id, "Decrypted credentials are null");
        failed++;
        continue;
      }

      // P0-1: Get or generate eventId for platform deduplication
      const eventId = log.eventId || generateEventId(log.orderId, log.eventType, log.shop.shopDomain);

      // Build conversion data
      const conversionData: ConversionData = {
        orderId: log.orderId,
        orderNumber: log.orderNumber,
        value: Number(log.orderValue),
        currency: log.currency,
        // Note: We don't have customer details stored, so we can't retry with enhanced matching
        // This is a trade-off between privacy and retry capability
      };

      // Send to platform with eventId for deduplication
      let result;
      switch (log.platform) {
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
          throw new Error(`Unsupported platform: ${log.platform}`);
      }

      // Success! Increment attempts to mark this retry as completed
      await prisma.conversionLog.update({
        where: { id: log.id },
        data: {
          status: "sent",
          serverSideSent: true,
          sentAt: new Date(),
          platformResponse: result as object,
          errorMessage: null,
          nextRetryAt: null,
          attempts: { increment: 1 }, // Increment after successful retry
        },
      });

      // P0-1: Increment monthly usage on successful retry
      // Note: This is idempotent - it checks if already counted
      await incrementMonthlyUsage(log.shopId, log.orderId);

      succeeded++;
      logger.info(`Retry succeeded for ${log.id}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      // Increment attempts first, then schedule next retry
      await prisma.conversionLog.update({
        where: { id: log.id },
        data: { attempts: { increment: 1 } },
      });
      
      await scheduleRetry(log.id, errorMessage);
      failed++;
      logger.error(`Retry failed for ${log.id}: ${errorMessage}`);
    }
  }

  return { processed: logsToRetry.length, succeeded, failed, limitExceeded };
}

/**
 * P0-2 & P1-9: Process queued ConversionJobs
 * This is the main worker function that processes the async webhook queue
 * 
 * Features:
 * - Processes jobs in batches with locking to prevent duplicate processing
 * - P0-1: Billing gate check before processing
 * - Sends to all configured platforms
 * - Updates job status on success/failure
 * - Moves permanently failed jobs to dead letter
 */
export async function processConversionJobs(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  limitExceeded: number;
  skipped: number;
}> {
  const now = new Date();
  const batchSize = 50;
  
  // Find jobs ready to process:
  // - Status: queued or failed (for retry)
  // - nextRetryAt: null or in the past
  // - attempts < maxAttempts
  const jobsToProcess = await prisma.conversionJob.findMany({
    where: {
      OR: [
        { status: "queued" },
        {
          status: "failed",
          nextRetryAt: { lte: now },
          attempts: { lt: prisma.conversionJob.fields.maxAttempts },
        },
      ],
    },
    include: {
      shop: {
        select: {
          id: true,
          shopDomain: true,
          plan: true,
          piiEnabled: true,
          consentStrategy: true,
          pixelConfigs: {
            where: { isActive: true, serverSideEnabled: true },
            select: {
              id: true,
              platform: true,
              platformId: true,
              credentialsEncrypted: true,
              credentials: true,
            },
          },
        },
      },
    },
    take: batchSize,
    orderBy: { createdAt: "asc" },
  });
  
  if (jobsToProcess.length === 0) {
    logger.debug("processConversionJobs: No jobs to process");
    return { processed: 0, succeeded: 0, failed: 0, limitExceeded: 0, skipped: 0 };
  }
  
  logger.info(`processConversionJobs: Processing ${jobsToProcess.length} jobs`);
  
  let succeeded = 0;
  let failed = 0;
  let limitExceeded = 0;
  let skipped = 0;
  
  for (const job of jobsToProcess) {
    try {
      // Mark as processing to prevent duplicate processing
      await prisma.conversionJob.update({
        where: { id: job.id },
        data: { status: "processing" },
      });
      
      // P0-1: Check billing gate
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
            status: "limit_exceeded",
            errorMessage: `Monthly limit exceeded: ${billingCheck.usage.current}/${billingCheck.usage.limit}`,
            lastAttemptAt: now,
          },
        });
        
        limitExceeded++;
        continue;
      }
      
      // Check if shop has any configured platforms
      if (job.shop.pixelConfigs.length === 0) {
        logger.debug(`Job ${job.id}: No active platforms configured`);
        await prisma.conversionJob.update({
          where: { id: job.id },
          data: {
            status: "completed",
            processedAt: now,
            completedAt: now,
            platformResults: { message: "No platforms configured" },
          },
        });
        skipped++;
        continue;
      }
      
      // Generate eventId for deduplication
      const eventId = generateEventId(job.orderId, "purchase", job.shop.shopDomain);
      
      // P0-08: Get PixelEventReceipt to check consent state
      const receipt = await prisma.pixelEventReceipt.findUnique({
        where: {
          shopId_orderId_eventType: {
            shopId: job.shopId,
            orderId: job.orderId,
            eventType: "purchase",
          },
        },
        select: { consentState: true, isTrusted: true },
      });
      
      const consentState = receipt?.consentState as { 
        marketing?: boolean; 
        analytics?: boolean; 
      } | null;
      
      // Process each platform
      const platformResults: Record<string, string> = {};
      let allSucceeded = true;
      let anySucceeded = false;
      
      for (const pixelConfig of job.shop.pixelConfigs) {
        // P0-08: Platform-level consent gating
        // Marketing platforms (Meta, TikTok) require marketing consent
        // Analytics platforms (Google) require analytics consent
        const isMarketingPlatform = ["meta", "tiktok"].includes(pixelConfig.platform);
        const isAnalyticsPlatform = ["google"].includes(pixelConfig.platform);
        
        // P0-08: Check consent - if we have receipt with explicit denial, skip
        // Note: If no receipt exists, we follow the shop's consentStrategy
        if (receipt && consentState) {
          if (isMarketingPlatform && consentState.marketing === false) {
            logger.debug(`[P0-08] Skipping ${pixelConfig.platform} for job ${job.id}: marketing consent denied`);
            platformResults[pixelConfig.platform] = "skipped:no_marketing_consent";
            continue;
          }
          if (isAnalyticsPlatform && consentState.analytics === false) {
            logger.debug(`[P0-08] Skipping ${pixelConfig.platform} for job ${job.id}: analytics consent denied`);
            platformResults[pixelConfig.platform] = "skipped:no_analytics_consent";
            continue;
          }
        }
        // P0-08: If no receipt exists, use shop's consentStrategy
        // "strict" = require receipt, "balanced" = allow if no denial, "weak" = allow all
        else if (job.shop.consentStrategy === "strict") {
          logger.debug(`[P0-08] Skipping ${pixelConfig.platform} for job ${job.id}: strict mode requires consent receipt`);
          platformResults[pixelConfig.platform] = "skipped:no_consent_receipt";
          continue;
        }
        try {
          // Get credentials
          let credentials: PlatformCredentials | null = null;
          
          if (pixelConfig.credentialsEncrypted) {
            try {
              credentials = decryptJson<PlatformCredentials>(pixelConfig.credentialsEncrypted);
            } catch {
              // Fall through
            }
          }
          
          if (!credentials && (pixelConfig as Record<string, unknown>).credentials) {
            try {
              const legacyCreds = (pixelConfig as Record<string, unknown>).credentials;
              if (typeof legacyCreds === "string") {
                credentials = decryptJson<PlatformCredentials>(legacyCreds);
              } else if (typeof legacyCreds === "object" && legacyCreds !== null) {
                credentials = legacyCreds as PlatformCredentials;
              }
            } catch {
              // Continue
            }
          }
          
          if (!credentials) {
            platformResults[pixelConfig.platform] = "failed:no_credentials";
            allSucceeded = false;
            continue;
          }
          
          // P0-05: Build conversion data from job fields + capiInput
          // capiInput contains minimal CAPI-specific data (items, tax, etc.)
          // Prefer capiInput values when available for richer conversion data
          const capiInput = job.capiInput as {
            items?: Array<{ productId?: string; variantId?: string; name?: string; quantity?: number; price?: number }>;
            tax?: number;
            shipping?: number;
          } | null;
          
          // P0-05: Convert capiInput.items to LineItem format for ConversionData
          const lineItems = capiInput?.items?.map(item => ({
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
            // P0-05: Include lineItems from capiInput if available
            lineItems,
          };
          
          // Send to platform
          let result;
          switch (pixelConfig.platform) {
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
              platformResults[pixelConfig.platform] = "failed:unsupported_platform";
              allSucceeded = false;
              continue;
          }
          
          platformResults[pixelConfig.platform] = "sent";
          anySucceeded = true;
          
        } catch (platformError) {
          const errorMsg = platformError instanceof Error ? platformError.message : "Unknown error";
          platformResults[pixelConfig.platform] = `failed:${errorMsg.substring(0, 50)}`;
          allSucceeded = false;
        }
      }
      
      // Update job status based on results
      const newAttempts = job.attempts + 1;
      
      if (allSucceeded || anySucceeded) {
        // At least some platforms succeeded
        await prisma.conversionJob.update({
          where: { id: job.id },
          data: {
            status: "completed",
            attempts: newAttempts,
            lastAttemptAt: now,
            processedAt: now,
            completedAt: now,
            platformResults,
            errorMessage: null,
          },
        });
        
        // Increment monthly usage
        await incrementMonthlyUsage(job.shopId, job.orderId);
        
        succeeded++;
      } else {
        // All platforms failed
        if (newAttempts >= job.maxAttempts) {
          // Move to dead letter
          await prisma.conversionJob.update({
            where: { id: job.id },
            data: {
              status: "dead_letter",
              attempts: newAttempts,
              lastAttemptAt: now,
              platformResults,
              errorMessage: "All platforms failed after max attempts",
            },
          });
        } else {
          // Schedule retry with exponential backoff
          const nextRetryAt = calculateNextRetryTime(newAttempts);
          await prisma.conversionJob.update({
            where: { id: job.id },
            data: {
              status: "failed",
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
      
      // Mark as failed
      await prisma.conversionJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          attempts: job.attempts + 1,
          lastAttemptAt: now,
          nextRetryAt: calculateNextRetryTime(job.attempts + 1),
          errorMessage: errorMsg,
        },
      }).catch(() => {
        // Ignore update errors - job will be retried
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

/**
 * Get dead letter items for a shop
 */
export async function getDeadLetterItems(
  shopId: string,
  limit = 50
): Promise<Array<{
  id: string;
  orderId: string;
  orderNumber: string | null;
  platform: string;
  errorMessage: string | null;
  attempts: number;
  deadLetteredAt: Date | null;
}>> {
  const items = await prisma.conversionLog.findMany({
    where: {
      shopId,
      status: "dead_letter",
    },
    select: {
      id: true,
      orderId: true,
      orderNumber: true,
      platform: true,
      errorMessage: true,
      attempts: true,
      deadLetteredAt: true,
    },
    orderBy: { deadLetteredAt: "desc" },
    take: limit,
  });

  return items;
}

/**
 * Manually retry a dead letter item
 */
export async function retryDeadLetter(logId: string): Promise<boolean> {
  const log = await prisma.conversionLog.findUnique({
    where: { id: logId },
  });

  if (!log || log.status !== "dead_letter") {
    return false;
  }

  // Reset for retry
  await prisma.conversionLog.update({
    where: { id: logId },
    data: {
      status: "retrying",
      attempts: 0,
      maxAttempts: 3, // Give it 3 more attempts
      nextRetryAt: new Date(), // Retry immediately
      manuallyRetried: true,
      errorMessage: null,
    },
  });

  logger.info(`Dead letter ${logId} queued for manual retry`);
  return true;
}

/**
 * Batch retry all dead letter items for a shop
 */
export async function retryAllDeadLetters(shopId: string): Promise<number> {
  const result = await prisma.conversionLog.updateMany({
    where: {
      shopId,
      status: "dead_letter",
    },
    data: {
      status: "retrying",
      attempts: 0,
      maxAttempts: 3,
      nextRetryAt: new Date(),
      manuallyRetried: true,
      errorMessage: null,
    },
  });

  logger.info(`${result.count} dead letters queued for retry in shop ${shopId}`);
  return result.count;
}

/**
 * Check if shop has token expiration issues
 * Returns platforms that have recent token_expired failures
 */
export async function checkTokenExpirationIssues(shopId: string): Promise<{
  hasIssues: boolean;
  affectedPlatforms: string[];
}> {
  // Look for recent failures (last 24 hours) with token_expired reason
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);

  const tokenExpiredLogs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      status: { in: ["failed", "dead_letter"] },
      errorMessage: { contains: "[token_expired]" },
      lastAttemptAt: { gte: oneDayAgo },
    },
    select: {
      platform: true,
    },
    distinct: ["platform"],
  });

  const affectedPlatforms = tokenExpiredLogs.map((l) => l.platform);

  return {
    hasIssues: affectedPlatforms.length > 0,
    affectedPlatforms,
  };
}

/**
 * Get retry statistics for a shop
 */
export async function getRetryStats(shopId: string): Promise<{
  pending: number;
  retrying: number;
  deadLetter: number;
  sent: number;
  failed: number;
}> {
  const stats = await prisma.conversionLog.groupBy({
    by: ["status"],
    where: { shopId },
    _count: true,
  });

  const result = {
    pending: 0,
    retrying: 0,
    deadLetter: 0,
    sent: 0,
    failed: 0,
  };

  for (const stat of stats) {
    switch (stat.status) {
      case "pending":
        result.pending = stat._count;
        break;
      case "retrying":
        result.retrying = stat._count;
        break;
      case "dead_letter":
        result.deadLetter = stat._count;
        break;
      case "sent":
        result.sent = stat._count;
        break;
      case "failed":
        result.failed = stat._count;
        break;
    }
  }

  return result;
}
