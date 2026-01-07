

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { action as pixelEventsAction, loader as pixelEventsLoader } from "./api.pixel-events/route";
import { jsonWithCors } from "./api.pixel-events/cors";
import type { PixelEventPayload } from "./api.pixel-events/types";
import { processBatchEvents } from "~/services/events/pipeline.server";
import { logger } from "~/utils/logger.server";
import { getShopForPixelVerificationWithConfigs } from "./api.pixel-events/key-validation";
import { validatePixelEventHMAC } from "./api.pixel-events/hmac-validation";
import { validateRequest, isPrimaryEvent } from "./api.pixel-events/validation";
import { API_CONFIG, RATE_LIMIT_CONFIG } from "~/utils/config";
import { isDevMode } from "~/utils/origin-validation";
import {
  generateEventIdForType,
  generateOrderMatchKey,
  isClientEventRecorded,
  createEventNonce,
  upsertPixelEventReceipt,
  evaluateTrustLevel,
} from "./api.pixel-events/receipt-handler";
import type { KeyValidationResult } from "./api.pixel-events/types";
import { checkInitialConsent } from "./api.pixel-events/consent-filter";
import { checkRateLimitAsync } from "~/middleware/rate-limit";
import { safeFireAndForget } from "~/utils/helpers";

const MAX_BATCH_SIZE = 100;
const TIMESTAMP_WINDOW_MS = API_CONFIG.TIMESTAMP_WINDOW_MS;
const INGEST_RATE_LIMIT = RATE_LIMIT_CONFIG.PIXEL_EVENTS;

export const action = async ({ request }: ActionFunctionArgs) => {

  const contentType = request.headers.get("Content-Type");
  if (!contentType || (!contentType.includes("application/json") && !contentType.includes("text/plain"))) {
    return jsonWithCors(
      { error: "Content-Type must be application/json or text/plain" },
      { status: 415, request }
    );
  }

  let bodyText: string;
  let bodyData: unknown;
  try {
    bodyText = await request.text();
    bodyData = JSON.parse(bodyText);
  } catch (error) {
    return jsonWithCors(
      { error: "Invalid JSON body" },
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

    const rateLimitKey = `ingest:${shopDomain}`;
    const rateLimit = await checkRateLimitAsync(
      rateLimitKey,
      INGEST_RATE_LIMIT.maxRequests,
      INGEST_RATE_LIMIT.windowMs
    );
    if (!rateLimit.allowed) {
      logger.warn(`Rate limit exceeded for ingest`, {
        shopDomain,
        retryAfter: rateLimit.retryAfter,
      });
      const response = jsonWithCors(
        { error: "Rate limit exceeded", retryAfter: rateLimit.retryAfter },
        { status: 429, request }
      );
      response.headers.set("Retry-After", String(rateLimit.retryAfter ?? 0));
      response.headers.set("X-RateLimit-Limit", String(INGEST_RATE_LIMIT.maxRequests));
      response.headers.set("X-RateLimit-Remaining", "0");
      response.headers.set("X-RateLimit-Reset", String(Math.ceil(rateLimit.resetAt / 1000)));
      response.headers.set("X-RateLimit-Key", rateLimitKey);
      return response;
    }

    if (isProduction) {
      if (!shop.ingestionSecret) {
        logger.error(`Missing ingestionSecret for ${shopDomain} in production`);
        return jsonWithCors(
          { error: "Server configuration error" },
          { status: 500, request }
        );
      }

      if (!signature) {
        logger.warn(`Missing HMAC signature for ${shopDomain} in production`);
        return jsonWithCors(
          { error: "Missing signature" },
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
        logger.warn(`HMAC verification failed for ${shopDomain}: ${hmacResult.reason}`);
        return jsonWithCors(
          { error: "Invalid signature", errorCode: hmacResult.errorCode },
          { status: 403, request }
        );
      }
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

    const origin = request.headers.get("Origin");

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

      if (isPurchaseEvent && orderId) {
        try {
          const trustResult = evaluateTrustLevel(keyValidation, !!payload.data.checkoutToken);
          const originHost = origin ? new URL(origin).host : null;

          await upsertPixelEventReceipt(
            shop.id,
            orderId,
            eventId,
            payload,
            keyValidation,
            trustResult,
            usedCheckoutTokenAsFallback,
            origin,
            eventType
          );
        } catch (error) {
          logger.warn(`Failed to write receipt for purchase event at index ${i}`, {
            shopId: shop.id,
            orderId,
            error: error instanceof Error ? error.message : String(error),
          });

        }
      }

      const clientSideConfigs = pixelConfigs.filter(config => config.clientSideEnabled === true);
      const destinations = clientSideConfigs.map(config => config.platform);

      const consentResult = checkInitialConsent(payload.consent);
      if (!consentResult.hasAnyConsent) {
        logger.debug(`Event at index ${i} has no consent, skipping`, {
          shopDomain,
          eventName: payload.eventName,
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
