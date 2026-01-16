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
import { generateEventId as generateStableEventId } from "./capi-dedup.server";
import { logger } from "../utils/logger.server";
import { toJsonInput } from "../utils/prisma-json";
import type { PlatformSendResult } from "./platforms/interface";
import { ConversionLogStatus } from "../types/enums";

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
  try {
    const log = await prisma.conversionLog.findUnique({
      where: { id: logId },
      select: { attempts: true, maxAttempts: true },
    });
    
    if (!log) {
      logger.warn(`ConversionLog ${logId} not found for retry scheduling`);
      return { scheduled: false, failureReason: "unknown" };
    }
    
    const failureReason = classifyFailureReason(errorMessage);
    const shouldRetry = log.attempts < log.maxAttempts;
    
    if (!shouldRetry) {
      await prisma.conversionLog.update({
        where: { id: logId },
        data: {
          status: ConversionLogStatus.DEAD_LETTER,
          deadLetteredAt: new Date(),
          errorMessage,
          lastAttemptAt: new Date(),
        },
      });
      return { scheduled: false, failureReason };
    }
    
    const nextRetryAt = calculateNextRetryTimeForLog(log.attempts + 1);
    await prisma.conversionLog.update({
      where: { id: logId },
      data: {
        status: ConversionLogStatus.RETRYING,
        attempts: { increment: 1 },
        nextRetryAt,
        errorMessage,
        lastAttemptAt: new Date(),
      },
    });
    
    return { scheduled: true, failureReason };
  } catch (error) {
    logger.error(`Failed to schedule retry for log ${logId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return { scheduled: false, failureReason: "unknown" };
  }
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
  const limit = 50;
  const logs = await prisma.conversionLog.findMany({
    where: {
      status: ConversionLogStatus.PENDING,
    },
    take: limit,
    orderBy: { createdAt: "asc" },
    include: {
      Shop: {
        select: {
          id: true,
          plan: true,
          shopDomain: true,
          pixelConfigs: {
            where: { serverSideEnabled: true },
            select: {
              platform: true,
              credentialsEncrypted: true,
              credentials_legacy: true,
            },
          },
        },
      },
    },
  });
  
  if (logs.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, limitExceeded: 0 };
  }
  
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let limitExceeded = 0;
  
  for (const log of logs) {
    try {
      const gateResult = await checkBillingGate(log.shopId, (log.Shop.plan || "free") as PlanId);
      if (!gateResult.allowed) {
        await prisma.conversionLog.update({
          where: { id: log.id },
          data: {
            status: "limit_exceeded",
            errorMessage: gateResult.reason,
          },
        });
        limitExceeded++;
        processed++;
        continue;
      }
      
      const config = log.Shop.pixelConfigs.find(c => c.platform === log.platform);
      if (!config) {
        await prisma.conversionLog.update({
          where: { id: log.id },
          data: {
            status: ConversionLogStatus.FAILED,
            errorMessage: `No server-side config found for platform ${log.platform}`,
          },
        });
        failed++;
        processed++;
        continue;
      }
      
      const credentialsResult = await decryptCredentials({
        credentialsEncrypted: config.credentialsEncrypted,
        credentials_legacy: config.credentials_legacy,
        platform: log.platform,
      });
      
      if (!credentialsResult.ok) {
        await scheduleRetry(log.id, credentialsResult.error.message);
        failed++;
        processed++;
        continue;
      }
      
      const conversionData: ConversionData = {
        orderId: log.orderId,
        orderNumber: log.orderNumber,
        value: Number(log.orderValue),
        currency: log.currency,
      };
      
      const eventId = log.eventId || generateStableEventId(
        log.orderId,
        log.eventType,
        log.Shop.shopDomain,
        log.platform
      );
      const sendResult = await sendConversionToPlatform(
        log.platform,
        credentialsResult.value.credentials,
        conversionData,
        eventId
      );
      
      if (sendResult.success) {
        await incrementMonthlyUsage(log.shopId, log.orderId);
        await prisma.conversionLog.update({
          where: { id: log.id },
          data: {
            status: ConversionLogStatus.SENT,
            sentAt: new Date(),
            serverSideSent: true,
            platformResponse: toJsonInput(sendResult.response),
          },
        });
        succeeded++;
      } else {
        await scheduleRetry(log.id, sendResult.error?.message || "Platform send failed");
        failed++;
      }
      processed++;
    } catch (error) {
      logger.error(`Error processing pending conversion log ${log.id}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      await scheduleRetry(log.id, error instanceof Error ? error.message : String(error));
      failed++;
      processed++;
    }
  }
  
  return { processed, succeeded, failed, limitExceeded };
}

