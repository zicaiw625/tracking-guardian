import { jsonWithCors } from "../cors";
import { checkRateLimitAsync, shopScopedIpKeyExtractor } from "~/middleware/rate-limit.server";
import { hashValueSync } from "~/utils/crypto.server";
import { logger, metrics } from "~/utils/logger.server";
import { RATE_LIMIT_CONFIG } from "~/utils/config.server";
import { rejectionTracker } from "../rejection-tracker.server";
import { shouldRecordRejection } from "../stats-sampling";
import type { IngestContext, IngestMiddleware, MiddlewareResult } from "./types";

const PREBODY_RATE_LIMIT = RATE_LIMIT_CONFIG.PIXEL_EVENTS_PREBODY;

export const rateLimitPreBodyMiddleware: IngestMiddleware = async (
  context: IngestContext
): Promise<MiddlewareResult> => {
  const ipKey = shopScopedIpKeyExtractor(
    context.request,
    context.shopDomainHeader !== "unknown" ? context.shopDomainHeader : null
  );
  const ipRateLimit = await checkRateLimitAsync(
    ipKey,
    PREBODY_RATE_LIMIT.maxRequests,
    PREBODY_RATE_LIMIT.windowMs,
    context.isProduction && !context.allowFallback,
    context.allowFallback
  );

  if (context.isProduction && ipRateLimit.usingFallback && !context.allowFallback) {
    if (shouldRecordRejection(context.isProduction, true, "rate_limit_exceeded")) {
      rejectionTracker.record({
        requestId: context.requestId,
        shopDomain: context.shopDomainHeader,
        reason: "rate_limit_exceeded",
        timestamp: Date.now(),
      });
    }
    logger.error("Redis unavailable for rate limiting in production, rejecting request", {
      requestId: context.requestId,
    });
    metrics.rateLimit({
      endpoint: "/ingest-prebody",
      key: ipKey,
      blocked: true,
      remaining: 0,
    });
    metrics.pixelRejection({
      requestId: context.requestId,
      shopDomain: context.shopDomainHeader,
      reason: "rate_limited",
    });
    return {
      continue: false,
      response: jsonWithCors(
        {
          error: "Service Unavailable",
          message: "Rate limiting service unavailable. Please try again later.",
        },
        {
          status: 503,
          request: context.request,
          requestId: context.requestId,
          headers: {
            "Retry-After": "60",
          },
        }
      ),
    };
  }

  if (!ipRateLimit.allowed) {
    if (shouldRecordRejection(context.isProduction, true, "rate_limit_exceeded")) {
      rejectionTracker.record({
        requestId: context.requestId,
        shopDomain: context.shopDomainHeader,
        reason: "rate_limit_exceeded",
        timestamp: Date.now(),
      });
    }
    const ipHash =
      ipKey.endsWith(":untrusted") || ipKey.endsWith(":unknown") || ipKey === "untrusted" || ipKey === "unknown"
        ? ipKey
        : hashValueSync(ipKey).slice(0, 12);
    logger.warn(`IP rate limit exceeded for ingest`, {
      requestId: context.requestId,
      ipHash,
      retryAfter: ipRateLimit.retryAfter,
    });
    metrics.rateLimit({
      endpoint: "/ingest-prebody",
      key: ipHash,
      blocked: true,
      remaining: ipRateLimit.remaining,
    });
    metrics.pixelRejection({
      requestId: context.requestId,
      shopDomain: context.shopDomainHeader,
      reason: "rate_limited",
    });
    return {
      continue: false,
      response: jsonWithCors(
        {
          error: "Too Many Requests",
          message: "Rate limit exceeded. Please try again later.",
          retryAfter: ipRateLimit.retryAfter,
        },
        {
          status: 429,
          request: context.request,
          requestId: context.requestId,
          headers: {
            "Retry-After": String(ipRateLimit.retryAfter || 60),
            "X-RateLimit-Limit": String(PREBODY_RATE_LIMIT.maxRequests),
            "X-RateLimit-Remaining": String(ipRateLimit.remaining || 0),
            "X-RateLimit-Reset": String(Math.ceil((ipRateLimit.resetAt || Date.now()) / 1000)),
          },
        }
      ),
    };
  }

  return { continue: true, context };
};
