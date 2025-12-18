/**
 * Retry Service for Server-Side Conversions
 * 
 * Implements:
 * - Exponential backoff retry strategy
 * - Dead letter queue for permanently failed conversions
 * - Manual retry capability for dead letter items
 * - Failure reason classification for better diagnostics
 */

import prisma from "../db.server";

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
  const newAttempts = log.attempts + 1;
  const maxAttempts = log.maxAttempts || MAX_ATTEMPTS;

  // For token_expired errors, don't retry - it won't help without re-auth
  if (failureReason === "token_expired" || failureReason === "config_error") {
    await prisma.conversionLog.update({
      where: { id: logId },
      data: {
        status: "dead_letter",
        attempts: newAttempts,
        lastAttemptAt: new Date(),
        errorMessage: `[${failureReason}] ${errorMessage}`,
        deadLetteredAt: new Date(),
      },
    });
    console.log(`Conversion ${logId} moved to dead letter: ${failureReason}`);
    return { scheduled: false, failureReason };
  }

  if (newAttempts >= maxAttempts) {
    // Move to dead letter queue
    await prisma.conversionLog.update({
      where: { id: logId },
      data: {
        status: "dead_letter",
        attempts: newAttempts,
        lastAttemptAt: new Date(),
        errorMessage: `[${failureReason}] ${errorMessage}`,
        deadLetteredAt: new Date(),
      },
    });
    console.log(`Conversion ${logId} moved to dead letter after ${newAttempts} attempts`);
    return { scheduled: false, failureReason };
  } else {
    // Schedule retry with exponential backoff
    const nextRetryAt = calculateNextRetryTime(newAttempts);
    await prisma.conversionLog.update({
      where: { id: logId },
      data: {
        status: "retrying",
        attempts: newAttempts,
        lastAttemptAt: new Date(),
        nextRetryAt,
        errorMessage: `[${failureReason}] ${errorMessage}`,
      },
    });
    console.log(`Conversion ${logId} scheduled for retry at ${nextRetryAt.toISOString()} (reason: ${failureReason})`);
    return { scheduled: true, failureReason };
  }
}

/**
 * Process pending retries
 * Should be called periodically (e.g., by a cron job)
 */
export async function processRetries(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
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
        include: {
          pixelConfigs: {
            where: { isActive: true, serverSideEnabled: true },
          },
        },
      },
    },
    take: 50, // Process in batches
  });

  console.log(`Processing ${logsToRetry.length} pending retries`);

  let succeeded = 0;
  let failed = 0;

  for (const log of logsToRetry) {
    try {
      // Find the pixel config for this platform
      const pixelConfig = log.shop.pixelConfigs.find(
        (pc) => pc.platform === log.platform
      );

      if (!pixelConfig) {
        await scheduleRetry(log.id, "Pixel config not found or disabled");
        failed++;
        continue;
      }

      // Get credentials - only from credentialsEncrypted field
      let credentials: PlatformCredentials | null = null;
      
      if (!pixelConfig.credentialsEncrypted) {
        await scheduleRetry(log.id, "No credentials configured - please set up in Settings");
        failed++;
        continue;
      }
      
      try {
        credentials = decryptJson<PlatformCredentials>(
          pixelConfig.credentialsEncrypted
        );
      } catch (decryptError) {
        const errorMsg = decryptError instanceof Error ? decryptError.message : "Unknown error";
        await scheduleRetry(log.id, `Credential decryption failed: ${errorMsg}`);
        failed++;
        continue;
      }

      if (!credentials) {
        await scheduleRetry(log.id, "Decrypted credentials are null");
        failed++;
        continue;
      }

      // Build conversion data
      const conversionData: ConversionData = {
        orderId: log.orderId,
        orderNumber: log.orderNumber,
        value: Number(log.orderValue),
        currency: log.currency,
        // Note: We don't have customer details stored, so we can't retry with enhanced matching
        // This is a trade-off between privacy and retry capability
      };

      // Send to platform
      let result;
      switch (log.platform) {
        case "google":
          result = await sendConversionToGoogle(
            credentials as GoogleCredentials,
            conversionData
          );
          break;
        case "meta":
          result = await sendConversionToMeta(
            credentials as MetaCredentials,
            conversionData
          );
          break;
        case "tiktok":
          result = await sendConversionToTikTok(
            credentials as TikTokCredentials,
            conversionData
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
          platformResponse: result,
          errorMessage: null,
          nextRetryAt: null,
        },
      });
      succeeded++;
      console.log(`Retry succeeded for ${log.id}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await scheduleRetry(log.id, errorMessage);
      failed++;
      console.error(`Retry failed for ${log.id}: ${errorMessage}`);
    }
  }

  return { processed: logsToRetry.length, succeeded, failed };
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

  console.log(`Dead letter ${logId} queued for manual retry`);
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

  console.log(`${result.count} dead letters queued for retry in shop ${shopId}`);
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
