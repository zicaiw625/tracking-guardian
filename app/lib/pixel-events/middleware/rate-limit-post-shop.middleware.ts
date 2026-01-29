import { jsonWithCors } from "../cors";
import { checkRateLimitAsync, shopDomainIpKeyExtractor } from "~/middleware/rate-limit.server";
import { logger } from "~/utils/logger.server";
import { RATE_LIMIT_CONFIG } from "~/utils/config.server";
import { rejectionTracker } from "../rejection-tracker.server";
import { shouldRecordRejection } from "../stats-sampling";
import type { IngestContext, IngestMiddleware, MiddlewareResult } from "./types";

const INGEST_RATE_LIMIT = RATE_LIMIT_CONFIG.PIXEL_EVENTS;

export const rateLimitPostShopMiddleware: IngestMiddleware = async (
  context: IngestContext
): Promise<MiddlewareResult> => {
  if (!context.shop) {
    return { continue: true, context };
  }

  const rateLimitKey = shopDomainIpKeyExtractor(context.request);
  const rateLimit = await checkRateLimitAsync(
    rateLimitKey,
    INGEST_RATE_LIMIT.maxRequests,
    INGEST_RATE_LIMIT.windowMs,
    context.isProduction && !context.allowFallback,
    context.allowFallback
  );

  if (context.isProduction && rateLimit.usingFallback && !context.allowFallback) {
    if (shouldRecordRejection(context.isProduction, true, "rate_limit_exceeded")) {
      rejectionTracker.record({
        requestId: context.requestId,
        shopDomain: context.shopDomain!,
        reason: "rate_limit_exceeded",
        timestamp: Date.now(),
      });
    }
    logger.error("Redis unavailable for rate limiting in production, rejecting request", {
      requestId: context.requestId,
      shopDomain: context.shopDomain!,
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

  if (!rateLimit.allowed) {
    if (shouldRecordRejection(context.isProduction, true, "rate_limit_exceeded")) {
      rejectionTracker.record({
        requestId: context.requestId,
        shopDomain: context.shopDomain!,
        reason: "rate_limit_exceeded",
        timestamp: Date.now(),
      });
    }
    logger.warn(`Rate limit exceeded for ingest`, {
      requestId: context.requestId,
      shopDomain: context.shopDomain!,
      retryAfter: rateLimit.retryAfter,
      remaining: rateLimit.remaining,
    });
    return {
      continue: false,
      response: jsonWithCors(
        {
          error: "Too Many Requests",
          message: "Rate limit exceeded. Please try again later.",
          retryAfter: rateLimit.retryAfter,
        },
        {
          status: 429,
          request: context.request,
          requestId: context.requestId,
          headers: {
            "Retry-After": String(rateLimit.retryAfter || 60),
            "X-RateLimit-Limit": String(INGEST_RATE_LIMIT.maxRequests),
            "X-RateLimit-Remaining": String(rateLimit.remaining || 0),
            "X-RateLimit-Reset": String(Math.ceil((rateLimit.resetAt || Date.now()) / 1000)),
          },
        }
      ),
    };
  }

  return { continue: true, context };
};
