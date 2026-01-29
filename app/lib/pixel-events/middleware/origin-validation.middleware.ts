import { emptyResponseWithCors, jsonWithCors } from "../cors";
import { validatePixelOriginPreBody, validatePixelOriginForShop, buildShopAllowedDomains, trackNullOriginRequest } from "~/utils/origin-validation.server";
import { trackAnomaly } from "~/utils/rate-limiter";
import { logger, metrics } from "~/utils/logger.server";
import { rejectionTracker } from "../rejection-tracker.server";
import { shouldRecordRejection } from "../stats-sampling";
import type { IngestContext, IngestMiddleware, MiddlewareResult } from "./types";

function safeHost(u: string | null): string | null {
  try { return u ? new URL(u).hostname : null; } catch { return null; }
}

export const originValidationPreBodyMiddleware: IngestMiddleware = async (
  context: IngestContext
): Promise<MiddlewareResult> => {
  if (!context.originHeaderPresent && context.isProduction) {
    const referer = context.request.headers.get("Referer");
    if (!referer) {
      logger.warn("Origin header missing in production (no Origin, no Referer) - continue to HMAC validation", {
        shopDomain: context.shopDomainHeader,
      });
    }
  }

  const preBodyValidation = validatePixelOriginPreBody(
    context.origin,
    context.hasSignatureHeader,
    context.originHeaderPresent
  );

  if (!preBodyValidation.valid) {
    const anomalyCheck = trackAnomaly(context.shopDomainHeader, "invalid_origin");
    if (anomalyCheck.shouldBlock) {
      logger.warn(`Anomaly threshold reached for ${context.shopDomainHeader}: ${anomalyCheck.reason}`);
    }
    if (preBodyValidation.shouldLog) {
      logger.warn("Origin validation warning at Stage 1 in /ingest", {
        originHost: safeHost(context.origin),
        reason: preBodyValidation.reason,
      });
    }
    if (preBodyValidation.shouldReject && (context.isProduction || !context.hasSignatureHeader || context.strictOrigin)) {
      if (shouldRecordRejection(context.isProduction, anomalyCheck.shouldBlock, "origin_not_allowlisted")) {
        rejectionTracker.record({
          requestId: context.requestId,
          shopDomain: context.shopDomainHeader,
          reason: "origin_not_allowlisted",
          originType: preBodyValidation.reason,
          timestamp: Date.now(),
        });
      }
      metrics.pixelRejection({
        requestId: context.requestId,
        shopDomain: context.shopDomainHeader,
        reason: preBodyValidation.reason as "invalid_origin" | "invalid_origin_protocol",
        originType: preBodyValidation.reason,
      });
      return {
        continue: false,
        response: jsonWithCors(
          { error: "Invalid request" },
          { status: 403, request: context.request, requestId: context.requestId }
        ),
      };
    }
  }

  if (context.isNullOrigin) {
    trackNullOriginRequest();
  }

  return { continue: true, context };
};

export const originValidationPostShopMiddleware: IngestMiddleware = async (
  context: IngestContext
): Promise<MiddlewareResult> => {
  if (!context.shop) {
    return { continue: true, context };
  }

  const referer = context.request.headers.get("Referer");
  const shopOriginValidation = validatePixelOriginForShop(
    context.origin,
    context.shopAllowedDomains,
    {
      referer,
      shopDomain: context.shop.shopDomain,
      hasSignatureHeaderOrHMAC: context.hasSignatureHeader,
    }
  );

  if (!shopOriginValidation.valid && shopOriginValidation.shouldReject) {
    const anomalyCheck = trackAnomaly(context.shop.shopDomain, "invalid_origin");
    if (anomalyCheck.shouldBlock) {
      logger.warn(`Anomaly threshold reached for ${context.shop.shopDomain}: ${anomalyCheck.reason}`);
    }
    logger.warn("Origin validation warning at Stage 2 in /ingest", {
      shopDomain: context.shop.shopDomain,
      originHost: safeHost(context.origin),
      refererHost: safeHost(referer),
      reason: shopOriginValidation.reason,
    });
    if (context.hasSignatureHeader && !context.strictOrigin && !context.isProduction) {
      logger.warn("Signed ingest request allowed despite origin rejection", {
        shopDomain: context.shop.shopDomain,
        originHost: safeHost(context.origin),
        reason: shopOriginValidation.reason,
      });
    }
    if (!context.hasSignatureHeader || context.strictOrigin || context.isProduction) {
      if (shouldRecordRejection(context.isProduction, anomalyCheck.shouldBlock, "origin_not_allowlisted")) {
        rejectionTracker.record({
          requestId: context.requestId,
          shopDomain: context.shop.shopDomain,
          reason: "origin_not_allowlisted",
          originType: shopOriginValidation.reason,
          timestamp: Date.now(),
        });
      }
      metrics.pixelRejection({
        requestId: context.requestId,
        shopDomain: context.shop.shopDomain,
        reason: "origin_not_allowlisted",
        originType: shopOriginValidation.reason,
      });
      if (context.isProduction) {
        return {
          continue: false,
          response: jsonWithCors(
            { error: "Invalid request" },
            { status: 403, request: context.request, requestId: context.requestId }
          ),
        };
      }
      return {
        continue: false,
        response: jsonWithCors(
          { error: "Origin not allowlisted" },
          { status: 403, request: context.request, shopAllowedDomains: context.shopAllowedDomains, requestId: context.requestId }
        ),
      };
    }
  }

  return { continue: true, context };
};
