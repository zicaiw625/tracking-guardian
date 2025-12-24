/**
 * Pixel Events API - Main Route Handler
 *
 * Entry point for pixel event processing.
 * All logic is delegated to modular handlers.
 * 
 * P0.1: Supports text/plain Content-Type to avoid CORS preflight.
 * P0.4: ingestionKey and nonce are now in body (not headers).
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { checkRateLimitAsync, createRateLimitResponse, trackAnomaly } from "../../utils/rate-limiter";
import { checkCircuitBreaker } from "../../utils/circuit-breaker";
import {
  validatePixelOriginPreBody,
  validatePixelOriginForShop,
  buildShopAllowedDomains,
} from "../../utils/origin-validation";
import { logger, metrics } from "../../utils/logger.server";
import {
  API_CONFIG,
  RATE_LIMIT_CONFIG as RATE_LIMITS,
  CIRCUIT_BREAKER_CONFIG as CIRCUIT_CONFIG,
} from "../../utils/config";

// Import from modular structure
import {
  jsonWithCors,
  emptyResponseWithCors,
  optionsResponse,
  getCorsHeadersPreBody,
} from "./cors";
import { validateRequest, isPrimaryEvent } from "./validation";
import {
  checkInitialConsent,
  filterPlatformsByConsent,
  logNoConsentDrop,
  logConsentFilterMetrics,
} from "./consent-filter";
import {
  getShopForPixelVerificationWithConfigs,
  validateIngestionKey,
} from "./key-validation";
import {
  isClientEventRecorded,
  generateOrderMatchKey,
  evaluateTrustLevel,
  createEventNonce,
  upsertPixelEventReceipt,
  recordConversionLogs,
  generatePurchaseEventId,
} from "./receipt-handler";

// =============================================================================
// Configuration
// =============================================================================

const MAX_BODY_SIZE = API_CONFIG.MAX_BODY_SIZE;
const TIMESTAMP_WINDOW_MS = API_CONFIG.TIMESTAMP_WINDOW_MS;
const RATE_LIMIT_CONFIG = RATE_LIMITS.PIXEL_EVENTS;
const CIRCUIT_BREAKER_CONFIG = {
  threshold: CIRCUIT_CONFIG.DEFAULT_THRESHOLD,
  windowMs: CIRCUIT_CONFIG.DEFAULT_WINDOW_MS,
};

// =============================================================================
// Content-Type Parsing
// =============================================================================

/**
 * P0.1: Check if Content-Type is acceptable.
 * 
 * We accept:
 * - text/plain (preferred, avoids CORS preflight)
 * - application/json (legacy support)
 */
function isAcceptableContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  return lower.includes("text/plain") || lower.includes("application/json");
}

/**
 * P0.1: Parse body as JSON regardless of Content-Type.
 * 
 * Both text/plain and application/json bodies contain JSON strings.
 */
async function parseBodyAsJson(request: Request): Promise<{ 
  success: true; 
  data: unknown; 
  bodyLength: number;
} | { 
  success: false; 
  error: string; 
}> {
  try {
    const bodyText = await request.text();
    
    if (bodyText.length > MAX_BODY_SIZE) {
      return { success: false, error: "payload_too_large" };
    }
    
    const data = JSON.parse(bodyText);
    return { success: true, data, bodyLength: bodyText.length };
  } catch {
    return { success: false, error: "invalid_json" };
  }
}

// =============================================================================
// Action Handler
// =============================================================================

