

import prisma from "../../db.server";
import { generateEventId, generateMatchKey } from "../../utils/crypto.server";
import { extractOriginHost } from "../../utils/origin-validation";
import { logger } from "../../utils/logger.server";
import { RETENTION_CONFIG } from "../../utils/config";
import type { TrustLevel } from "../../utils/receipt-trust";
import type { PixelEventPayload, KeyValidationResult } from "./types";

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
  orderId: string,
  eventType: string
): Promise<boolean> {
  const existing = await prisma.pixelEventReceipt.findUnique({
    where: {
      shopId_orderId_eventType: {
        shopId,
        orderId,
        eventType,
      },
    },
    select: { id: true },
  });
  return !!existing;
}

export function generateOrderMatchKey(
  rawOrderId: string | null | undefined,
  checkoutToken: string | null | undefined,
  shopDomain: string
): MatchKeyResult {
  const matchKeyResult = generateMatchKey({
    orderId: rawOrderId,
    checkoutToken: checkoutToken,
  });

  const orderId = matchKeyResult.matchKey;
  const usedCheckoutTokenAsFallback = !matchKeyResult.isOrderId;

  if (usedCheckoutTokenAsFallback) {
    logger.info(
      `Using checkoutToken as fallback for shop ${shopDomain}. ` +
        `Webhook matching will use checkoutToken index.`
    );
  }

  return { orderId, usedCheckoutTokenAsFallback };
}

export function evaluateTrustLevel(
  keyValidation: KeyValidationResult,
  hasCheckoutToken: boolean
): TrustEvaluationResult {
  const isTrusted = keyValidation.matched;
  let trustLevel: TrustLevel = keyValidation.matched ? "partial" : "untrusted";
  let untrustedReason: string | undefined;

  if (keyValidation.matched && hasCheckoutToken) {
    trustLevel = "partial";
  } else if (!keyValidation.matched) {
    trustLevel = "untrusted";
    untrustedReason = keyValidation.reason || "ingestion_key_invalid";
  } else if (!hasCheckoutToken) {
    trustLevel = "partial";
    untrustedReason = "missing_checkout_token";
  }

  return { isTrusted, trustLevel, untrustedReason };
}

export async function createEventNonce(
  shopId: string,
  orderId: string,
  timestamp: number,
  clientNonce?: string,
  eventType: string = "purchase"
): Promise<{ success: boolean; isReplay: boolean }> {

  const nonceValue = clientNonce || `${orderId}:${eventType}:${timestamp}`;
  const nonceExpiresAt = new Date(Date.now() + RETENTION_CONFIG.NONCE_EXPIRY_MS);

  try {
    await prisma.eventNonce.create({
      data: {
        shopId,
        nonce: nonceValue,
        eventType,
        expiresAt: nonceExpiresAt,
      },
    });
    return { success: true, isReplay: false };
  } catch (nonceError) {
    if ((nonceError as { code?: string })?.code === "P2002") {
      logger.debug(`Replay detected for order ${orderId}, event ${eventType}, dropping duplicate`);
      return { success: false, isReplay: true };
    }
    logger.warn(`Nonce check failed: ${String(nonceError)}`);
    return { success: true, isReplay: false };
  }
}

