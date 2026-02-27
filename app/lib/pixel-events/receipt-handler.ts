import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "../../db.server";
import { generateEventId, generateMatchKey, makeOrderKey, hashValueSync } from "../../utils/crypto.server";
import { extractOriginHost } from "../../utils/origin-validation.server";
import { logger } from "../../utils/logger.server";
import { RETENTION_CONFIG } from "../../utils/config.server";
import { generateSimpleId } from "../../utils/helpers";
import type { TrustLevel } from "../../utils/receipt-trust.server";
import type { PixelEventPayload, KeyValidationResult } from "./types";
import { generateCanonicalEventId } from "../../services/event-normalizer.server";
import { getRedisClient, getRedisClientStrict } from "../../utils/redis-client.server";

function buildMinimalPayloadForReceipt(
  payload: PixelEventPayload,
  trustLevel?: string,
  hmacMatched?: boolean,
  platform?: string | null
): Record<string, unknown> {
  const items = (payload.data?.items ?? [])
    .slice(0, 50)
    .map((i) => ({
      id: String(i?.id ?? ""),
      quantity: typeof i?.quantity === "number" ? i.quantity : 1,
    }));
  const base: Record<string, unknown> = {
    consent: payload.consent,
    data: {
      value: payload.data?.value ?? 0,
      currency: payload.data?.currency ?? "USD",
      items,
      url: (payload.data as any)?.url,
    },
    eventName: payload.eventName,
    trustLevel: trustLevel ?? "untrusted",
    hmacMatched: hmacMatched ?? false,
  };
  if (platform != null && platform !== "") {
    base.platform = platform;
    base.destination = platform;
  }
  return base;
}

export interface MatchKeyResult {
  orderId: string;
  altOrderKey: string | null;
  usedCheckoutTokenAsFallback: boolean;
}

