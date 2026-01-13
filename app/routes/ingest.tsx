import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { action as pixelEventsAction, loader as pixelEventsLoader } from "./api.pixel-events/route";
import { jsonWithCors, getCorsHeadersPreBody } from "./api.pixel-events/cors";
import type { PixelEventPayload } from "./api.pixel-events/types";
import { processBatchEvents } from "~/services/events/pipeline.server";
import { logger } from "~/utils/logger.server";
import { getShopForPixelVerificationWithConfigs } from "./api.pixel-events/key-validation";
import { validatePixelEventHMAC } from "./api.pixel-events/hmac-validation";
import { validateRequest, isPrimaryEvent } from "./api.pixel-events/validation";
import { API_CONFIG, RATE_LIMIT_CONFIG } from "~/utils/config";
import {
  isDevMode,
  validatePixelOriginPreBody,
  validatePixelOriginForShop,
  buildShopAllowedDomains,
} from "~/utils/origin-validation";
import {
  generateEventIdForType,
  generateOrderMatchKey,
  isClientEventRecorded,
  createEventNonce,
  upsertPixelEventReceipt,
  evaluateTrustLevel,
} from "./api.pixel-events/receipt-handler";
import type { KeyValidationResult } from "./api.pixel-events/types";
import { checkInitialConsent, filterPlatformsByConsent, logConsentFilterMetrics } from "./api.pixel-events/consent-filter";
import { checkRateLimitAsync, createRateLimitResponse } from "~/utils/rate-limiter";
import { safeFireAndForget } from "~/utils/helpers";
import prisma from "~/db.server";

