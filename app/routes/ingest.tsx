import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { jsonWithCors, optionsResponse } from "~/lib/pixel-events/cors";
import { generateRequestId } from "~/utils/logger.server";
import { isDevMode } from "~/utils/origin-validation.server";
import { composeIngestMiddleware } from "~/lib/pixel-events/middleware/compose";
import { corsMiddleware } from "~/lib/pixel-events/middleware/cors.middleware";
import { rateLimitPreBodyMiddleware } from "~/lib/pixel-events/middleware/rate-limit.middleware";
import { bodyReaderMiddleware } from "~/lib/pixel-events/middleware/body-reader.middleware";
import { originValidationPreBodyMiddleware } from "~/lib/pixel-events/middleware/origin-validation.middleware";
import { timestampValidationMiddleware } from "~/lib/pixel-events/middleware/timestamp-validation.middleware";
import { eventValidationMiddleware } from "~/lib/pixel-events/middleware/event-validation.middleware";
import { shopLoadingMiddleware } from "~/lib/pixel-events/middleware/shop-loading.middleware";
import { originValidationPostShopMiddleware } from "~/lib/pixel-events/middleware/origin-validation.middleware";
import { hmacValidationMiddleware } from "~/lib/pixel-events/middleware/hmac-validation.middleware";
import { rateLimitPostShopMiddleware } from "~/lib/pixel-events/middleware/rate-limit-post-shop.middleware";
import { processingMiddleware } from "~/lib/pixel-events/middleware/processing.middleware";
import type { IngestContext } from "~/lib/pixel-events/middleware/types";
import type { KeyValidationResult } from "~/lib/pixel-events/types";

export const action = async ({ request }: ActionFunctionArgs) => {
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

  const initialContext: IngestContext = {
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
    serverSideConfigs: [],
  };

  const middlewares = [
    corsMiddleware,
    rateLimitPreBodyMiddleware,
    bodyReaderMiddleware,
    originValidationPreBodyMiddleware,
    timestampValidationMiddleware,
    eventValidationMiddleware,
    shopLoadingMiddleware,
    originValidationPostShopMiddleware,
    hmacValidationMiddleware,
    rateLimitPostShopMiddleware,
    processingMiddleware,
  ];

  return composeIngestMiddleware(middlewares, initialContext);
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return jsonWithCors(
    {
      status: "ok",
      endpoint: "ingest",
      message: "This is the only pixel event ingestion endpoint. Use POST /ingest to send pixel events.",
    },
    { request }
  );
};