export function generateOrderMatchKey(
  orderId: string | null | undefined,
  checkoutToken: string | null | undefined,
  _shopDomain?: string
): MatchKeyResult {
  const hasOrderId = orderId != null && orderId !== "";
  const hasCheckout = checkoutToken != null && checkoutToken !== "";
  if (hasOrderId && hasCheckout) {
    const orderKey = generateMatchKey({ orderId, checkoutToken: null }).matchKey;
    const altOrderKey = makeOrderKey({ checkoutToken });
    return {
      orderId: orderKey,
      altOrderKey: altOrderKey ?? null,
      usedCheckoutTokenAsFallback: false,
    };
  }
  const r = generateMatchKey({ orderId: orderId || null, checkoutToken: checkoutToken || null });
  return {
    orderId: r.matchKey,
    altOrderKey: null,
    usedCheckoutTokenAsFallback: !r.isOrderId && !!r.checkoutToken,
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
  opts?: { altOrderKey?: string | null }
): Promise<boolean> {
  const orList: Array<{ orderKey?: string; altOrderKey?: string }> = [
    { orderKey },
    { altOrderKey: orderKey },
  ];
  if (opts?.altOrderKey != null && opts.altOrderKey !== "" && opts.altOrderKey !== orderKey) {
    orList.push({ orderKey: opts.altOrderKey }, { altOrderKey: opts.altOrderKey });
  }
  const existing = await prisma.pixelEventReceipt.findFirst({
    where: {
      shopId,
      eventType,
      OR: orList,
    },
    select: { id: true },
  });
  return !!existing;
}

export async function upsertPixelEventReceipt(
  shopId: string,
  eventId: string,
  payload: PixelEventPayload,
  origin: string | null,
  eventType: string = "purchase",
  verificationRunId?: string | null,
  platform?: string | null,
  orderKey?: string | null,
  altOrderKey?: string | null,
  storePayload: boolean = true,
  trustLevel?: string,
  hmacMatched?: boolean,
  environment?: "test" | "live"
): Promise<ReceiptCreateResult> {
  const originHost = extractOriginHost(origin);
  const checkoutToken = payload.data?.checkoutToken;
  const checkoutFingerprint =
    typeof checkoutToken === "string" && checkoutToken.trim() !== ""
      ? hashValueSync(checkoutToken)
      : null;
  const payloadData = payload?.data as Record<string, unknown> | undefined;
  const extractedOrderKey = orderKey || (payloadData?.orderId as string | undefined);
  const platformValue = platform ?? "unknown";
  const environmentValue = environment ?? "live";
  try {
    let payloadToStore: Record<string, unknown> | null = null;
    if (storePayload && payload) {
      const { sanitizePII } = await import("../../services/event-log.server");
      const sanitized = sanitizePII(payload);
      if (verificationRunId) {
        const base =
          sanitized && typeof sanitized === "object" ? (sanitized as Record<string, unknown>) : {};
        const baseData =
          base.data && typeof base.data === "object" && base.data !== null
            ? (base.data as Record<string, unknown>)
            : null;
        payloadToStore = {
          ...base,
          ...(baseData
            ? { data: { ...baseData, hmacMatched: hmacMatched ?? false } }
            : {}),
          trustLevel:
            typeof base.trustLevel === "string"
              ? base.trustLevel
              : trustLevel ?? "untrusted",
          hmacMatched: hmacMatched ?? false,
        };
        if (platform != null && platform !== "") {
          payloadToStore.platform = platform;
          payloadToStore.destination = platform;
        }
      } else {
        const sanitizedPayload =
          sanitized && typeof sanitized === "object"
            ? (sanitized as PixelEventPayload)
            : payload;
        payloadToStore = buildMinimalPayloadForReceipt(sanitizedPayload, trustLevel, hmacMatched, platform);
      }
    }
    let receipt;
    const trustLevelValue = trustLevel ?? "untrusted";
    const hmacMatchedValue = hmacMatched ?? false;
    const totalValue = payloadData?.value ? new Prisma.Decimal(Number(payloadData.value) || 0) : null;
    const currency = typeof payloadData?.currency === "string" ? payloadData.currency : null;

    try {
      receipt = await prisma.pixelEventReceipt.create({
        data: {
          id: generateSimpleId("receipt"),
          shopId,
          eventId,
          eventType,
          platform: platformValue,
          environment: environmentValue,
          pixelTimestamp: new Date(payload.timestamp),
          originHost: originHost || null,
          verificationRunId: verificationRunId || null,
          payloadJson: payloadToStore === null ? Prisma.JsonNull : (payloadToStore as Prisma.InputJsonValue),
          checkoutFingerprint,
          orderKey: extractedOrderKey || null,
          altOrderKey: altOrderKey ?? null,
          trustLevel: trustLevelValue,
          hmacMatched: hmacMatchedValue,
          totalValue: totalValue,
          currency: currency,
        },
        select: {
          id: true,
          orderKey: true,
          eventType: true,
          pixelTimestamp: true,
          createdAt: true,
          payloadJson: true,
        },
      });
    } catch (createError) {
      if (createError instanceof Prisma.PrismaClientKnownRequestError && createError.code === "P2002") {
        if (verificationRunId) {
          receipt = await prisma.pixelEventReceipt.update({
            where: {
              shopId_eventId_eventType_platform: {
                shopId,
                eventId,
                eventType,
                platform: platformValue,
              },
            },
            data: {
              pixelTimestamp: new Date(payload.timestamp),
              originHost: originHost || null,
              verificationRunId: verificationRunId || null,
              payloadJson: payloadToStore === null ? Prisma.JsonNull : (payloadToStore as Prisma.InputJsonValue),
              checkoutFingerprint,
              orderKey: extractedOrderKey || null,
              altOrderKey: altOrderKey ?? null,
              trustLevel: trustLevelValue,
              hmacMatched: hmacMatchedValue,
              totalValue: totalValue,
              currency: currency,
              environment: environmentValue,
            },
            select: {
              id: true,
              orderKey: true,
              eventType: true,
              pixelTimestamp: true,
              createdAt: true,
              payloadJson: true,
            },
          });
        } else {
          const existing = await prisma.pixelEventReceipt.findUnique({
            where: {
              shopId_eventId_eventType_platform: {
                shopId,
                eventId,
                eventType,
                platform: platformValue,
              },
            },
            select: {
              id: true,
              orderKey: true,
              eventType: true,
              pixelTimestamp: true,
              createdAt: true,
              payloadJson: true,
            },
          });
          if (!existing) {
            throw createError;
          }
          receipt = existing;
        }
      } else {
        // P0: Do not swallow other errors. Throw them so the caller can handle them (e.g. fallback to Redis)
        throw createError;
      }
    }
    try {
      const redis = await getRedisClient();
      if (eventType === "purchase" && receipt.orderKey) {
        const ttlSeconds = 7 * 24 * 60 * 60;
        const dedupKey = `dedup:purchase:${shopId}:${receipt.orderKey}`;
        await redis.set(dedupKey, "1", { EX: ttlSeconds }).catch(() => {});
        if (altOrderKey && altOrderKey !== receipt.orderKey) {
          const altDedupKey = `dedup:purchase:${shopId}:${altOrderKey}`;
          await redis.set(altDedupKey, "1", { EX: ttlSeconds }).catch(() => {});
        }
      }
    } catch (redisErr) {
      logger.warn("Failed to set Redis deduplication key after receipt creation", {
        shopId,
        eventId,
        error: String(redisErr)
      });
    }
    return { success: true, eventId };
  } catch (error) {
    logger.warn(`Failed to write PixelEventReceipt for event ${eventType}`, {
      error: String(error),
    });
    return { success: false, eventId };
  }
}

export async function getActivePixelConfigs(
  shopId: string
): Promise<Array<{ platform: string }>> {
  return prisma.pixelConfig.findMany({
    where: {
      shopId,
      isActive: true,
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
    const redis = await getRedisClientStrict();
    const ok = await redis.setNX(key, "1", ttlMs);
    return { isReplay: !ok };
  } catch (redisError) {
    logger.error("Failed to check event nonce in Redis", {
      shopId,
      eventType,
      orderIdHash: hashValueSync(orderId).slice(0, 12),
      timestamp,
      error: redisError instanceof Error ? redisError.message : String(redisError),
    });
    // P1-1: DB fallback removed as EventNonce table is deleted. Fail open (allow event).
    return { isReplay: false };
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