export async function upsertPixelEventReceipt(
  shopId: string,
  orderId: string,
  eventId: string,
  payload: PixelEventPayload,
  keyValidation: KeyValidationResult,
  trustResult: TrustEvaluationResult,
  usedCheckoutTokenAsFallback: boolean,
  origin: string | null,
  eventType: string = "purchase"
): Promise<ReceiptCreateResult> {
  const originHost = extractOriginHost(origin);
  const checkoutToken = payload.data.checkoutToken;

  try {
    await prisma.pixelEventReceipt.upsert({
      where: {
        shopId_orderId_eventType: {
          shopId,
          orderId,
          eventType,
        },
      },
      create: {
        shopId,
        orderId,
        eventType,
        eventId,
        checkoutToken: checkoutToken || null,
        pixelTimestamp: new Date(payload.timestamp),
        consentState: payload.consent ? JSON.parse(JSON.stringify(payload.consent)) : undefined,
        isTrusted: trustResult.isTrusted,
        signatureStatus: keyValidation.matched ? "key_matched" : keyValidation.reason,
        usedCheckoutTokenFallback: usedCheckoutTokenAsFallback,
        trustLevel: trustResult.trustLevel,
        untrustedReason: trustResult.untrustedReason,
        originHost,
      },
      update: {
        eventId,
        checkoutToken: checkoutToken || undefined,
        pixelTimestamp: new Date(payload.timestamp),
        consentState: payload.consent ? JSON.parse(JSON.stringify(payload.consent)) : undefined,
        isTrusted: trustResult.isTrusted,
        signatureStatus: keyValidation.matched ? "key_matched" : keyValidation.reason,
        usedCheckoutTokenFallback: usedCheckoutTokenAsFallback,
        trustLevel: trustResult.trustLevel,
        untrustedReason: trustResult.untrustedReason,
        originHost,
      },
    });
    return { success: true, eventId };
  } catch (error) {
    logger.warn(`Failed to write PixelEventReceipt for order ${orderId}, event ${eventType}`, {
      error: String(error),
    });
    return { success: false, eventId };
  }
}

export async function recordConversionLogs(
  shopId: string,
  orderId: string,
  eventId: string,
  payload: PixelEventPayload,
  platformsToRecord: string[]
): Promise<ConversionLogResult> {
  const recordedPlatforms: string[] = [];
  const failedPlatforms: string[] = [];

  if (platformsToRecord.length === 0) {
    return { recordedPlatforms, failedPlatforms };
  }

  try {

    await prisma.$transaction(
      platformsToRecord.map((platform) =>
        prisma.conversionLog.upsert({
          where: {
            shopId_orderId_platform_eventType: {
              shopId,
              orderId,
              platform,
              eventType: "purchase",
            },
          },
          update: {
            clientSideSent: true,
            eventId,
          },
          create: {
            shopId,
            orderId,
            orderNumber: payload.data.orderNumber || null,
            orderValue: payload.data.value || 0,
            currency: payload.data.currency || "USD",
            platform,
            eventType: "purchase",
            eventId,
            status: "pending",
            attempts: 0,
            clientSideSent: true,
            serverSideSent: false,
          },
        })
      )
    );
    recordedPlatforms.push(...platformsToRecord);
  } catch (error) {
    logger.warn(`Failed to record client events in transaction`, { error: String(error) });

    for (const platform of platformsToRecord) {
      try {
        await prisma.conversionLog.upsert({
          where: {
            shopId_orderId_platform_eventType: {
              shopId,
              orderId,
              platform,
              eventType: "purchase",
            },
          },
          update: {
            clientSideSent: true,
            eventId,
          },
          create: {
            shopId,
            orderId,
            orderNumber: payload.data.orderNumber || null,
            orderValue: payload.data.value || 0,
            currency: payload.data.currency || "USD",
            platform,
            eventType: "purchase",
            eventId,
            status: "pending",
            attempts: 0,
            clientSideSent: true,
            serverSideSent: false,
          },
        });
        recordedPlatforms.push(platform);
      } catch (individualError) {
        logger.warn(`Failed to record client event for ${platform}`, {
          error: String(individualError),
        });
        failedPlatforms.push(platform);
      }
    }
  }

  return { recordedPlatforms, failedPlatforms };
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
  identifier: string,
  eventType: string,
  shopDomain: string,
  checkoutToken?: string | null,
  items?: Array<{ id: string; quantity: number }>
): string {

  const { generateCanonicalEventId } = require("../../services/event-normalizer.server");
  return generateCanonicalEventId(
    identifier,
    checkoutToken,
    eventType,
    shopDomain,
    items
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

