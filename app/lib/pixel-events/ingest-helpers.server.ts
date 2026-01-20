import type { Request } from "@remix-run/node";
import type { PixelEventPayload, KeyValidationResult } from "~/lib/pixel-events/types";
import { validateRequest, isPrimaryEvent } from "~/lib/pixel-events/validation";
import { validatePixelEventHMAC } from "~/lib/pixel-events/hmac-validation";
import { verifyWithGraceWindowAsync } from "~/utils/shop-access";
import { getShopForPixelVerificationWithConfigs } from "~/lib/pixel-events/key-validation";
import { validatePixelOriginPreBody, validatePixelOriginForShop, buildShopAllowedDomains } from "~/utils/origin-validation";
import { generateEventIdForType, generateOrderMatchKey, isClientEventRecorded, createEventNonce, upsertPixelEventReceipt } from "~/lib/pixel-events/receipt-handler";
import { checkInitialConsent, filterPlatformsByConsent, logConsentFilterMetrics } from "~/lib/pixel-events/consent-filter";
import { API_CONFIG, isStrictSecurityMode } from "~/utils/config.server";
import { isDevMode } from "~/utils/origin-validation";
import { hashValueSync } from "~/utils/crypto.server";
import { logger, metrics } from "~/utils/logger.server";
import { trackAnomaly } from "~/utils/rate-limiter";
import prisma from "~/db.server";

const TIMESTAMP_WINDOW_MS = API_CONFIG.TIMESTAMP_WINDOW_MS;

export interface ParseRequestResult {
  bodyText: string;
  bodyData: unknown;
  events: unknown[];
  batchTimestamp?: number;
  firstPayload: PixelEventPayload;
  shopDomain: string;
  timestamp: number;
  environment: "test" | "live";
}

