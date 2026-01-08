import prisma from "../../db.server";
import { generateEventId, generateMatchKey } from "../../utils/crypto.server";
import { extractOriginHost } from "../../utils/origin-validation";
import { logger } from "../../utils/logger.server";
import { RETENTION_CONFIG } from "../../utils/config";
import { generateSimpleId } from "../../utils/helpers";
import type { TrustLevel } from "../../utils/receipt-trust";
import type { PixelEventPayload, KeyValidationResult } from "./types";
import { generateCanonicalEventId } from "../../services/event-normalizer.server";

export interface MatchKeyResult {
  orderId: string;
  usedCheckoutTokenAsFallback: boolean;
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
  eventType: string,
  verificationRunId?: string | null
): Promise<boolean> {
  const where: any = {
    shopId,
    eventType,
  };
  if (verificationRunId) {
    where.verificationRunId = verificationRunId;
  }
  
  const existing = await prisma.pixelEventReceipt.findFirst({
    where,
    select: { id: true },
    orderBy: { pixelTimestamp: "desc" },
  });
  return !!existing;
}

// 轻量版：不再需要复杂的 orderId 匹配和 nonce 检查
// 简化逻辑，只记录事件用于验收

export async function upsertPixelEventReceipt(
  shopId: string,
  eventId: string,
  payload: PixelEventPayload,
  origin: string | null,
  eventType: string = "purchase",
  verificationRunId?: string | null
): Promise<ReceiptCreateResult> {
  const originHost = extractOriginHost(origin);

  try {
    await prisma.pixelEventReceipt.create({
      data: {
        id: generateSimpleId("receipt"),
        shopId,
        eventType,
        pixelTimestamp: new Date(payload.timestamp),
        originHost: originHost || null,
        verificationRunId: verificationRunId || null,
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

// 轻量版：不再需要 ConversionLog，只记录 PixelEventReceipt 用于验收

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
  const { createHash } = require("crypto");

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
