/**
 * Cron API Endpoint
 *
 * Handles scheduled cron job execution with:
 * - Rate limiting
 * - Authentication via CRON_SECRET
 * - Replay protection
 * - Distributed locking to prevent concurrent execution
 *
 * Supports both POST (standard) and GET (for simple cron services).
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { randomBytes } from "crypto";
import {
  cronSuccessResponse,
  cronSkippedResponse,
  cronErrorResponse,
} from "../utils/responses";
import { validateCronAuth, executeCronTasks, type CronResult } from "../cron";
import { checkRateLimit, createRateLimitResponse } from "../utils/rate-limiter";
import { createRequestLogger } from "../utils/logger.server";
import { withCronLock } from "../utils/cron-lock";

// =============================================================================
// Request ID Generation
// =============================================================================

/**
 * Generate a unique request ID for cron execution tracking.
 */
function generateRequestId(): string {
  return `cron-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

// =============================================================================
// Request Handler
// =============================================================================

/**
 * Handle cron request with authentication, rate limiting, and locking.
 *
 * @param request - Incoming HTTP request
 * @param method - HTTP method (POST or GET)
 * @returns Response with cron execution result
 */
async function handleCronRequest(
  request: Request,
  method: "POST" | "GET"
): Promise<Response> {
  const methodSuffix = method === "GET" ? " (GET)" : "";
  const requestId = generateRequestId();
  const cronLogger = createRequestLogger(requestId, {
    component: "cron",
    ...(method === "GET" && { method: "GET" }),
  });
  const startTime = Date.now();

  cronLogger.info(`Cron execution started${methodSuffix}`);

  // Check rate limit
  const rateLimit = checkRateLimit(request, "cron");
  if (rateLimit.isLimited) {
    cronLogger.warn(`Cron endpoint rate limited${methodSuffix}`);
    return createRateLimitResponse(rateLimit.retryAfter);
  }

  // Validate authentication
  const authError = validateCronAuth(request);
  if (authError) {
    cronLogger.warn(`Cron auth failed${methodSuffix}`);
    return authError;
  }

  // Execute with distributed lock
  const lockResult = await withCronLock("main", requestId, async () => {
    return executeCronTasks(cronLogger);
  });

  const durationMs = Date.now() - startTime;

  // Handle lock skip
  if (lockResult.lockSkipped) {
    cronLogger.info(`Cron execution skipped${methodSuffix} - lock held by another instance`, {
      reason: lockResult.reason,
      durationMs,
    });
    return cronSkippedResponse(requestId, durationMs, lockResult.reason);
  }

  // Handle execution failure
  if (!lockResult.executed || !lockResult.result) {
    cronLogger.error(`Cron execution failed unexpectedly${methodSuffix}`, undefined, { durationMs });
    return cronErrorResponse(requestId, durationMs, "Execution failed unexpectedly");
  }

  // Success
  cronLogger.info(`Cron execution completed${methodSuffix}`, { durationMs });
  return cronSuccessResponse({
    requestId,
    durationMs,
    ...(lockResult.result as CronResult),
  });
}

// =============================================================================
// Route Handlers
// =============================================================================

/**
 * POST handler for cron endpoint (standard method).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  return handleCronRequest(request, "POST");
};

/**
 * GET handler for cron endpoint (for simple cron services).
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  return handleCronRequest(request, "GET");
};
