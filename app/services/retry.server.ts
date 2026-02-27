import type {
  PlatformError,
} from "../types";
import prisma from "../db.server";

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
  if (currentAttempt >= maxAttempts) {
    return false;
  }
  if (error.type === "rate_limited" || error.type === "timeout" || error.type === "network_error") {
    return true;
  }
  if (error.type === "server_error" && error.statusCode && error.statusCode >= 500) {
    return true;
  }
  return false;
}

export function getRetryDelay(error: PlatformError, attempt: number): number {
  if (error.retryAfter) {
    return error.retryAfter * 1000;
  }
  const baseDelay = 60 * 1000;
  const maxDelay = 2 * 60 * 60 * 1000;
  return Math.min(baseDelay * Math.pow(5, attempt - 1), maxDelay);
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


export async function checkTokenExpirationIssues(_shopId: string): Promise<{
  hasIssues: boolean;
  affectedPlatforms: string[];
}> {
  const tokenPatterns = [
    "401",
    "unauthorized",
    "token expired",
    "invalid token",
    "access token",
  ];

  const failedJobs = await prisma.eventDispatchJob.findMany({
    where: {
      status: "FAILED",
      InternalEvent: {
        shopId: _shopId,
      },
      OR: tokenPatterns.map((pattern) => ({
        last_error: {
          contains: pattern,
          mode: "insensitive",
        },
      })),
    },
    select: {
      destination: true,
    },
  });

  const affectedPlatforms = Array.from(new Set(failedJobs.map((job) => job.destination)));
  return {
    hasIssues: affectedPlatforms.length > 0,
    affectedPlatforms,
  };
}

export async function getRetryStats(_shopId: string): Promise<{
  pending: number;
  retrying: number;
  deadLetter: number;
  sent: number;
  failed: number;
}> {
  const [pending, retrying, deadLetter, sent, failed] = await Promise.all([
    prisma.eventDispatchJob.count({
      where: {
        status: "PENDING",
        InternalEvent: { shopId: _shopId },
      },
    }),
    prisma.eventDispatchJob.count({
      where: {
        status: "PROCESSING",
        InternalEvent: { shopId: _shopId },
      },
    }),
    prisma.eventDispatchJob.count({
      where: {
        status: "FAILED",
        attempts: { gte: 4 },
        InternalEvent: { shopId: _shopId },
      },
    }),
    prisma.eventDispatchJob.count({
      where: {
        status: "SENT",
        InternalEvent: { shopId: _shopId },
      },
    }),
    prisma.eventDispatchJob.count({
      where: {
        status: "FAILED",
        InternalEvent: { shopId: _shopId },
      },
    }),
  ]);

  return {
    pending,
    retrying,
    deadLetter,
    sent,
    failed,
  };
}
