import type { PixelEventPayload, KeyValidationResult } from "./types";
import { validateRequest, isPrimaryEvent } from "./validation";
import { generateEventIdForType, generateOrderMatchKey, createEventNonce, upsertPixelEventReceipt } from "./receipt-handler";
import { checkInitialConsent, filterPlatformsByConsent, logConsentFilterMetrics } from "./consent-filter";
import { hashValueSync } from "~/utils/crypto.server";
import { logger } from "~/utils/logger.server";
import prisma from "~/db.server";
import { API_CONFIG } from "~/utils/config.server";

const TIMESTAMP_WINDOW_MS = API_CONFIG.TIMESTAMP_WINDOW_MS;

export interface ValidationResult {
  valid: boolean;
  payload?: PixelEventPayload;
  error?: string;
  code?: string;
}

export interface NormalizedEvent {
  payload: PixelEventPayload;
  eventId: string | null;
  orderId: string | null;
  altOrderKey: string | null;
  eventIdentifier: string | null;
  normalizedItems: Array<{ id: string; quantity: number }>;
}

export interface DeduplicatedEvent extends NormalizedEvent {
  isDuplicate: boolean;
  isReplay: boolean;
}

export interface ProcessedEvent extends DeduplicatedEvent {
  destinations: string[];
  platformsToRecord: Array<{ platform: string; configId?: string; platformId?: string }>;
  skippedPlatforms: string[];
}

export function validateEvents(
  events: unknown[],
  shopDomain: string,
  _timestamp: number
): Array<{ payload: PixelEventPayload; index: number }> {
  const validated: Array<{ payload: PixelEventPayload; index: number }> = [];
  const now = Date.now();
  
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
    
    validated.push({ payload, index: i });
  }
  
  return validated;
}