export async function processRetries(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  limitExceeded: number;
}> {
  const limit = 50;
  const now = new Date();
  const logs = await prisma.conversionLog.findMany({
    where: {
      status: ConversionLogStatus.RETRYING,
      nextRetryAt: { lte: now },
    },
    take: limit,
    orderBy: { nextRetryAt: "asc" },
    include: {
      Shop: {
        select: {
          id: true,
          plan: true,
          shopDomain: true,
          pixelConfigs: {
            where: { serverSideEnabled: true },
            select: {
              platform: true,
              credentialsEncrypted: true,
              credentials_legacy: true,
            },
          },
        },
      },
    },
  });
  
  if (logs.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, limitExceeded: 0 };
  }
  
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let limitExceeded = 0;
  
  for (const log of logs) {
    try {
      const gateResult = await checkBillingGate(log.shopId, (log.Shop.plan || "free") as PlanId);
      if (!gateResult.allowed) {
        await prisma.conversionLog.update({
          where: { id: log.id },
          data: {
            status: "limit_exceeded",
            errorMessage: gateResult.reason,
          },
        });
        limitExceeded++;
        processed++;
        continue;
      }
      
      const config = log.Shop.pixelConfigs.find(c => c.platform === log.platform);
      if (!config) {
        await prisma.conversionLog.update({
          where: { id: log.id },
          data: {
            status: ConversionLogStatus.FAILED,
            errorMessage: `No server-side config found for platform ${log.platform}`,
          },
        });
        failed++;
        processed++;
        continue;
      }
      
      const credentialsResult = await decryptCredentials({
        credentialsEncrypted: config.credentialsEncrypted,
        credentials_legacy: config.credentials_legacy,
        platform: log.platform,
      });
      
      if (!credentialsResult.ok) {
        await scheduleRetry(log.id, credentialsResult.error.message);
        failed++;
        processed++;
        continue;
      }
      
      const conversionData: ConversionData = {
        orderId: log.orderId,
        orderNumber: log.orderNumber,
        value: Number(log.orderValue),
        currency: log.currency,
      };
      
      const eventId = log.eventId || generateStableEventId(
        log.orderId,
        log.eventType,
        log.Shop.shopDomain,
        log.platform
      );
      const sendResult = await sendConversionToPlatform(
        log.platform,
        credentialsResult.value.credentials,
        conversionData,
        eventId
      );
      
      if (sendResult.success) {
        await incrementMonthlyUsage(log.shopId, log.orderId);
        await prisma.conversionLog.update({
          where: { id: log.id },
          data: {
            status: ConversionLogStatus.SENT,
            sentAt: new Date(),
            serverSideSent: true,
            platformResponse: toJsonInput(sendResult.response),
          },
        });
        succeeded++;
      } else {
        await scheduleRetry(log.id, sendResult.error?.message || "Platform send failed");
        failed++;
      }
      processed++;
    } catch (error) {
      logger.error(`Error processing retry for conversion log ${log.id}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      await scheduleRetry(log.id, error instanceof Error ? error.message : String(error));
      failed++;
      processed++;
    }
  }
  
  return { processed, succeeded, failed, limitExceeded };
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
  const logs = await prisma.conversionLog.findMany({
      where: {
        shopId,
        status: ConversionLogStatus.DEAD_LETTER,
      },
    take: limit,
    orderBy: { deadLetteredAt: "desc" },
    select: {
      id: true,
      orderId: true,
      orderNumber: true,
      platform: true,
      errorMessage: true,
      attempts: true,
      deadLetteredAt: true,
    },
  });
  
  return logs;
}

export async function retryDeadLetter(logId: string): Promise<boolean> {
  try {
    const log = await prisma.conversionLog.findUnique({
      where: { id: logId },
      select: { status: true, maxAttempts: true, attempts: true },
    });
    
    if (!log || log.status !== ConversionLogStatus.DEAD_LETTER) {
      return false;
    }
    
    const nextRetryAt = calculateNextRetryTimeForLog(0);
    await prisma.conversionLog.update({
      where: { id: logId },
      data: {
        status: ConversionLogStatus.RETRYING,
        attempts: 0,
        nextRetryAt,
        deadLetteredAt: null,
        manuallyRetried: true,
        errorMessage: null,
      },
    });
    
    return true;
  } catch (error) {
    logger.error(`Failed to retry dead letter log ${logId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function retryAllDeadLetters(shopId: string): Promise<number> {
  try {
    const nextRetryAt = calculateNextRetryTimeForLog(0);
    const result = await prisma.conversionLog.updateMany({
      where: {
        shopId,
        status: ConversionLogStatus.DEAD_LETTER,
      },
      data: {
        status: ConversionLogStatus.RETRYING,
        attempts: 0,
        nextRetryAt,
        deadLetteredAt: null,
        manuallyRetried: true,
        errorMessage: null,
      },
    });
    
    return result.count;
  } catch (error) {
    logger.error(`Failed to retry all dead letters for shop ${shopId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

export async function checkTokenExpirationIssues(shopId: string): Promise<{
  hasIssues: boolean;
  affectedPlatforms: string[];
}> {
  return {
    hasIssues: false,
    affectedPlatforms: [],
  };
}

export async function getRetryStats(shopId: string): Promise<{
  pending: number;
  retrying: number;
  deadLetter: number;
  sent: number;
  failed: number;
}> {
  try {
    const [pending, retrying, deadLetter, sent, failed] = await Promise.all([
      prisma.conversionLog.count({
        where: { shopId, status: ConversionLogStatus.PENDING },
      }),
      prisma.conversionLog.count({
        where: { shopId, status: ConversionLogStatus.RETRYING },
      }),
      prisma.conversionLog.count({
        where: { shopId, status: ConversionLogStatus.DEAD_LETTER },
      }),
      prisma.conversionLog.count({
        where: { shopId, status: ConversionLogStatus.SENT },
      }),
      prisma.conversionLog.count({
        where: { shopId, status: ConversionLogStatus.FAILED },
      }),
    ]);
    
    return {
      pending,
      retrying,
      deadLetter,
      sent,
      failed,
    };
  } catch (error) {
    logger.error(`Failed to get retry stats for shop ${shopId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      pending: 0,
      retrying: 0,
      deadLetter: 0,
      sent: 0,
      failed: 0,
    };
  }
}
