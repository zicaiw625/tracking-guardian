import { createHash } from "crypto";
import { randomUUID } from "crypto";
import prisma from "../../db.server";
import { generateEventId, generateMatchKey, makeOrderKey } from "../../utils/crypto.server";
import { extractOriginHost } from "../../utils/origin-validation";
import { logger } from "../../utils/logger.server";
import { RETENTION_CONFIG } from "../../utils/config";
import { generateSimpleId } from "../../utils/helpers";
import type { TrustLevel } from "../../utils/receipt-trust";
import type { PixelEventPayload, KeyValidationResult } from "./types";
import { generateCanonicalEventId } from "../../services/event-normalizer.server";
import { getRedisClient } from "../../utils/redis-client";

function buildMinimalPayloadForReceipt(payload: PixelEventPayload): Record<string, unknown> {
  const items = (payload.data?.items ?? [])
    .slice(0, 50)
    .map((i) => ({
      id: String(i?.id ?? ""),
      quantity: typeof i?.quantity === "number" ? i.quantity : 1,
    }));
  return {
    consent: payload.consent,
    data: {
      value: payload.data?.value ?? 0,
      currency: payload.data?.currency ?? "USD",
      items,
    },
    eventName: payload.eventName,
  };
}

export interface MatchKeyResult {
  orderId: string;
  usedCheckoutTokenAsFallback: boolean;
}

export function generateOrderMatchKey(
  orderId: string | null | undefined,
  checkoutToken: string | null | undefined,
  shopDomain?: string
): MatchKeyResult {
  const matchKeyResult = generateMatchKey({ orderId: orderId || null, checkoutToken: checkoutToken || null });
  return {
    orderId: matchKeyResult.matchKey,
    usedCheckoutTokenAsFallback: !matchKeyResult.isOrderId && !!matchKeyResult.checkoutToken,
  };
}

export interface TrustEvaluationResult {
  isTrusted: boolean;
  trustLevel: TrustLevel;
  untrustedReason: string | undefined;
}

export interface ReceiptCreateResult {
  success: boolean;
  eventId: string;
}

export interface ConversionLogResult {
  recordedPlatforms: string[];
  failedPlatforms: string[];
}

export async function isClientEventRecorded(
  shopId: string,
  orderKey: string,
  eventType: string,
  opts?: { checkoutToken?: string | null }
): Promise<boolean> {
  const existing = await prisma.pixelEventReceipt.findFirst({
    where: {
      shopId,
      orderKey,
      eventType,
    },
    select: { id: true },
  });
  if (existing) return true;
  if (opts?.checkoutToken != null && opts.checkoutToken !== "") {
    const altKey = makeOrderKey({ checkoutToken: opts.checkoutToken });
    if (altKey && altKey !== orderKey) {
      const altExisting = await prisma.pixelEventReceipt.findFirst({
        where: {
          shopId,
          orderKey: altKey,
          eventType,
        },
        select: { id: true },
      });
      if (altExisting) return true;
    }
  }
  return false;
}

export async function upsertPixelEventReceipt(
  shopId: string,
  eventId: string,
  payload: PixelEventPayload,
  origin: string | null,
  eventType: string = "purchase",
  verificationRunId?: string | null,
  platform?: string | null,
  orderKey?: string | null
): Promise<ReceiptCreateResult> {
  const originHost = extractOriginHost(origin);
  const payloadData = payload?.data as Record<string, unknown> | undefined;
  const extractedOrderKey = orderKey || (payloadData?.orderId as string | undefined);
  try {
    let payloadToStore: Record<string, unknown> | null = null;
    if (payload) {
      if (verificationRunId) {
        const { sanitizePII } = await import("../../services/event-log.server");
        payloadToStore = sanitizePII(payload) as unknown as Record<string, unknown>;
      } else {
        payloadToStore = buildMinimalPayloadForReceipt(payload);
      }
    }
    await prisma.pixelEventReceipt.upsert({
      where: {
        shopId_eventId_eventType: {
          shopId,
          eventId,
          eventType,
        },
      },
      create: {
        id: generateSimpleId("receipt"),
        shopId,
        eventId,
        eventType,
        pixelTimestamp: new Date(payload.timestamp),
        originHost: originHost || null,
        verificationRunId: verificationRunId || null,
        payloadJson: payloadToStore,
        orderKey: extractedOrderKey || null,
      },
      update: {
        pixelTimestamp: new Date(payload.timestamp),
        originHost: originHost || null,
        verificationRunId: verificationRunId || null,
        payloadJson: payloadToStore,
        orderKey: extractedOrderKey || null,
      },
    });
    return { success: true, eventId };
  } catch (error) {
    logger.warn(`Failed to write PixelEventReceipt for event ${eventType}`, {
      error: String(error),
    });
    return { success: false, eventId };
  }
}

