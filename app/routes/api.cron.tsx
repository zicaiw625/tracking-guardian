

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
  /curl\/\d/i,
];

function isCrawlerRequest(request: Request): boolean {
  const userAgent = request.headers.get("User-Agent") || "";

  if (!userAgent) {
    return false;
  }

  return BLOCKED_USER_AGENTS.some(pattern => pattern.test(userAgent));
}

function generateRequestId(): string {
  return `cron-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

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

  if (isCrawlerRequest(request)) {
    const userAgent = request.headers.get("User-Agent") || "unknown";
    logger.warn("[SECURITY] Blocked crawler/bot access to cron endpoint", {
      userAgent: userAgent.substring(0, 100),
      method,
    });
    return forbiddenResponse("Access denied");
  }

  cronLogger.info(`Cron execution started${methodSuffix}`);

  const rateLimit = checkRateLimit(request, "cron");
  if (rateLimit.isLimited) {
    cronLogger.warn(`Cron endpoint rate limited${methodSuffix}`);
    return createRateLimitResponse(rateLimit.retryAfter);
  }

  const authError = validateCronAuth(request);
  if (authError) {
    cronLogger.warn(`Cron auth failed${methodSuffix}`);
    return authError;
  }

  const lockResult = await withCronLock("main", requestId, async () => {
    return executeCronTasks(cronLogger);
  });

  const durationMs = Date.now() - startTime;

  if (lockResult.lockSkipped) {
    cronLogger.info(`Cron execution skipped${methodSuffix} - lock held by another instance`, {
      reason: lockResult.reason,
      durationMs,
    });
    return cronSkippedResponse(requestId, durationMs, lockResult.reason);
  }

  if (!lockResult.executed || !lockResult.result) {
    cronLogger.error(`Cron execution failed unexpectedly${methodSuffix}`, undefined, { durationMs });
    return cronErrorResponse(requestId, durationMs, "Execution failed unexpectedly");
  }

  cronLogger.info(`Cron execution completed${methodSuffix}`, { durationMs });
  return cronSuccessResponse({
    requestId,
    durationMs,
    ...(lockResult.result as CronResult),
  });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  return handleCronRequest(request, "POST");
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return handleCronRequest(request, "GET");
};
