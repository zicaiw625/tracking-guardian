/**
 * Cron API Endpoint
 *
 * Handles scheduled cron job execution with:
 * - Rate limiting
 * - Authentication via CRON_SECRET
 * - Replay protection
 * - Distributed locking to prevent concurrent execution
 * - Crawler/bot detection for security
 *
 * Supports both POST (standard) and GET (for simple cron services).
 * 
 * Security Note:
 * GET method is supported for compatibility with simple cron services.
 * Authentication is via Authorization header, not URL parameters.
 * Crawlers and bots are explicitly blocked from triggering execution.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { randomBytes } from "crypto";
import {
  cronSuccessResponse,
  cronSkippedResponse,
  cronErrorResponse,
  forbiddenResponse,
} from "../utils/responses";
import { validateCronAuth, executeCronTasks, type CronResult } from "../cron";
import { checkRateLimit, createRateLimitResponse } from "../utils/rate-limiter";
import { createRequestLogger, logger } from "../utils/logger.server";
import { withCronLock } from "../utils/cron-lock";

// =============================================================================
// Crawler Detection
// =============================================================================

/**
 * Known crawler/bot User-Agent patterns to block.
 * These should never be triggering cron jobs.
 */
const BLOCKED_USER_AGENTS = [
  /googlebot/i,
  /bingbot/i,
  /yandexbot/i,
  /baiduspider/i,
  /duckduckbot/i,
  /slurp/i,
  /facebookexternalhit/i,
  /twitterbot/i,
  /linkedinbot/i,
  /crawler/i,
  /spider/i,
  /bot\b/i,
  /scraper/i,
  /wget/i,
  /curl\/\d/i,  // curl with version number (likely automated)
];

/**
 * Check if the request appears to be from a crawler or bot.
 */
function isCrawlerRequest(request: Request): boolean {
  const userAgent = request.headers.get("User-Agent") || "";
  
  // Empty User-Agent is suspicious for cron endpoints
  if (!userAgent) {
    return false; // Allow - some cron services don't send User-Agent
  }
  
  return BLOCKED_USER_AGENTS.some(pattern => pattern.test(userAgent));
}

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

  // Block crawlers and bots (security measure for GET endpoint)
  if (isCrawlerRequest(request)) {
    const userAgent = request.headers.get("User-Agent") || "unknown";
    logger.warn("[SECURITY] Blocked crawler/bot access to cron endpoint", {
      userAgent: userAgent.substring(0, 100),
      method,
    });
    return forbiddenResponse("Access denied");
  }

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
