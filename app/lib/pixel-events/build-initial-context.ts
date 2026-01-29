import type { IngestContext } from "./middleware/types";
import type { KeyValidationResult } from "./types";
import { generateRequestId } from "~/utils/logger.server";
import { isDevMode } from "~/utils/origin-validation.server";

export function buildInitialContext(request: Request): IngestContext {
  const requestId = generateRequestId();
  const isProduction = !isDevMode();
  const allowFallback = process.env.ALLOW_REDIS_FALLBACK_FOR_INGEST === "true";
  const originHeaderPresent = request.headers.has("Origin");
  const origin = originHeaderPresent ? request.headers.get("Origin") : null;
  const isNullOrigin = origin === "null" || origin === null;
  const signature = request.headers.get("X-Tracking-Guardian-Signature");
  const hasSignatureHeader = !!signature;
  const timestampHeader = request.headers.get("X-Tracking-Guardian-Timestamp");
  const shopDomainHeader = request.headers.get("x-shopify-shop-domain") || "unknown";
  const contentType = request.headers.get("Content-Type");
  const strictOrigin = (() => {
    const value = process.env.PIXEL_STRICT_ORIGIN?.toLowerCase().trim();
    return value === "true" || value === "1" || value === "yes";
  })();
  const allowUnsignedEvents = isProduction ? false : process.env.ALLOW_UNSIGNED_PIXEL_EVENTS === "true";

  return {
    request,
    requestId,
    isProduction,
    allowFallback,
    origin,
    isNullOrigin,
    originHeaderPresent,
    signature,
    hasSignatureHeader,
    timestampHeader,
    timestamp: timestampHeader ? parseInt(timestampHeader, 10) : null,
    shopDomainHeader,
    contentType,
    strictOrigin,
    allowUnsignedEvents,
    bodyText: null,
    bodyData: null,
    rawEvents: [],
    batchTimestamp: undefined,
    validatedEvents: [],
    shopDomain: null,
    environment: "live",
    shop: null,
    shopAllowedDomains: [],
    keyValidation: {
      matched: false,
      reason: signature ? "hmac_not_verified" : "signature_missing",
      trustLevel: "untrusted",
    } as KeyValidationResult,
    mode: "purchase_only",
    enabledPixelConfigs: [],
  };
}