export const action = async ({ request }: ActionFunctionArgs) => {
  const origin = request.headers.get("Origin");

  // Handle preflight
  if (request.method === "OPTIONS") {
    return optionsResponse(request);
  }

  // Method check
  if (request.method !== "POST") {
    return jsonWithCors({ error: "Method not allowed" }, { status: 405, request });
  }

  // P0.1: Accept both text/plain and application/json
  const contentType = request.headers.get("Content-Type");
  if (!isAcceptableContentType(contentType)) {
    return jsonWithCors(
      { error: "Content-Type must be text/plain or application/json" },
      { status: 415, request }
    );
  }

  // Stage 1: Pre-body origin validation
  const preBodyValidation = validatePixelOriginPreBody(origin);
  if (!preBodyValidation.valid) {
    const shopDomainHeader = request.headers.get("x-shopify-shop-domain") || "unknown";
    const anomalyCheck = trackAnomaly(shopDomainHeader, "invalid_origin");
    if (anomalyCheck.shouldBlock) {
      logger.warn(`Circuit breaker triggered for ${shopDomainHeader}: ${anomalyCheck.reason}`);
    }
    metrics.pixelRejection({
      shopDomain: shopDomainHeader,
      reason: "invalid_origin_protocol",
      originType: preBodyValidation.reason,
    });
    if (preBodyValidation.shouldLog) {
      logger.warn(
        `Rejected pixel origin at Stage 1: ${origin?.substring(0, 100) || "null"}, ` +
          `reason: ${preBodyValidation.reason}`
      );
    }
    return jsonWithCors({ error: "Invalid origin" }, { status: 403, request });
  }

  // P0.1: Timestamp validation from body (legacy header support for transition)
  const timestampHeader = request.headers.get("X-Tracking-Guardian-Timestamp");
  const shopDomainHeader = request.headers.get("x-shopify-shop-domain") || "unknown";

  if (timestampHeader) {
    const timestamp = parseInt(timestampHeader, 10);
    if (isNaN(timestamp)) {
      const anomalyCheck = trackAnomaly(shopDomainHeader, "invalid_timestamp");
      if (anomalyCheck.shouldBlock) {
        logger.warn(`Circuit breaker triggered for ${shopDomainHeader}: ${anomalyCheck.reason}`);
      }
      logger.debug("Invalid timestamp format in header, dropping request");
      return emptyResponseWithCors(request);
    }

    const now = Date.now();
    const timeDiff = Math.abs(now - timestamp);
    if (timeDiff > TIMESTAMP_WINDOW_MS) {
      const anomalyCheck = trackAnomaly(shopDomainHeader, "invalid_timestamp");
      if (anomalyCheck.shouldBlock) {
        logger.warn(`Circuit breaker triggered for ${shopDomainHeader}: ${anomalyCheck.reason}`);
      }
      logger.debug(`Timestamp outside window: diff=${timeDiff}ms, dropping request`);
      return emptyResponseWithCors(request);
    }
  }

  // Rate limiting
  const rateLimit = await checkRateLimitAsync(request, "pixel-events", RATE_LIMIT_CONFIG);
  if (rateLimit.isLimited) {
    logger.warn(`Rate limit exceeded for pixel-events`, {
      retryAfter: rateLimit.retryAfter,
      remaining: rateLimit.remaining,
    });
    const rateLimitResponse = createRateLimitResponse(rateLimit.retryAfter);
    const corsHeaders = getCorsHeadersPreBody(request);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      rateLimitResponse.headers.set(key, value);
    });
    return rateLimitResponse;
  }

  try {
    // Body size validation via Content-Length header
    const contentLength = parseInt(request.headers.get("Content-Length") || "0", 10);
    if (contentLength > MAX_BODY_SIZE) {
      logger.warn(`Payload too large: ${contentLength} bytes (max ${MAX_BODY_SIZE})`);
      return jsonWithCors(
        { error: "Payload too large", maxSize: MAX_BODY_SIZE },
        { status: 413, request }
      );
    }

    // P0.1: Parse body as JSON (works for both text/plain and application/json)
    const parseResult = await parseBodyAsJson(request);
    if (!parseResult.success) {
      if (parseResult.error === "payload_too_large") {
        logger.warn(`Actual payload too large (max ${MAX_BODY_SIZE})`);
        return jsonWithCors(
          { error: "Payload too large", maxSize: MAX_BODY_SIZE },
          { status: 413, request }
        );
      }
      return jsonWithCors({ error: "Invalid JSON body" }, { status: 400, request });
    }

    const rawBody = parseResult.data;

    // Validate request
    const validation = validateRequest(rawBody);
    if (!validation.valid) {
      logger.debug(
        `Pixel payload validation failed: code=${validation.code}, error=${validation.error}`
      );
      return jsonWithCors({ error: "Invalid request" }, { status: 400, request });
    }

    const { payload } = validation;

    // P0.4: Timestamp validation from body (if not already validated from header)
    if (!timestampHeader) {
      const now = Date.now();
      const timeDiff = Math.abs(now - payload.timestamp);
      if (timeDiff > TIMESTAMP_WINDOW_MS) {
        const anomalyCheck = trackAnomaly(payload.shopDomain, "invalid_timestamp");
        if (anomalyCheck.shouldBlock) {
          logger.warn(`Circuit breaker triggered for ${payload.shopDomain}: ${anomalyCheck.reason}`);
        }
        logger.debug(`Body timestamp outside window: diff=${timeDiff}ms, dropping request`);
        return emptyResponseWithCors(request);
      }
    }

    // Circuit breaker check
    const circuitCheck = await checkCircuitBreaker(payload.shopDomain, CIRCUIT_BREAKER_CONFIG);
    if (circuitCheck.blocked) {
      logger.warn(`Circuit breaker blocked request for ${payload.shopDomain}`);
      return jsonWithCors(
        {
          error: circuitCheck.reason,
          retryAfter: circuitCheck.retryAfter,
        },
        {
          status: 429,
          request,
          headers: circuitCheck.retryAfter
            ? { "Retry-After": String(circuitCheck.retryAfter) }
            : undefined,
        }
      );
    }

    // Skip non-primary events
    if (!isPrimaryEvent(payload.eventName)) {
      logger.debug(`Funnel event received: ${payload.eventName} for ${payload.shopDomain}`);
      return emptyResponseWithCors(request);
    }

    // Initial consent check
    const consentResult = checkInitialConsent(payload.consent);
    if (!consentResult.hasAnyConsent) {
      logNoConsentDrop(payload.shopDomain, payload.consent);
      return emptyResponseWithCors(request);
    }

    // Get shop data with pixel configs (optimized single query to avoid N+1)
    const shop = await getShopForPixelVerificationWithConfigs(payload.shopDomain);
    if (!shop || !shop.isActive) {
      return jsonWithCors(
        { error: "Shop not found or inactive" },
        { status: 404, request }
      );
    }
    
    // Use preloaded pixel configs from the combined query
    const pixelConfigs = shop.pixelConfigs;

    // Build allowed domains
    const shopAllowedDomains = buildShopAllowedDomains({
      shopDomain: shop.shopDomain,
      primaryDomain: shop.primaryDomain,
      storefrontDomains: shop.storefrontDomains,
    });

    // Stage 2: Shop-specific origin validation
    const shopOriginValidation = validatePixelOriginForShop(origin, shopAllowedDomains);
    if (!shopOriginValidation.valid && shopOriginValidation.shouldReject) {
      const anomalyCheck = trackAnomaly(shop.shopDomain, "invalid_origin");
      if (anomalyCheck.shouldBlock) {
        logger.warn(`Circuit breaker triggered for ${shop.shopDomain}: ${anomalyCheck.reason}`);
      }
      metrics.pixelRejection({
        shopDomain: shop.shopDomain,
        reason: "origin_not_allowlisted",
        originType: shopOriginValidation.reason,
      });
      logger.warn(
        `Rejected pixel origin at Stage 2 for ${shop.shopDomain}: ` +
          `origin=${origin?.substring(0, 100) || "null"}, reason=${shopOriginValidation.reason}`
      );
      return emptyResponseWithCors(request, shopAllowedDomains);
    }

    // P0.4: Get ingestion key from body (primary) or header (legacy fallback)
    const ingestionKeyFromBody = payload.ingestionKey;
    const ingestionKeyFromHeader = request.headers.get("X-Tracking-Guardian-Key");
    const ingestionKey = ingestionKeyFromBody || ingestionKeyFromHeader || null;

    // Key validation
    const keyValidationOutcome = validateIngestionKey({
      shop,
      ingestionKey,
      shopAllowedDomains,
    });

    if (keyValidationOutcome.type === "missing_key_prod") {
      return jsonWithCors({ error: "Forbidden" }, { status: 403, request, shopAllowedDomains });
    }
    if (
      keyValidationOutcome.type === "missing_key_request" ||
      keyValidationOutcome.type === "key_mismatch"
    ) {
      return emptyResponseWithCors(request, shopAllowedDomains);
    }

    const keyValidation = keyValidationOutcome.result;

    // Evaluate trust
    const trustResult = evaluateTrustLevel(keyValidation, !!payload.data.checkoutToken);

    // Generate order match key
    let matchKeyResult;
    try {
      matchKeyResult = generateOrderMatchKey(
        payload.data.orderId,
        payload.data.checkoutToken,
        shop.shopDomain
      );
    } catch (error) {
      logger.debug(`Match key generation failed for shop ${shop.shopDomain}: ${String(error)}`);
      return jsonWithCors({ error: "Invalid request" }, { status: 400, request, shopAllowedDomains });
    }

    const { orderId, usedCheckoutTokenAsFallback } = matchKeyResult;
    const eventId = generatePurchaseEventId(orderId, shop.shopDomain);

    // P0.5: Check for duplicate EARLY (before any writes)
    // Use checkoutToken + eventName as idempotency key
    const alreadyRecorded = await isClientEventRecorded(shop.id, orderId, "purchase");
    if (alreadyRecorded) {
      return jsonWithCors(
        {
          success: true,
          eventId,
          message: "Client event already recorded",
          clientSideSent: true,
        },
        { request, shopAllowedDomains }
      );
    }

    // Check pixel configs (already loaded with shop data)
    if (pixelConfigs.length === 0) {
      return jsonWithCors(
        {
          success: true,
          eventId,
          message: "No server-side tracking configured - client event acknowledged",
        },
        { request, shopAllowedDomains }
      );
    }

    // P0.4: Nonce/replay protection using nonce from body
    const nonceFromBody = payload.nonce;
    const nonceResult = await createEventNonce(
      shop.id, 
      orderId, 
      payload.timestamp,
      nonceFromBody
    );
    if (nonceResult.isReplay) {
      metrics.pixelRejection({
        shopDomain: shop.shopDomain,
        reason: "replay_detected",
        originType: "nonce_collision",
      });
      return emptyResponseWithCors(request, shopAllowedDomains);
    }

    // Create receipt
    await upsertPixelEventReceipt(
      shop.id,
      orderId,
      eventId,
      payload,
      keyValidation,
      trustResult,
      usedCheckoutTokenAsFallback,
      origin
    );

    // Check sale of data consent
    if (!consentResult.saleOfDataAllowed) {
      logger.debug(
        `Skipping ConversionLog recording: sale_of_data not explicitly allowed ` +
          `(saleOfData=${String(payload.consent?.saleOfData)}) [P0-04]`
      );
      return jsonWithCors(
        {
          success: true,
          eventId,
          message: "Sale of data not explicitly allowed - event acknowledged",
        },
        { request, shopAllowedDomains }
      );
    }

    // Filter platforms by consent
    const { platformsToRecord, skippedPlatforms } = filterPlatformsByConsent(
      pixelConfigs,
      consentResult
    );

    // Record conversion logs
    const { recordedPlatforms } = await recordConversionLogs(
      shop.id,
      orderId,
      eventId,
      payload,
      platformsToRecord
    );

    // Log metrics
    logConsentFilterMetrics(
      shop.shopDomain,
      orderId,
      recordedPlatforms,
      skippedPlatforms,
      consentResult
    );

    return jsonWithCors(
      {
        success: true,
        eventId,
        message: "Pixel event recorded, CAPI will be sent via webhook",
        clientSideSent: true,
        platforms: recordedPlatforms,
        skippedPlatforms: skippedPlatforms.length > 0 ? skippedPlatforms : undefined,
        trusted: trustResult.isTrusted,
        consent: payload.consent || null,
      },
      { request, shopAllowedDomains }
    );
  } catch (error) {
    logger.error("Pixel events API error:", error);
    return jsonWithCors({ error: "Internal server error" }, { status: 500, request });
  }
};

// =============================================================================
// Loader Handler
// =============================================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return jsonWithCors({ status: "ok", endpoint: "pixel-events" }, { request });
};
