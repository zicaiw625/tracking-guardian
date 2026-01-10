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
  logger.debug(`scheduleRetry called but conversionLog table no longer exists`, { logId, errorMessage });
  return { scheduled: false, failureReason: "unknown" };
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
  logger.debug(`processPendingConversions called but conversionLog table no longer exists`);
  return {
    processed: 0,
    succeeded: 0,
    failed: 0,
    limitExceeded: 0,
  };
}

export async function processRetries(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  limitExceeded: number;
}> {
  logger.debug(`processRetries called but conversionLog table no longer exists`);
  return {
    processed: 0,
    succeeded: 0,
    failed: 0,
    limitExceeded: 0,
  };
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
  return [];
}

export async function retryDeadLetter(logId: string): Promise<boolean> {
  logger.debug(`retryDeadLetter called but conversionLog table no longer exists`, { logId });
  return false;
}

export async function retryAllDeadLetters(shopId: string): Promise<number> {
  logger.debug(`retryAllDeadLetters called but conversionLog table no longer exists`, { shopId });
  return 0;
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
  logger.debug(`getRetryStats called but conversionLog table no longer exists`, { shopId });
  return {
    pending: 0,
    retrying: 0,
    deadLetter: 0,
    sent: 0,
    failed: 0,
  };
}