const MAX_BATCH_SIZE = 100;
const TIMESTAMP_WINDOW_MS = API_CONFIG.TIMESTAMP_WINDOW_MS;
const INGEST_RATE_LIMIT = RATE_LIMIT_CONFIG.PIXEL_EVENTS;

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return jsonWithCors({}, { request });
  }
  if (request.method !== "POST") {
    return jsonWithCors({ error: "Method not allowed" }, { status: 405, request });
  }
  const origin = request.headers.get("Origin");
  const preBodyValidation = validatePixelOriginPreBody(origin);
  if (!preBodyValidation.valid) {
    logger.warn(
      `Rejected pixel origin at Stage 1 in /ingest: ${origin?.substring(0, 100) || "null"}, ` +
        `reason: ${preBodyValidation.reason}`
    );
    return jsonWithCors({ error: "Invalid origin" }, { status: 403, request });
  }
  const contentType = request.headers.get("Content-Type");
  if (!contentType || (!contentType.includes("application/json") && !contentType.includes("text/plain"))) {
    return jsonWithCors(
      { error: "Content-Type must be application/json or text/plain" },
      { status: 415, request }
    );
  }
  const contentLength = request.headers.get("Content-Length");
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (!isNaN(size) && size > API_CONFIG.MAX_BODY_SIZE) {
      logger.warn(`Request body too large: ${size} bytes (max ${API_CONFIG.MAX_BODY_SIZE})`);
      return jsonWithCors(
        { error: "Payload too large", maxSize: API_CONFIG.MAX_BODY_SIZE },
        { status: 413, request }
      );
    }
  }
  let bodyText: string;
  let bodyData: unknown;
  try {
    bodyText = await request.text();
    if (bodyText.length > API_CONFIG.MAX_BODY_SIZE) {
      logger.warn(`Request body too large: ${bodyText.length} bytes (max ${API_CONFIG.MAX_BODY_SIZE})`);
      return jsonWithCors(
        { error: "Payload too large", maxSize: API_CONFIG.MAX_BODY_SIZE },
        { status: 413, request }
      );
    }
    bodyData = JSON.parse(bodyText);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonWithCors(
        { error: "Invalid JSON body" },
        { status: 400, request }
      );
    }
    return jsonWithCors(
      { error: "Failed to read request body" },
      { status: 400, request }
    );
  }
  const isBatchFormat =
    typeof bodyData === "object" &&
    bodyData !== null &&
    "events" in bodyData &&
    Array.isArray((bodyData as { events?: unknown }).events);
  if (isBatchFormat) {
    const batchData = bodyData as { events: unknown[]; timestamp?: number };
    const events = batchData.events || [];
    if (events.length === 0) {
      return jsonWithCors(
        { error: "events array cannot be empty" },
        { status: 400, request }
      );
    }
    if (events.length > MAX_BATCH_SIZE) {
      return jsonWithCors(
        { error: `events array exceeds maximum size of ${MAX_BATCH_SIZE}` },
        { status: 400, request }
      );
    }
    const firstEventValidation = validateRequest(events[0]);
    if (!firstEventValidation.valid) {
      return jsonWithCors(
        { error: "Invalid event in batch", details: firstEventValidation.error },
        { status: 400, request }
      );
    }
    const firstPayload = firstEventValidation.payload;
    const shopDomain = firstPayload.shopDomain;
    const timestamp = batchData.timestamp || firstPayload.timestamp;
    const signature = request.headers.get("X-Tracking-Guardian-Signature");
    const isProduction = !isDevMode();
    const environment = (firstPayload.data as { environment?: "test" | "live" })?.environment || "live";
    const shop = await getShopForPixelVerificationWithConfigs(shopDomain, environment);
    if (!shop || !shop.isActive) {
      return jsonWithCors(
        { error: "Shop not found or inactive" },
        { status: 404, request }
      );
    }
    const shopAllowedDomains = buildShopAllowedDomains({
      shopDomain: shop.shopDomain,
      primaryDomain: shop.primaryDomain,
      storefrontDomains: shop.storefrontDomains,
    });
    const referer = request.headers.get("Referer");
    const shopOriginValidation = validatePixelOriginForShop(origin, shopAllowedDomains, {
      referer,
      shopDomain: shop.shopDomain,
    });
    if (!shopOriginValidation.valid && shopOriginValidation.shouldReject) {
      logger.warn(
        `Rejected pixel origin at Stage 2 in /ingest for ${shop.shopDomain}: ` +
          `origin=${origin?.substring(0, 100) || "null"}, referer=${referer?.substring(0, 100) || "null"}, reason=${shopOriginValidation.reason}`
      );
      return jsonWithCors({ error: "Origin not allowlisted" }, { status: 403, request, shopAllowedDomains });
    }
    const isNullOrigin = origin === "null" || origin === null;
    if (isProduction) {
      if (!shop.ingestionSecret) {
        logger.error(`Missing ingestionSecret for ${shopDomain} in production - HMAC verification required`);
        if (isNullOrigin) {
          logger.error(`Null origin request without ingestionSecret for ${shopDomain} in production - rejecting`);
          return jsonWithCors(
            { error: "Missing signature", errorCode: "missing_secret_null_origin" },
            { status: 403, request }
          );
        }
        return jsonWithCors(
          { error: "Server configuration error", errorCode: "missing_secret" },
          { status: 500, request }
        );
      }
      if (!signature) {
        logger.error(`Missing HMAC signature for ${shopDomain} in production - rejecting`);
        if (isNullOrigin) {
          logger.error(`Null origin request without HMAC signature for ${shopDomain} in production - rejecting`);
          return jsonWithCors(
            { error: "Missing signature", errorCode: "missing_signature_null_origin" },
            { status: 403, request }
          );
        }
        return jsonWithCors(
          { error: "Missing signature", errorCode: "missing_signature" },
          { status: 403, request }
        );
      }
      const hmacResult = await validatePixelEventHMAC(
        request,
        bodyText,
        shop.ingestionSecret,
        timestamp,
        TIMESTAMP_WINDOW_MS
      );
      if (!hmacResult.valid) {
        logger.error(`HMAC verification failed for ${shopDomain} in production: ${hmacResult.reason}`);
        return jsonWithCors(
          { error: "Invalid signature", errorCode: hmacResult.errorCode },
          { status: 403, request }
        );
      }
      if (isNullOrigin) {
        logger.debug(`Null origin request accepted with valid HMAC and ingestionSecret for ${shopDomain} in production`);
      } else {
        logger.debug(`HMAC signature verified for ${shopDomain} in production`);
      }
    }
    const rateLimit = await checkRateLimitAsync(request, "pixel-events", INGEST_RATE_LIMIT);
    if (rateLimit.isLimited) {
      logger.warn(`Rate limit exceeded for ingest`, {
        shopDomain,
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
    const pixelConfigs = shop.pixelConfigs;
    let mode: "purchase_only" | "full_funnel" = "purchase_only";
    for (const config of pixelConfigs) {
      if (config.clientConfig && typeof config.clientConfig === 'object') {
        if ('mode' in config.clientConfig) {
          const configMode = config.clientConfig.mode;
          if (configMode === 'full_funnel') {
            mode = "full_funnel";
            break;
          } else if (configMode === 'purchase_only' && mode !== 'full_funnel') {
            mode = "purchase_only";
          }
        }
      }
    }
    const validatedEvents: Array<{
      payload: PixelEventPayload;
      eventId: string | null;
      destinations: string[];
    }> = [];
    const serverSideConfigs = pixelConfigs.filter(config => config.serverSideEnabled === true);
    const keyValidation: KeyValidationResult = (() => {
      if (isProduction) {
        return {
          matched: true,
          reason: "hmac_verified",
        };
      } else {
        if (signature && shop.ingestionSecret) {
          return {
            matched: true,
            reason: "hmac_verified",
          };
        } else {
          return {
            matched: !signature || !shop.ingestionSecret,
            reason: !signature ? "no_signature_in_dev" : (!shop.ingestionSecret ? "no_secret_in_dev" : "hmac_not_verified"),
          };
        }
      }
    })();
    for (let i = 0; i < events.length; i++) {
      const eventValidation = validateRequest(events[i]);
      if (!eventValidation.valid) {
        logger.warn(`Invalid event at index ${i} in batch`, {
          shopDomain,
          error: eventValidation.error,
        });
        continue;
      }
      const payload = eventValidation.payload;
      if (payload.shopDomain !== shopDomain) {
        logger.warn(`Event at index ${i} has different shopDomain`, {
          expected: shopDomain,
          actual: payload.shopDomain,
        });
        continue;
      }
      if (!isPrimaryEvent(payload.eventName, mode)) {
        logger.debug(`Event ${payload.eventName} at index ${i} not accepted for ${shopDomain} (mode: ${mode}) - skipping`);
        continue;
      }
      const prdEventId = payload.nonce;
      const eventType = payload.eventName === "checkout_completed" ? "purchase" : payload.eventName;
      const isPurchaseEvent = eventType === "purchase";
      const items = payload.data.items as Array<{
        id?: string;
        quantity?: number | string;
        variantId?: string;
        variant_id?: string;
        productId?: string;
        product_id?: string;
      }> | undefined;
      const normalizedItems = items?.map(item => ({
        id: String(
          item.variantId ||
          item.variant_id ||
          item.productId ||
          item.product_id ||
          item.id ||
          ""
        ).trim(),
        quantity: typeof item.quantity === "number"
          ? Math.max(1, Math.floor(item.quantity))
          : typeof item.quantity === "string"
          ? Math.max(1, parseInt(item.quantity, 10) || 1)
          : 1,
      })).filter(item => item.id) || [];
      let orderId: string | null = null;
      let usedCheckoutTokenAsFallback = false;
      let eventIdentifier: string | null = null;
      if (isPurchaseEvent) {
        try {
          const matchKeyResult = generateOrderMatchKey(
            payload.data.orderId,
            payload.data.checkoutToken,
            shopDomain
          );
          orderId = matchKeyResult.orderId;
          usedCheckoutTokenAsFallback = matchKeyResult.usedCheckoutTokenAsFallback;
          eventIdentifier = orderId;
          const alreadyRecorded = await isClientEventRecorded(shop.id, orderId, eventType);
          if (alreadyRecorded) {
            logger.debug(`Purchase event already recorded for order ${orderId}, skipping`, {
              shopId: shop.id,
              orderId,
              eventType,
            });
            continue;
          }
          const nonceFromBody = prdEventId || payload.nonce;
          const nonceResult = await createEventNonce(
            shop.id,
            orderId,
            payload.timestamp,
            nonceFromBody,
            eventType
          );
          if (nonceResult.isReplay) {
            logger.debug(`Replay detected for order ${orderId}, skipping`, {
              shopId: shop.id,
              orderId,
              eventType,
            });
            continue;
          }
        } catch (error) {
          logger.warn(`Failed to process purchase event at index ${i}`, {
            shopDomain,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
      } else {
        const checkoutToken = payload.data.checkoutToken;
        if (checkoutToken) {
          orderId = checkoutToken;
          eventIdentifier = checkoutToken;
        } else {
          orderId = `session_${payload.timestamp}_${shopDomain.replace(/\./g, "_")}`;
          eventIdentifier = null;
        }
      }
      const eventId = prdEventId || generateEventIdForType(
        eventIdentifier,
        eventType,
        shopDomain,
        payload.data.checkoutToken,
        normalizedItems.length > 0 ? normalizedItems : undefined,
        payload.nonce || null
      );
      const consentResult = checkInitialConsent(payload.consent);
      if (!consentResult.hasAnyConsent) {
        logger.debug(`Event at index ${i} has no consent, skipping`, {
          shopDomain,
          eventName: payload.eventName,
        });
        continue;
      }
      const { platformsToRecord, skippedPlatforms } = filterPlatformsByConsent(
        serverSideConfigs,
        consentResult
      );
      const destinations = platformsToRecord.map(p => p.platform);
      if (isPurchaseEvent && orderId) {
        logConsentFilterMetrics(
          shopDomain,
          orderId,
          platformsToRecord,
          skippedPlatforms,
          consentResult
        );
        try {
          const activeVerificationRun = await prisma.verificationRun.findFirst({
            where: {
              shopId: shop.id,
              status: "running",
            },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          const primaryPlatform = platformsToRecord.length > 0 ? platformsToRecord[0].platform : null;
          await upsertPixelEventReceipt(
            shop.id,
            eventId,
            payload,
            origin,
            eventType,
            activeVerificationRun?.id || null,
            primaryPlatform || null,
            orderId || null
          );
        } catch (error) {
          logger.warn(`Failed to write receipt for purchase event at index ${i}`, {
            shopId: shop.id,
            orderId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (destinations.length === 0) {
        logger.debug(`Event at index ${i} has no allowed platforms after consent filtering, skipping`, {
          shopDomain,
          eventName: payload.eventName,
          consent: payload.consent,
        });
        continue;
      }
      validatedEvents.push({
        payload,
        eventId,
        destinations,
      });
    }
    if (validatedEvents.length === 0) {
      logger.debug(`All events filtered for ${shopDomain} (mode: ${mode}) - returning empty accepted_count`);
      return jsonWithCors(
        {
          accepted_count: 0,
          errors: [],
        },
        { request }
      );
    }
    safeFireAndForget(
      processBatchEvents(shop.id, validatedEvents, environment).then((results) => {
        const successCount = results.filter(r => r.success).length;
        const errorCount = results.filter(r => !r.success).length;
        logger.info(`Batch ingest processed`, {
          shopDomain,
          total: validatedEvents.length,
          accepted: successCount,
          errors: errorCount,
        });
      }),
      {
        operation: "processBatchEvents",
        metadata: {
          shopId: shop.id,
          shopDomain,
          total: validatedEvents.length,
        },
      }
    );
    return jsonWithCors(
      {
        accepted_count: validatedEvents.length,
        errors: [],
      },
      { request }
    );
  } else {
    return pixelEventsAction({ request, params: {}, context: {} as any });
  }
};

export const loader = async (args: LoaderFunctionArgs) => {
  return pixelEventsLoader(args);
};
