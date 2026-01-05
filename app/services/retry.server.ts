

import prisma from "../db.server";
import { Prisma } from "@prisma/client";
import type { PlatformError ,
  ConversionData,
  PlatformCredentials,
  ConversionApiResponse,
} from "../types";
import {
  calculateBackoff,
  shouldRetry as shouldRetryPlatform,
} from "./platforms/base-platform.service";
import { checkBillingGate, incrementMonthlyUsage, type PlanId } from "./billing.server";
import { decryptCredentials } from "./credentials.server";
import { sendConversionToPlatform } from "./platforms";
import { generateEventId } from "../utils/crypto.server";
import { logger } from "../utils/logger.server";
import { toJsonInput } from "../utils/prisma-json";
import type { PlatformSendResult } from "./platforms/interface";

export { processConversionJobs, calculateNextRetryTime } from "./conversion-job.server";

export { decryptCredentials } from "./credentials.server";

export type FailureReason =
  | "token_expired"
  | "rate_limited"
  | "platform_error"
  | "validation_error"
  | "network_error"
  | "config_error"
  | "unknown";

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
    case "quota_exceeded":
      return "config_error";
    default:
      return "unknown";
  }
}

export function shouldRetryFromPlatformError(
  error: PlatformError,
  currentAttempt: number,
  maxAttempts: number
): boolean {
  return shouldRetryPlatform(error, currentAttempt, maxAttempts);
}

export function getRetryDelay(error: PlatformError, attempt: number): number {
  if (error.retryAfter) {
    return error.retryAfter * 1000;
  }
  return calculateBackoff(attempt);
}

export function classifyFailureReason(errorMessage: string | null): FailureReason {
  if (!errorMessage) return "unknown";

  const lowerError = errorMessage.toLowerCase();

  if (
    lowerError.includes("401") ||
    lowerError.includes("unauthorized") ||
    lowerError.includes("token expired") ||
    lowerError.includes("invalid token") ||
    lowerError.includes("access token")
  ) {
    return "token_expired";
  }

  if (
    lowerError.includes("429") ||
    lowerError.includes("rate limit") ||
    lowerError.includes("too many requests")
  ) {
    return "rate_limited";
  }

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

  if (
    lowerError.includes("timeout") ||
    lowerError.includes("network") ||
    lowerError.includes("econnrefused") ||
    lowerError.includes("enotfound") ||
    lowerError.includes("fetch failed")
  ) {
    return "network_error";
  }

  if (
    lowerError.includes("400") ||
    lowerError.includes("invalid") ||
    lowerError.includes("validation") ||
    lowerError.includes("missing required")
  ) {
    return "validation_error";
  }

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

export function shouldNotifyImmediately(reason: FailureReason): boolean {
  return reason === "token_expired" || reason === "config_error";
}

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 60 * 1000;
const MAX_DELAY_MS = 2 * 60 * 60 * 1000;

function calculateNextRetryTimeForLog(attempts: number): Date {
  const delayMs = Math.min(BASE_DELAY_MS * Math.pow(5, attempts - 1), MAX_DELAY_MS);
  const jitter = delayMs * 0.1 * Math.random();
  return new Date(Date.now() + delayMs + jitter);
}

export async function scheduleRetry(
  logId: string,
  errorMessage: string
): Promise<{ scheduled: boolean; failureReason: FailureReason }> {
  const log = await prisma.conversionLog.findUnique({
    where: { id: logId },
  });

  if (!log) return { scheduled: false, failureReason: "unknown" };

  const failureReason = classifyFailureReason(errorMessage);
  const currentAttempts = log.attempts;
  const maxAttempts = log.maxAttempts || MAX_ATTEMPTS;

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
  }

  const nextRetryAt = calculateNextRetryTimeForLog(currentAttempts);
  await prisma.conversionLog.update({
    where: { id: logId },
    data: {
      status: "retrying",
      lastAttemptAt: new Date(),
      nextRetryAt,
      errorMessage: `[${failureReason}] ${errorMessage}`,
    },
  });

  logger.info(
    `Conversion ${logId} scheduled for retry at ${nextRetryAt.toISOString()} ` +
      `(attempt ${currentAttempts}, reason: ${failureReason})`
  );

  return { scheduled: true, failureReason };
}

interface PlatformSendResultInternal {
  success: boolean;
  response?: ConversionApiResponse;
  error?: string;
}

async function sendToPlatformFromLog(
  platform: string,
  credentials: PlatformCredentials,
  conversionData: ConversionData,
  eventId: string
): Promise<PlatformSendResultInternal> {
  const result = await sendConversionToPlatform(
    platform,
    credentials,
    conversionData,
    eventId
  );

  if (!result.success) {
    throw new Error(result.error?.message || "Platform send failed");
  }

  return {
    success: true,
    response: result.response,
  };
}

