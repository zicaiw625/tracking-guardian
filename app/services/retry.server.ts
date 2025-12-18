/**
 * Retry Service for Server-Side Conversions
 * 
 * Implements:
 * - Exponential backoff retry strategy
 * - Dead letter queue for permanently failed conversions
 * - Manual retry capability for dead letter items
 */

import prisma from "../db.server";
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
 */
export async function scheduleRetry(
  logId: string,
  errorMessage: string
): Promise<void> {
  const log = await prisma.conversionLog.findUnique({
    where: { id: logId },
  });

  if (!log) return;

  const newAttempts = log.attempts + 1;
  const maxAttempts = log.maxAttempts || MAX_ATTEMPTS;

  if (newAttempts >= maxAttempts) {
    // Move to dead letter queue
    await prisma.conversionLog.update({
      where: { id: logId },
      data: {
        status: "dead_letter",
        attempts: newAttempts,
        lastAttemptAt: new Date(),
        errorMessage,
        deadLetteredAt: new Date(),
      },
    });
    console.log(`Conversion ${logId} moved to dead letter after ${newAttempts} attempts`);
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
        errorMessage,
      },
    });
    console.log(`Conversion ${logId} scheduled for retry at ${nextRetryAt.toISOString()}`);
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

      // Get credentials
      let credentials: PlatformCredentials | null = null;
      if (pixelConfig.credentialsEncrypted) {
        credentials = decryptJson<PlatformCredentials>(
          pixelConfig.credentialsEncrypted
        );
      }

      if (!credentials) {
        await scheduleRetry(log.id, "No valid credentials found");
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
