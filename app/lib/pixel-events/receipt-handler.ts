import { createHash, randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "../../db.server";
import { generateEventId, generateMatchKey, makeOrderKey, hashValueSync } from "../../utils/crypto.server";
import { extractOriginHost } from "../../utils/origin-validation";
import { logger } from "../../utils/logger.server";
import { RETENTION_CONFIG } from "../../utils/config.server";
import { generateSimpleId } from "../../utils/helpers";
import type { TrustLevel } from "../../utils/receipt-trust.server";
import type { PixelEventPayload, KeyValidationResult } from "./types";
import { generateCanonicalEventId } from "../../services/event-normalizer.server";
import { getRedisClient } from "../../utils/redis-client";

function buildMinimalPayloadForReceipt(
  payload: PixelEventPayload,
  trustLevel?: string,
  hmacMatched?: boolean
): Record<string, unknown> {
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
    trustLevel: trustLevel ?? "untrusted",
    hmacMatched: hmacMatched ?? false,
  };
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
  hmacMatched?: boolean
): Promise<ReceiptCreateResult> {
  const originHost = extractOriginHost(origin);
  const checkoutToken = payload.data?.checkoutToken;
  const checkoutFingerprint =
    typeof checkoutToken === "string" && checkoutToken.trim() !== ""
      ? hashValueSync(checkoutToken)
      : null;
  const payloadData = payload?.data as Record<string, unknown> | undefined;
  const extractedOrderKey = orderKey || (payloadData?.orderId as string | undefined);
  try {
    let payloadToStore: Record<string, unknown> | null = null;
    if (storePayload && payload) {
      if (verificationRunId) {
        const { sanitizePII } = await import("../../services/event-log.server");
        payloadToStore = sanitizePII(payload) as unknown as Record<string, unknown>;
      } else {
        payloadToStore = buildMinimalPayloadForReceipt(payload, trustLevel, hmacMatched);
      }
    }
    const receipt = await prisma.pixelEventReceipt.upsert({
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
        payloadJson: payloadToStore === null ? Prisma.JsonNull : (payloadToStore as Prisma.InputJsonValue),
        checkoutFingerprint,
        orderKey: extractedOrderKey || null,
        altOrderKey: altOrderKey ?? null,
      },
      update: {
        pixelTimestamp: new Date(payload.timestamp),
        originHost: originHost || null,
        verificationRunId: verificationRunId || null,
        payloadJson: payloadToStore === null ? Prisma.JsonNull : (payloadToStore as Prisma.InputJsonValue),
        checkoutFingerprint,
        orderKey: extractedOrderKey || null,
        altOrderKey: altOrderKey ?? null,
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
    try {
      const redis = await getRedisClient();
      const payloadStored = receipt.payloadJson as Record<string, unknown> | null;
      const data = payloadStored?.data as Record<string, unknown> | undefined;
      const value = typeof data?.value === "number" ? data.value : 0;
      const currency = (data?.currency as string) || "USD";
      const items = data?.items as Array<unknown> | undefined;
      const itemsCount = Array.isArray(items) ? items.length : 0;
      const trust = {
        trustLevel: (payloadStored?.trustLevel as string) || "untrusted",
        hmacMatched: typeof payloadStored?.hmacMatched === "boolean" ? (payloadStored.hmacMatched as boolean) : false,
      };
      const status = value > 0 && !!currency ? "success" : "pending";
      const message = JSON.stringify({
        id: receipt.id,
        eventType: receipt.eventType,
        orderId: receipt.orderKey || "",
        platform: platform || "pixel",
        timestamp: (receipt.pixelTimestamp || receipt.createdAt).toISOString(),
        status,
        params: {
          value,
          currency,
          itemsCount,
          hasEventId: true,
        },
        trust,
      });
      await redis.publish(`sse:shop:${shopId}`, message);
    } catch {
      void 0;
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
  } catch (redisError) {
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
    } catch (dbError) {
      const code =
        dbError instanceof Prisma.PrismaClientKnownRequestError
          ? dbError.code
          : typeof dbError === "object" && dbError !== null && "code" in dbError
            ? String((dbError as { code?: unknown }).code)
            : null;
      if (code === "P2002") {
        return { isReplay: true };
      }
      logger.error("Failed to create event nonce (DB fallback)", {
        shopId,
        eventType,
        orderIdHash: hashValueSync(orderId).slice(0, 12),
        timestamp,
        redisError: redisError instanceof Error ? redisError.message : String(redisError),
        dbError: dbError instanceof Error ? dbError.message : String(dbError),
      });
      return { isReplay: false };
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

const REORDER_NONCE_TTL_MS = 5 * 60 * 1000;
const SURVEY_NONCE_TTL_MS = 5 * 60 * 1000;

export async function createReorderNonce(
  shopId: string,
  orderId: string,
  surface: string
): Promise<{ success: boolean; nonce?: string; error?: string }> {
  const timestamp = Date.now();
  const randomHex = randomBytes(12).toString("hex");
  const nonce = `${timestamp}-${randomHex}`;
  const ttlMs = REORDER_NONCE_TTL_MS;
  const key = `tg:reorder:nonce:${shopId}:${orderId}:${surface}`;
  const value = JSON.stringify({ nonce, orderId, surface, createdAt: timestamp });
  try {
    const redis = await getRedisClient();
    const ttlSeconds = Math.ceil(ttlMs / 1000);
    await redis.set(key, value, { EX: ttlSeconds });
    logger.debug(`Reorder nonce created for shop ${shopId}, order ${orderId.slice(0, 20)}...`);
    return { success: true, nonce };
  } catch {
    try {
      await prisma.eventNonce.create({
        data: {
          id: generateSimpleId("reorder-nonce"),
          shopId,
          nonce,
          eventType: `reorder:${surface}`,
          expiresAt: new Date(Date.now() + ttlMs),
        },
      });
      logger.debug(`Reorder nonce created (DB fallback) for shop ${shopId}, order ${orderId.slice(0, 20)}...`);
      return { success: true, nonce };
    } catch (error) {
      logger.error(`Failed to create reorder nonce for shop ${shopId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, error: "Failed to create nonce" };
    }
  }
}

export async function validateReorderNonce(
  shopId: string,
  orderId: string,
  nonce: string,
  surface: string
): Promise<{ valid: boolean; error?: string }> {
  if (!nonce || !orderId) {
    return { valid: false, error: "Missing nonce or orderId" };
  }
  const key = `tg:reorder:nonce:${shopId}:${orderId}:${surface}`;
  try {
    const redis = await getRedisClient();
    const stored = await redis.get(key);
    if (!stored) {
      return { valid: false, error: "Nonce not found or expired" };
    }
    const data = JSON.parse(stored) as { nonce: string; orderId: string; surface: string; createdAt: number };
    if (data.nonce !== nonce || data.orderId !== orderId || data.surface !== surface) {
      return { valid: false, error: "Nonce mismatch" };
    }
    await redis.del(key);
    logger.debug(`Reorder nonce validated and consumed for shop ${shopId}, order ${orderId.slice(0, 20)}...`);
    return { valid: true };
  } catch {
    try {
      const eventType = `reorder:${surface}`;
      const existing = await prisma.eventNonce.findFirst({
        where: {
          shopId,
          nonce,
          eventType,
          expiresAt: { gt: new Date() },
        },
      });
      if (!existing) {
        return { valid: false, error: "Nonce not found or expired" };
      }
      await prisma.eventNonce.delete({
        where: { id: existing.id },
      });
      logger.debug(`Reorder nonce validated and consumed (DB fallback) for shop ${shopId}, order ${orderId.slice(0, 20)}...`);
      return { valid: true };
    } catch (error) {
      logger.error(`Failed to validate reorder nonce for shop ${shopId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return { valid: false, error: "Failed to validate nonce" };
    }
  }
}

export async function createSurveyNonce(
  shopId: string,
  orderKey: string,
  surface: string
): Promise<{ success: boolean; nonce?: string; error?: string }> {
  const timestamp = Date.now();
  const randomHex = randomBytes(12).toString("hex");
  const nonce = `${timestamp}-${randomHex}`;
  const ttlMs = SURVEY_NONCE_TTL_MS;
  const key = `tg:survey:nonce:${shopId}:${orderKey}:${surface}`;
  const value = JSON.stringify({ nonce, orderKey, surface, createdAt: timestamp });
  try {
    const redis = await getRedisClient();
    const ttlSeconds = Math.ceil(ttlMs / 1000);
    await redis.set(key, value, { EX: ttlSeconds });
    logger.debug(`Survey nonce created for shop ${shopId}, order ${orderKey.slice(0, 20)}...`);
    return { success: true, nonce };
  } catch {
    try {
      const eventType = `survey:${surface}:${orderKey}`;
      await prisma.eventNonce.create({
        data: {
          id: generateSimpleId("survey-nonce"),
          shopId,
          nonce,
          eventType,
          expiresAt: new Date(Date.now() + ttlMs),
        },
      });
      logger.debug(`Survey nonce created (DB fallback) for shop ${shopId}, order ${orderKey.slice(0, 20)}...`);
      return { success: true, nonce };
    } catch (error) {
      logger.error(`Failed to create survey nonce for shop ${shopId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, error: "Failed to create nonce" };
    }
  }
}

export async function validateSurveyNonce(
  shopId: string,
  orderKey: string,
  nonce: string,
  surface: string
): Promise<{ valid: boolean; error?: string }> {
  if (!nonce || !orderKey) {
    return { valid: false, error: "Missing nonce or orderKey" };
  }
  const key = `tg:survey:nonce:${shopId}:${orderKey}:${surface}`;
  try {
    const redis = await getRedisClient();
    const stored = await redis.get(key);
    if (!stored) {
      return { valid: false, error: "Nonce not found or expired" };
    }
    const data = JSON.parse(stored) as { nonce: string; orderKey: string; surface: string; createdAt: number };
    if (data.nonce !== nonce || data.orderKey !== orderKey || data.surface !== surface) {
      return { valid: false, error: "Nonce mismatch" };
    }
    await redis.del(key);
    logger.debug(`Survey nonce validated and consumed for shop ${shopId}, order ${orderKey.slice(0, 20)}...`);
    return { valid: true };
  } catch {
    try {
      const eventType = `survey:${surface}:${orderKey}`;
      const existing = await prisma.eventNonce.findFirst({
        where: {
          shopId,
          nonce,
          eventType,
          expiresAt: { gt: new Date() },
        },
      });
      if (!existing) {
        return { valid: false, error: "Nonce not found or expired" };
      }
      await prisma.eventNonce.delete({
        where: { id: existing.id },
      });
      logger.debug(`Survey nonce validated and consumed (DB fallback) for shop ${shopId}, order ${orderKey.slice(0, 20)}...`);
      return { valid: true };
    } catch (error) {
      logger.error(`Failed to validate survey nonce for shop ${shopId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return { valid: false, error: "Failed to validate nonce" };
    }
  }
}