export async function parseAndValidateRequest(request: Request): Promise<ParseRequestResult | Response> {
  const bodyText = await request.text();
  if (bodyText.length > API_CONFIG.MAX_BODY_SIZE) {
    return new Response(
      JSON.stringify({ error: "Payload too large", maxSize: API_CONFIG.MAX_BODY_SIZE }),
      { status: 413, headers: { "Content-Type": "application/json" } }
    );
  }
  let bodyData: unknown;
  try {
    bodyData = JSON.parse(bodyText);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({ error: "Failed to read request body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  const isBatchFormat =
    typeof bodyData === "object" &&
    bodyData !== null &&
    "events" in bodyData &&
    Array.isArray((bodyData as { events?: unknown }).events);
  let events: unknown[];
  let batchTimestamp: number | undefined;
  if (isBatchFormat) {
    const batchData = bodyData as { events: unknown[]; timestamp?: number };
    events = batchData.events || [];
    batchTimestamp = batchData.timestamp;
  } else {
    const singleEventValidation = validateRequest(bodyData);
    if (!singleEventValidation.valid) {
      return new Response(
        JSON.stringify({ error: "Invalid request" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    events = [bodyData];
    batchTimestamp = singleEventValidation.payload.timestamp;
  }
  if (events.length === 0) {
    return new Response(
      JSON.stringify({ error: "events array cannot be empty" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  const firstEventValidation = validateRequest(events[0]);
  if (!firstEventValidation.valid) {
    return new Response(
      JSON.stringify({ error: "Invalid event in batch", details: firstEventValidation.error }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  const firstPayload = firstEventValidation.payload;
  const shopDomain = firstPayload.shopDomain;
  const timestamp = batchTimestamp ?? firstPayload.timestamp;
  const nowForWindow = Date.now();
  if (Math.abs(nowForWindow - timestamp) > TIMESTAMP_WINDOW_MS) {
    return new Response(null, { status: 204 });
  }
  const environment = (firstPayload.data as { environment?: "test" | "live" })?.environment || "live";
  return {
    bodyText,
    bodyData,
    events,
    batchTimestamp,
    firstPayload,
    shopDomain,
    timestamp,
    environment,
  };
}

export async function validateOriginAndShop(
  request: Request,
  origin: string | null,
  hasSignatureHeader: boolean,
  shopDomain: string,
  environment: "test" | "live",
  isProduction: boolean,
  strictOrigin: boolean
): Promise<{ shop: Awaited<ReturnType<typeof getShopForPixelVerificationWithConfigs>>; shopAllowedDomains: string[] } | Response> {
  const preBodyValidation = validatePixelOriginPreBody(origin, hasSignatureHeader, request.headers.has("Origin"));
  if (!preBodyValidation.valid) {
    const shopDomainHeader = request.headers.get("x-shopify-shop-domain") || "unknown";
    const anomalyCheck = trackAnomaly(shopDomainHeader, "invalid_origin");
    if (anomalyCheck.shouldBlock) {
      logger.warn(`Anomaly threshold reached for ${shopDomainHeader}: ${anomalyCheck.reason}`);
    }
    if (preBodyValidation.shouldReject && (isProduction || !hasSignatureHeader || strictOrigin)) {
      metrics.pixelRejection({
        shopDomain: shopDomainHeader,
        reason: preBodyValidation.reason as "invalid_origin" | "invalid_origin_protocol",
        originType: preBodyValidation.reason,
      });
      return new Response(
        JSON.stringify({ error: "Invalid origin" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }
  }
  const shop = await getShopForPixelVerificationWithConfigs(shopDomain, environment);
  if (!shop || !shop.isActive) {
    if (isProduction) {
      logger.warn(`Shop not found or inactive for ingest`, {
        shopDomain,
        exists: !!shop,
        isActive: shop?.isActive,
      });
      return new Response(
        JSON.stringify({ error: "Invalid request" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({ error: "Shop not found or inactive" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
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
    hasSignatureHeaderOrHMAC: hasSignatureHeader,
  });
  if (!shopOriginValidation.valid && shopOriginValidation.shouldReject) {
    const anomalyCheck = trackAnomaly(shop.shopDomain, "invalid_origin");
    if (anomalyCheck.shouldBlock) {
      logger.warn(`Anomaly threshold reached for ${shop.shopDomain}: ${anomalyCheck.reason}`);
    }
    if (hasSignatureHeader && !strictOrigin && !isProduction) {
      logger.warn(`Signed ingest request allowed despite origin rejection for ${shop.shopDomain}`, {
        origin: origin?.substring(0, 100) || "null",
        reason: shopOriginValidation.reason,
      });
    }
    if (!hasSignatureHeader || strictOrigin || isProduction) {
      metrics.pixelRejection({
        shopDomain: shop.shopDomain,
        reason: "origin_not_allowlisted",
        originType: shopOriginValidation.reason,
      });
      return new Response(
        JSON.stringify({ error: "Origin not allowlisted" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }
  }
  return { shop, shopAllowedDomains };
}

export async function validateHMACSignature(
  request: Request,
  bodyText: string,
  shop: NonNullable<Awaited<ReturnType<typeof getShopForPixelVerificationWithConfigs>>>,
  shopDomain: string,
  timestamp: number,
  signature: string | null,
  allowUnsignedEvents: boolean
): Promise<KeyValidationResult> {
  let keyValidation: KeyValidationResult = {
    matched: false,
    reason: signature ? "hmac_not_verified" : "signature_missing",
    trustLevel: "untrusted",
  };
  const hasAnySecret = Boolean(shop.ingestionSecret || shop.previousIngestionSecret);
  if (signature && hasAnySecret) {
    const verifyWithSecret = async (secret: string) => {
      const result = await validatePixelEventHMAC(
        request,
        bodyText,
        secret,
        shopDomain,
        timestamp,
        TIMESTAMP_WINDOW_MS
      );
      return result;
    };
    const graceResult = await verifyWithGraceWindowAsync(shop, async (secret: string) => {
      const result = await verifyWithSecret(secret);
      return result.valid;
    });
    if (graceResult.matched) {
      const hmacResult = await verifyWithSecret(graceResult.usedPreviousSecret ? shop.previousIngestionSecret! : shop.ingestionSecret!);
      keyValidation = {
        matched: true,
        reason: "hmac_verified",
        usedPreviousSecret: graceResult.usedPreviousSecret,
        trustLevel: hmacResult.trustLevel || "trusted",
      };
      logger.debug(`HMAC signature verified for ${shopDomain}${graceResult.usedPreviousSecret ? " (using previous secret)" : ""}`);
    } else {
      const hmacResult = await verifyWithSecret(shop.ingestionSecret!);
      keyValidation = {
        matched: false,
        reason: "hmac_invalid",
        trustLevel: hmacResult.trustLevel || "untrusted",
      };
      if (isStrictSecurityMode()) {
        logger.warn(`HMAC verification failed for ${shopDomain}: signature did not match current or previous secret`);
      } else {
        logger.warn(`HMAC verification failed for ${shopDomain}: signature did not match (non-strict mode, marking as untrusted)`, {
          trustLevel: keyValidation.trustLevel,
        });
      }
    }
  } else if (signature && !hasAnySecret) {
    keyValidation = {
      matched: false,
      reason: "secret_missing",
      trustLevel: "untrusted",
    };
    logger.warn(`HMAC signature received for ${shopDomain} but ingestion secret is missing`);
  } else if (!signature && allowUnsignedEvents) {
    keyValidation = {
      matched: true,
      reason: "signature_skipped_env",
      trustLevel: "partial",
    };
  } else if (!signature && !hasAnySecret) {
    keyValidation = {
      matched: false,
      reason: "secret_missing",
      trustLevel: "untrusted",
    };
  } else if (!signature) {
    keyValidation = {
      matched: false,
      reason: "signature_missing",
      trustLevel: "untrusted",
    };
  }
  if (!keyValidation.matched && !isStrictSecurityMode()) {
    logger.warn(`HMAC validation failed but allowing request in non-strict mode`, {
      shopDomain,
      reason: keyValidation.reason,
      trustLevel: keyValidation.trustLevel,
    });
  }
  return keyValidation;
}

export interface ValidatedEvent {
  payload: PixelEventPayload;
  eventId: string | null;
  destinations: string[];
}

export async function validateEvents(
  events: unknown[],
  shop: NonNullable<Awaited<ReturnType<typeof getShopForPixelVerificationWithConfigs>>>,
  shopDomain: string,
  origin: string | null,
  mode: "purchase_only" | "full_funnel",
  keyValidation: KeyValidationResult
): Promise<ValidatedEvent[]> {
  const validatedEvents: ValidatedEvent[] = [];
  const serverSideConfigs = shop.pixelConfigs.filter(config => config.serverSideEnabled === true);
  let activeVerificationRunId: string | null | undefined = undefined;
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
    const now = Date.now();
    const eventTimeDiff = Math.abs(now - payload.timestamp);
    if (eventTimeDiff > TIMESTAMP_WINDOW_MS) {
      logger.debug(`Event at index ${i} timestamp outside window: diff=${eventTimeDiff}ms, skipping`, {
        shopDomain,
        eventTimestamp: payload.timestamp,
        currentTime: now,
        windowMs: TIMESTAMP_WINDOW_MS,
      });
      continue;
    }
    if (!isPrimaryEvent(payload.eventName, mode)) {
      logger.debug(`Event ${payload.eventName} at index ${i} not accepted for ${shopDomain} (mode: ${mode}) - skipping`);
      continue;
    }
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
    let altOrderKey: string | null = null;
    let eventIdentifier: string | null = null;
    if (isPurchaseEvent) {
      try {
        const matchKeyResult = generateOrderMatchKey(
          payload.data.orderId,
          payload.data.checkoutToken,
          shopDomain
        );
        orderId = matchKeyResult.orderId;
        altOrderKey = matchKeyResult.altOrderKey;
        eventIdentifier = orderId;
        const alreadyRecorded = await isClientEventRecorded(shop.id, orderId, eventType, altOrderKey != null ? { altOrderKey } : undefined);
        if (alreadyRecorded) {
          const orderIdHash = hashValueSync(orderId).slice(0, 12);
          logger.debug(`Purchase event already recorded for order ${orderIdHash}, skipping`, {
            shopId: shop.id,
            orderIdHash,
            eventType,
          });
          continue;
        }
        const nonceFromBody = payload.nonce;
        const nonceResult = await createEventNonce(
          shop.id,
          orderId,
          payload.timestamp,
          nonceFromBody,
          eventType
        );
        if (nonceResult.isReplay) {
          const orderIdHash = hashValueSync(orderId).slice(0, 12);
          logger.debug(`Replay detected for order ${orderIdHash}, skipping`, {
            shopId: shop.id,
            orderIdHash,
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
        const checkoutTokenHash = hashValueSync(checkoutToken);
        orderId = `checkout_${checkoutTokenHash}`;
        eventIdentifier = orderId;
      } else {
        orderId = `session_${payload.timestamp}_${shopDomain.replace(/\./g, "_")}`;
        eventIdentifier = null;
      }
    }
    const eventId = generateEventIdForType(
      eventIdentifier,
      eventType,
      shopDomain,
      payload.data.checkoutToken,
      normalizedItems.length > 0 ? normalizedItems : undefined,
      payload.nonce ?? null
    );
    const consentResult = checkInitialConsent(payload.consent);
    const mappedConfigs = serverSideConfigs.map(config => ({
      platform: config.platform,
      id: config.id,
      platformId: config.platformId,
      clientSideEnabled: config.clientSideEnabled,
      serverSideEnabled: config.serverSideEnabled,
      clientConfig: config.clientConfig && typeof config.clientConfig === 'object' && 'treatAsMarketing' in config.clientConfig
        ? { treatAsMarketing: (config.clientConfig as { treatAsMarketing?: boolean }).treatAsMarketing }
        : null,
    }));
    const { platformsToRecord, skippedPlatforms } = filterPlatformsByConsent(
      mappedConfigs,
      consentResult
    );
    const destinations = platformsToRecord.map(p => p.platform);
    if (isPurchaseEvent && orderId) {
      if (activeVerificationRunId === undefined) {
        const run = await prisma.verificationRun.findFirst({
          where: { shopId: shop.id, status: "running" },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        activeVerificationRunId = run?.id ?? null;
      }
      logConsentFilterMetrics(
        shopDomain,
        orderId,
        platformsToRecord,
        skippedPlatforms,
        consentResult
      );
      try {
        const primaryPlatform = platformsToRecord.length > 0 ? platformsToRecord[0].platform : null;
        await upsertPixelEventReceipt(
          shop.id,
          eventId,
          payload,
          origin,
          eventType,
          activeVerificationRunId ?? null,
          primaryPlatform || null,
          orderId || null,
          altOrderKey,
          destinations.length > 0
        );
      } catch (error) {
        const orderIdHash = orderId ? hashValueSync(orderId).slice(0, 12) : null;
        logger.warn(`Failed to write receipt for purchase event at index ${i}`, {
          shopId: shop.id,
          orderIdHash,
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
    const payloadWithTrust = {
      ...payload,
      data: {
        ...payload.data,
        hmacTrustLevel: keyValidation.trustLevel || "untrusted",
        hmacMatched: keyValidation.matched,
      },
    };
    validatedEvents.push({
      payload: payloadWithTrust,
      eventId,
      destinations,
    });
  }
  return validatedEvents;
}
