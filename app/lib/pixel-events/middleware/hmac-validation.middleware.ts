import crypto from "crypto";
import { jsonWithCors } from "../cors";
import { validatePixelEventHMAC } from "../hmac-validation";
import { verifyWithGraceWindowAsync } from "~/utils/shop-access.server";
import { trackAnomaly } from "~/utils/rate-limiter";
import { isStrictSecurityMode, API_CONFIG } from "~/utils/config.server";
import { logger, metrics } from "~/utils/logger.server";
import { rejectionTracker } from "../rejection-tracker.server";
import { shouldRecordRejection } from "../stats-sampling";
import type { KeyValidationResult } from "../types";
import type { IngestContext, IngestMiddleware, MiddlewareResult } from "./types";

const TIMESTAMP_WINDOW_MS = API_CONFIG.TIMESTAMP_WINDOW_MS;

export const hmacValidationMiddleware: IngestMiddleware = async (
  context: IngestContext
): Promise<MiddlewareResult> => {
  if (!context.shop || !context.bodyText) {
    return { continue: true, context };
  }

  const hasAnySecret = Boolean(context.shop.ingestionSecret || context.shop.previousIngestionSecret);

  if (context.isProduction && context.signatureSource === "body") {
    if (shouldRecordRejection(context.isProduction, false, "invalid_key")) {
      rejectionTracker.record({
        requestId: context.requestId,
        shopDomain: context.shopDomain!,
        reason: "invalid_key",
        timestamp: Date.now(),
      });
    }
    metrics.pixelRejection({
      requestId: context.requestId,
      shopDomain: context.shopDomain!,
      reason: "invalid_key",
    });
    return {
      continue: false,
      response: jsonWithCors(
        { error: "Invalid request" },
        { status: 403, request: context.request, requestId: context.requestId }
      ),
    };
  }

  if (context.isProduction && (context.signature || hasAnySecret) && !context.timestamp) {
    if (shouldRecordRejection(context.isProduction, false, "timestamp_missing")) {
      rejectionTracker.record({
        requestId: context.requestId,
        shopDomain: context.shopDomain!,
        reason: "timestamp_missing",
        timestamp: Date.now(),
      });
    }
    metrics.pixelRejection({
      requestId: context.requestId,
      shopDomain: context.shopDomain!,
      reason: "timestamp_missing",
    });
    return {
      continue: false,
      response: jsonWithCors(
        { error: "Missing timestamp header" },
        { status: 403, request: context.request, requestId: context.requestId }
      ),
    };
  }

  if (!context.timestamp) {
     // In non-production or if no secret/signature (though caught above for prod), allow continuation but it won't be verified
     return { continue: true, context };
  }

  let keyValidation: KeyValidationResult = {
    matched: false,
    reason: context.signature ? "hmac_not_verified" : "signature_missing",
    trustLevel: "untrusted",
  };

  if (context.signature && hasAnySecret && context.timestamp) {
    const hmacSourcePayload = (() => {
      if (context.signatureSource !== "body" || !context.bodyData || typeof context.bodyData !== "object") {
        return context.bodyText!;
      }
      const envelope = { ...(context.bodyData as Record<string, unknown>) };
      delete envelope.signature;
      delete envelope.signatureTimestamp;
      delete envelope.signatureShopDomain;
      return JSON.stringify(envelope);
    })();
    const bodyHash = crypto.createHash("sha256").update(hmacSourcePayload).digest("hex");

    const verifyWithToken = async (token: string) => {
      const result = await validatePixelEventHMAC(
        context.request,
        bodyHash,
        token,
        context.shopDomain!,
        context.timestamp!,
        TIMESTAMP_WINDOW_MS,
        context.bodyData
      );
      return result;
    };

    const graceResult = await verifyWithGraceWindowAsync(context.shop, async (token: string) => {
      const result = await verifyWithToken(token);
      return result.valid;
    });

    if (graceResult.matched) {
      const hmacResult = await verifyWithToken(graceResult.usedPreviousSecret ? context.shop.previousIngestionSecret! : context.shop.ingestionSecret!);
      keyValidation = {
        matched: true,
        reason: "hmac_verified",
        usedPreviousSecret: graceResult.usedPreviousSecret,
        trustLevel: hmacResult.trustLevel || "trusted",
      };
      logger.debug(`HMAC signature verified for ${context.shopDomain}${graceResult.usedPreviousSecret ? " (using previous token)" : ""}`);

      const totalEvents = context.validatedEvents.length;
      if (totalEvents >= 3) {
        const eventTypes = new Map<string, number>();
        const orderKeys = new Set<string>();
        let invalidOrderKeys = 0;
        for (const validatedEvent of context.validatedEvents) {
          const eventName = validatedEvent.payload.eventName;
          eventTypes.set(eventName, (eventTypes.get(eventName) || 0) + 1);
          const payloadData = validatedEvent.payload.data as Record<string, unknown> | undefined;
          if (payloadData) {
            const orderId = typeof payloadData.orderId === "string" ? payloadData.orderId : null;
            if (orderId) {
              const isShopifyGid = /^gid:\/\/shopify\/\w+\/\d+$/.test(orderId);
              const isValidFormat = orderId.length <= 256 && (isShopifyGid || /^[a-zA-Z0-9_\-.:/]+$/.test(orderId));
              if (!isValidFormat) {
                invalidOrderKeys++;
              } else {
                orderKeys.add(orderId);
              }
            }
          }
        }

        const uniqueOrderKeys = orderKeys.size;
        const duplicateOrderKeyRate = totalEvents > 0 && uniqueOrderKeys > 0 ? 1 - (uniqueOrderKeys / totalEvents) : 0;
        const invalidOrderKeyRate = totalEvents > 0 ? invalidOrderKeys / totalEvents : 0;
        const nonStandardEventCount = Array.from(eventTypes.entries()).filter(([name]) =>
          !["page_viewed", "product_viewed", "collection_viewed", "search_submitted", "cart_viewed", "checkout_started", "checkout_completed", "purchase"].includes(name)
        ).reduce((sum, [, count]) => sum + count, 0);
        const nonStandardEventRate = totalEvents > 0 ? nonStandardEventCount / totalEvents : 0;

        const abuseDetected =
          duplicateOrderKeyRate > 0.8 ||
          invalidOrderKeyRate > 0.3 ||
          nonStandardEventRate > 0.5;

        if (abuseDetected) {
          const abuseReasons: string[] = [];
          if (duplicateOrderKeyRate > 0.8) {
            abuseReasons.push(`high_duplicate_order_keys:${duplicateOrderKeyRate.toFixed(2)}`);
          }
          if (invalidOrderKeyRate > 0.3) {
            abuseReasons.push(`high_invalid_order_keys:${invalidOrderKeyRate.toFixed(2)}`);
          }
          if (nonStandardEventRate > 0.5) {
            abuseReasons.push(`high_non_standard_events:${nonStandardEventRate.toFixed(2)}`);
          }
          const abuseReason = abuseReasons.join(",");
          logger.warn(`Abuse detected for ${context.shopDomain} despite valid HMAC`, {
            shopDomain: context.shopDomain,
            duplicateOrderKeyRate,
            invalidOrderKeyRate,
            nonStandardEventRate,
            totalEvents,
            uniqueOrderKeys,
            abuseReason,
          });
          trackAnomaly(context.shopDomain!, "invalid_key");
          if (context.isProduction && isStrictSecurityMode()) {
            if (shouldRecordRejection(context.isProduction, true, "invalid_key")) {
              rejectionTracker.record({
                requestId: context.requestId,
                shopDomain: context.shopDomain!,
                reason: "invalid_key",
                timestamp: Date.now(),
              });
            }
            metrics.pixelRejection({
              requestId: context.requestId,
              shopDomain: context.shopDomain!,
              reason: "invalid_key",
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
      }
    } else {
      const tokenToCheck = context.shop.ingestionSecret ?? context.shop.previousIngestionSecret;
      if (!tokenToCheck) {
        keyValidation = {
          matched: false,
          reason: "secret_missing",
          trustLevel: "untrusted",
        };
        logger.warn(`HMAC verification failed for ${context.shopDomain}: no ingestion token available`);
      } else {
        const hmacResult = await verifyWithToken(tokenToCheck);
        keyValidation = {
          matched: false,
          reason: "hmac_invalid",
          trustLevel: hmacResult.trustLevel || "untrusted",
        };
        if (isStrictSecurityMode()) {
          logger.warn(`HMAC verification failed for ${context.shopDomain}: signature did not match current or previous token`);
        } else {
          logger.warn(`HMAC verification failed for ${context.shopDomain}: signature did not match (non-strict mode, marking as untrusted)`, {
            trustLevel: keyValidation.trustLevel,
          });
        }
      }
    }
  } else if (context.signature && !hasAnySecret) {
    keyValidation = {
      matched: false,
      reason: "secret_missing",
      trustLevel: "untrusted",
    };
    logger.warn(`HMAC signature received for ${context.shopDomain} but ingestion token is missing`);
  } else if (!context.signature && context.allowUnsignedEvents) {
    keyValidation = {
      matched: true,
      reason: "signature_skipped_env",
      trustLevel: "partial",
    };
  } else if (!context.signature && !hasAnySecret) {
    keyValidation = {
      matched: false,
      reason: "secret_missing",
      trustLevel: "untrusted",
    };
  } else if (!context.signature) {
    keyValidation = {
      matched: false,
      reason: "signature_missing",
      trustLevel: "untrusted",
    };
  }

  if (context.isProduction && !keyValidation.matched) {
    const rejectionReason = keyValidation.reason === "secret_missing" ? "no_ingestion_key" : "invalid_key";
    if (shouldRecordRejection(context.isProduction, false, rejectionReason)) {
      rejectionTracker.record({
        requestId: context.requestId,
        shopDomain: context.shopDomain!,
        reason: rejectionReason,
        timestamp: Date.now(),
      });
    }
    metrics.pixelRejection({
      requestId: context.requestId,
      shopDomain: context.shopDomain!,
      reason: rejectionReason,
    });
    const status = rejectionReason === "no_ingestion_key" ? 503 : 403;
    const error = rejectionReason === "no_ingestion_key" ? "Service unavailable" : "Invalid request";
    return {
      continue: false,
      response: jsonWithCors(
        { error },
        { status, request: context.request, requestId: context.requestId }
      ),
    };
  }

  if (!keyValidation.matched) {
    logger.warn(`HMAC validation failed but allowing request (non-strict)`, {
      shopDomain: context.shopDomain,
      reason: keyValidation.reason,
      trustLevel: keyValidation.trustLevel,
    });
  }

  return {
    continue: true,
    context: {
      ...context,
      keyValidation,
    },
  };
};