function normalizeCurrencyForStorage(currency: unknown): string {
  if (currency && typeof currency === 'string' && currency.trim()) {
    const normalized = currency.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(normalized)) {
      return normalized;
    }
  }
  return "USD";
}

export async function getActivePixelConfigs(
  shopId: string
): Promise<Array<{ platform: string }>> {
  return prisma.pixelConfig.findMany({
    where: {
      shopId,
      isActive: true,
      serverSideEnabled: true,
    },
    select: {
      platform: true,
    },
  });
}

export function generatePurchaseEventId(
  orderId: string,
  shopDomain: string
): string {
  return generateEventId(orderId, "purchase", shopDomain);
}

export function generateEventIdForType(
  identifier: string | null | undefined,
  eventType: string,
  shopDomain: string,
  checkoutToken?: string | null,
  items?: Array<{ id: string; quantity: number }>,
  nonce?: string | null
): string {
  return generateCanonicalEventId(
    identifier || null,
    checkoutToken || null,
    eventType,
    shopDomain,
    items,
    "v2",
    nonce || null
  );
}

export function generateDeduplicationKeyForEvent(
  orderId: string | null,
  checkoutToken: string | null,
  eventName: string,
  items: Array<{ id: string; quantity: number }>,
  shopDomain: string
): string {
  const identifier = orderId || checkoutToken || "";
  const itemsHash = items.length > 0
    ? createHash("sha256")
        .update(
          items
            .sort((a, b) => a.id.localeCompare(b.id))
            .map(item => `${item.id}:${item.quantity}`)
            .join(","),
          "utf8"
        )
        .digest("hex")
        .substring(0, 16)
    : "empty";
  const keyInput = `${shopDomain}:${identifier}:${eventName}:${itemsHash}`;
  return createHash("sha256")
    .update(keyInput, "utf8")
    .digest("hex")
    .substring(0, 32);
}

export async function createEventNonce(
  shopId: string,
  orderId: string,
  timestamp: number,
  nonce: string | null | undefined,
  eventType: string
): Promise<{ isReplay: boolean }> {
  if (!nonce) {
    return { isReplay: false };
  }
  const ttlMs = RETENTION_CONFIG.NONCE_EXPIRY_MS;
  const key = `tg:nonce:${shopId}:${eventType}:${nonce}`;
  try {
    const redis = await getRedisClient();
    const ok = await redis.setNX(key, "1", ttlMs);
    return { isReplay: !ok };
  } catch {
    try {
      await prisma.eventNonce.create({
        data: {
          id: generateSimpleId("nonce"),
          shopId,
          nonce,
          eventType,
          expiresAt: new Date(Date.now() + ttlMs),
        },
      });
      return { isReplay: false };
    } catch {
      return { isReplay: true };
    }
  }
}

export function evaluateTrustLevel(
  keyValidation: KeyValidationResult,
  hasCheckoutToken: boolean
): TrustEvaluationResult {
  if (!keyValidation.matched) {
    return {
      isTrusted: false,
      trustLevel: "untrusted",
      untrustedReason: keyValidation.reason || "key_validation_failed",
    };
  }
  if (!hasCheckoutToken) {
    return {
      isTrusted: false,
      trustLevel: "partial",
      untrustedReason: "missing_checkout_token",
    };
  }
  return {
    isTrusted: true,
    trustLevel: "trusted",
    untrustedReason: undefined,
  };
}