export async function processPendingConversions(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  limitExceeded: number;
}> {
  const pendingLogs = await prisma.conversionLog.findMany({
    where: {
      status: "pending",
      attempts: 0,
    },
    include: {
      Shop: {
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
            },
          },
        },
      },
    },
    take: 100,
    orderBy: { createdAt: "asc" },
  });

  logger.info(`Processing ${pendingLogs.length} pending conversions`);

  let succeeded = 0;
  let failed = 0;
  let limitExceeded = 0;

  for (const log of pendingLogs) {
    try {

      const billingCheck = await checkBillingGate(
        log.shopId,
        (log.Shop.plan || "free") as PlanId
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

      const pixelConfig = log.Shop.pixelConfigs.find((pc) => pc.platform === log.platform);
      if (!pixelConfig) {
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

      const credResult = decryptCredentials(pixelConfig, log.platform);
      if (!credResult.ok) {
        await prisma.conversionLog.update({
          where: { id: log.id },
          data: {
            status: "failed",
            attempts: 1,
            lastAttemptAt: new Date(),
            errorMessage: `No credentials configured: ${credResult.error.message}`,
          },
        });
        failed++;
        continue;
      }
      const credentials = credResult.value.credentials;

      const eventId = log.eventId || generateEventId(log.orderId, log.eventType, log.Shop.shopDomain);
      const conversionData: ConversionData = {
        orderId: log.orderId,
        orderNumber: log.orderNumber,
        value: Number(log.orderValue),
        currency: log.currency,
      };

      const result = await sendToPlatformFromLog(log.platform, credentials, conversionData, eventId);

      await prisma.conversionLog.update({
        where: { id: log.id },
        data: {
          status: "sent",
          serverSideSent: true,
          sentAt: new Date(),
          platformResponse: result.response ? toJsonInput(result.response) : Prisma.DbNull,
          errorMessage: null,
          attempts: 1,
          lastAttemptAt: new Date(),
        },
      });

      await incrementMonthlyUsage(log.shopId, log.orderId);
      succeeded++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
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

export async function processRetries(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  limitExceeded: number;
}> {
  const now = new Date();

  const logsToRetry = await prisma.conversionLog.findMany({
    where: {
      status: "retrying",
      nextRetryAt: { lte: now },
    },
    include: {
      Shop: {
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
    take: 50,
  });

  logger.info(`Processing ${logsToRetry.length} pending retries`);

  let succeeded = 0;
  let failed = 0;
  let limitExceeded = 0;

  for (const log of logsToRetry) {
    try {

      const billingCheck = await checkBillingGate(
        log.shopId,
        (log.Shop.plan || "free") as PlanId
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

      const pixelConfig = log.Shop.pixelConfigs.find((pc) => pc.platform === log.platform);
      if (!pixelConfig) {
        await scheduleRetry(log.id, "Pixel config not found or disabled");
        failed++;
        continue;
      }

      const credResult2 = decryptCredentials(pixelConfig, log.platform);
      if (!credResult2.ok) {
        try {
          await prisma.conversionLog.update({
            where: { id: log.id },
            data: { attempts: { increment: 1 } },
          });
          await scheduleRetry(log.id, `No credentials configured: ${credResult2.error.message}`);
        } catch (updateError) {
          logger.error(`Failed to update conversion log ${log.id}`, updateError);
        }
        failed++;
        continue;
      }
      const credentials = credResult2.value.credentials;

      const eventId = log.eventId || generateEventId(log.orderId, log.eventType, log.Shop.shopDomain);
      const conversionData: ConversionData = {
        orderId: log.orderId,
        orderNumber: log.orderNumber,
        value: Number(log.orderValue),
        currency: log.currency,
      };

      const result = await sendToPlatformFromLog(log.platform, credentials, conversionData, eventId);

      await prisma.conversionLog.update({
        where: { id: log.id },
        data: {
          status: "sent",
          serverSideSent: true,
          sentAt: new Date(),
          platformResponse: result.response ? toJsonInput(result.response) : Prisma.DbNull,
          errorMessage: null,
          nextRetryAt: null,
          attempts: { increment: 1 },
        },
      });

      await incrementMonthlyUsage(log.shopId, log.orderId);
      succeeded++;
      logger.info(`Retry succeeded for ${log.id}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
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

export async function getDeadLetterItems(
  shopId: string,
  limit = 50
): Promise<
  Array<{
    id: string;
    orderId: string;
    orderNumber: string | null;
    platform: string;
    errorMessage: string | null;
    attempts: number;
    deadLetteredAt: Date | null;
  }>
> {
  return prisma.conversionLog.findMany({
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
}

export async function retryDeadLetter(logId: string): Promise<boolean> {
  const log = await prisma.conversionLog.findUnique({
    where: { id: logId },
  });

  if (!log || log.status !== "dead_letter") {
    return false;
  }

  await prisma.conversionLog.update({
    where: { id: logId },
    data: {
      status: "retrying",
      attempts: 0,
      maxAttempts: 3,
      nextRetryAt: new Date(),
      manuallyRetried: true,
      errorMessage: null,
    },
  });

  logger.info(`Dead letter ${logId} queued for manual retry`);
  return true;
}

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

export async function checkTokenExpirationIssues(shopId: string): Promise<{
  hasIssues: boolean;
  affectedPlatforms: string[];
}> {

  const oneDayAgo = new Date();
  oneDayAgo.setUTCDate(oneDayAgo.getUTCDate() - 1);

  const tokenExpiredLogs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      status: { in: ["failed", "dead_letter"] },
      errorMessage: { contains: "[token_expired]" },
      lastAttemptAt: { gte: oneDayAgo },
    },
    select: { platform: true },
    distinct: ["platform"],
  });

  const affectedPlatforms = tokenExpiredLogs.map((l) => l.platform);
  return {
    hasIssues: affectedPlatforms.length > 0,
    affectedPlatforms,
  };
}

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