export function normalizeEvents(
  validatedEvents: Array<{ payload: PixelEventPayload; index: number }>,
  shopDomain: string,
  mode: "purchase_only" | "full_funnel"
): NormalizedEvent[] {
  const normalized: NormalizedEvent[] = [];
  
  for (const { payload, index } of validatedEvents) {
    if (!isPrimaryEvent(payload.eventName, mode)) {
      logger.debug(`Event ${payload.eventName} at index ${index} not accepted for ${shopDomain} (mode: ${mode}) - skipping`);
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
      } catch (error) {
        logger.warn(`Failed to generate order match key for event at index ${index}`, {
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
    
    normalized.push({
      payload,
      eventId,
      orderId,
      altOrderKey,
      eventIdentifier,
      normalizedItems,
    });
  }
  
  return normalized;
}

export async function deduplicateEvents(
  normalizedEvents: NormalizedEvent[],
  shopId: string,
  shopDomain: string
): Promise<DeduplicatedEvent[]> {
  const deduplicated: DeduplicatedEvent[] = [];
  const purchaseKeys = new Set<string>();
  for (const event of normalizedEvents) {
    const eventType = event.payload.eventName === "checkout_completed" ? "purchase" : event.payload.eventName;
    if (eventType !== "purchase") continue;
    if (!event.orderId) continue;
    purchaseKeys.add(event.orderId);
    if (event.altOrderKey != null && event.altOrderKey !== "") {
      purchaseKeys.add(event.altOrderKey);
    }
  }
  const purchaseKeyList = Array.from(purchaseKeys);
  const existingPurchaseKeys = new Set<string>();
  if (purchaseKeyList.length > 0) {
    try {
      const existing = await prisma.pixelEventReceipt.findMany({
        where: {
          shopId,
          eventType: "purchase",
          OR: [
            { orderKey: { in: purchaseKeyList } },
            { altOrderKey: { in: purchaseKeyList } },
          ],
        },
        select: {
          orderKey: true,
          altOrderKey: true,
        },
      });
      for (const r of existing) {
        if (typeof r.orderKey === "string" && r.orderKey) existingPurchaseKeys.add(r.orderKey);
        if (typeof r.altOrderKey === "string" && r.altOrderKey) existingPurchaseKeys.add(r.altOrderKey);
      }
    } catch (error) {
      logger.warn(`Failed to prefetch purchase receipts for deduplication`, {
        shopDomain,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const seenPurchaseKeys = new Set<string>();
  
  for (const event of normalizedEvents) {
    const eventType = event.payload.eventName === "checkout_completed" ? "purchase" : event.payload.eventName;
    const isPurchaseEvent = eventType === "purchase";
    
    let isDuplicate = false;
    let isReplay = false;
    
    if (isPurchaseEvent && event.orderId) {
      try {
        const keysForEvent = [event.orderId];
        if (event.altOrderKey != null && event.altOrderKey !== "" && event.altOrderKey !== event.orderId) {
          keysForEvent.push(event.altOrderKey);
        }
        const alreadyRecorded =
          keysForEvent.some((k) => existingPurchaseKeys.has(k)) ||
          keysForEvent.some((k) => seenPurchaseKeys.has(k));
        if (alreadyRecorded) {
          const orderIdHash = hashValueSync(event.orderId).slice(0, 12);
          logger.debug(`Purchase event already recorded for order ${orderIdHash}, skipping`, {
            shopId,
            orderIdHash,
            eventType,
          });
          isDuplicate = true;
        } else {
          const nonceFromBody = event.payload.nonce;
          const nonceResult = await createEventNonce(
            shopId,
            event.orderId,
            event.payload.timestamp,
            nonceFromBody,
            eventType
          );
          
          if (nonceResult.isReplay) {
            const orderIdHash = hashValueSync(event.orderId).slice(0, 12);
            logger.debug(`Replay detected for order ${orderIdHash}, skipping`, {
              shopId,
              orderIdHash,
              eventType,
            });
            isReplay = true;
          } else {
            for (const k of keysForEvent) {
              seenPurchaseKeys.add(k);
            }
          }
        }
      } catch (error) {
        logger.warn(`Failed to check duplicate for purchase event`, {
          shopDomain,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }
    
    if (!isDuplicate && !isReplay) {
      deduplicated.push({
        ...event,
        isDuplicate,
        isReplay,
      });
    }
  }
  
  return deduplicated;
}

export async function distributeEvents(
  deduplicatedEvents: DeduplicatedEvent[],
  shopId: string,
  shopDomain: string,
  serverSideConfigs: Array<{
    platform: string;
    id: string;
    platformId?: string | null;
    clientSideEnabled?: boolean | null;
    serverSideEnabled?: boolean | null;
    clientConfig?: unknown;
  }>,
  keyValidation: KeyValidationResult,
  origin: string | null,
  activeVerificationRunId: string | null | undefined
): Promise<ProcessedEvent[]> {
  const processed: ProcessedEvent[] = [];
  
  for (const event of deduplicatedEvents) {
    const consentResult = checkInitialConsent(event.payload.consent);
    
    const mappedConfigs = serverSideConfigs.map((config) => ({
      platform: config.platform,
      id: config.id,
      platformId: config.platformId ?? undefined,
      clientSideEnabled: config.clientSideEnabled ?? undefined,
      serverSideEnabled: config.serverSideEnabled ?? undefined,
      clientConfig: config.clientConfig && typeof config.clientConfig === 'object' && 'treatAsMarketing' in (config.clientConfig as object)
        ? { treatAsMarketing: (config.clientConfig as { treatAsMarketing?: boolean }).treatAsMarketing }
        : null,
    }));
    
    const { platformsToRecord, skippedPlatforms } = filterPlatformsByConsent(
      mappedConfigs,
      consentResult
    );
    
    const destinations = platformsToRecord.map((p) => p.platform);
    
    if (destinations.length === 0) {
      logger.debug(`Event has no allowed platforms after consent filtering, skipping`, {
        shopDomain,
        eventName: event.payload.eventName,
        consent: event.payload.consent,
      });
      continue;
    }
    
    const isPurchaseEvent = event.payload.eventName === "checkout_completed";
    
    if (isPurchaseEvent && event.orderId) {
      if (activeVerificationRunId === undefined) {
        const run = await prisma.verificationRun.findFirst({
          where: { shopId, status: "running" },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        activeVerificationRunId = run?.id ?? null;
      }
      
      logConsentFilterMetrics(
        shopDomain,
        event.orderId,
        platformsToRecord,
        skippedPlatforms,
        consentResult
      );
      
      try {
        const primaryPlatform = platformsToRecord.length > 0 ? platformsToRecord[0].platform : null;
        const eventType = "purchase";
        await upsertPixelEventReceipt(
          shopId,
          event.eventId!,
          event.payload,
          origin,
          eventType,
          activeVerificationRunId ?? null,
          primaryPlatform || null,
          event.orderId || null,
          event.altOrderKey,
          destinations.length > 0,
          keyValidation.trustLevel,
          keyValidation.matched
        );
      } catch (error) {
        const orderIdHash = event.orderId ? hashValueSync(event.orderId).slice(0, 12) : null;
        logger.warn(`Failed to write receipt for purchase event`, {
          shopId,
          orderIdHash,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    
    const payloadWithTrust = {
      ...event.payload,
      data: {
        ...event.payload.data,
        hmacTrustLevel: keyValidation.trustLevel || "untrusted",
        hmacMatched: keyValidation.matched,
      },
    };
    
    processed.push({
      ...event,
      destinations,
      platformsToRecord,
      skippedPlatforms,
      payload: payloadWithTrust,
    });
  }
  
  return processed;
}
