/**
 * Pixel Events API - Receipt & Event Handling
 *
 * Handles pixel event receipt creation and conversion log recording.
 */

import prisma from "../../db.server";
import { generateEventId, generateMatchKey } from "../../utils/crypto.server";
import { extractOriginHost } from "../../utils/origin-validation";
import { logger } from "../../utils/logger.server";
import { RETENTION_CONFIG } from "../../utils/config";
import type { TrustLevel } from "../../utils/receipt-trust";
import type { PixelEventPayload, KeyValidationResult } from "./types";

// =============================================================================
// Types
// =============================================================================

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

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a client event has already been recorded.
 */
export async function isClientEventRecorded(
  shopId: string,
  orderId: string,
  eventType: string
): Promise<boolean> {
  const existing = await prisma.conversionLog.findFirst({
    where: {
      shopId,
      orderId,
      eventType,
      clientSideSent: true,
    },
    select: { id: true },
  });
  return !!existing;
}

/**
 * Generate order match key from orderId or checkoutToken.
 */
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

/**
 * Evaluate trust level based on key validation and checkout token presence.
 */
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

/**
 * Create nonce to prevent replay attacks.
 * Returns true if nonce was created successfully (not a replay).
 */
export async function createEventNonce(
  shopId: string,
  orderId: string,
  timestamp: number
): Promise<{ success: boolean; isReplay: boolean }> {
  const nonceValue = `${orderId}:${timestamp}`;
  const nonceExpiresAt = new Date(Date.now() + RETENTION_CONFIG.NONCE_EXPIRY_MS);

  try {
    await prisma.eventNonce.create({
      data: {
        shopId,
        nonce: nonceValue,
        eventType: "purchase",
        expiresAt: nonceExpiresAt,
      },
    });
    return { success: true, isReplay: false };
  } catch (nonceError) {
    if ((nonceError as { code?: string })?.code === "P2002") {
      logger.debug(`Replay detected for order ${orderId}, dropping duplicate`);
      return { success: false, isReplay: true };
    }
    logger.warn(`Nonce check failed: ${String(nonceError)}`);
    return { success: true, isReplay: false }; // Continue on other errors
  }
}

/**
 * Create or update pixel event receipt.
 */
export async function upsertPixelEventReceipt(
  shopId: string,
  orderId: string,
  eventId: string,
  payload: PixelEventPayload,
  keyValidation: KeyValidationResult,
  trustResult: TrustEvaluationResult,
  usedCheckoutTokenAsFallback: boolean,
  origin: string | null
): Promise<ReceiptCreateResult> {
  const originHost = extractOriginHost(origin);
  const checkoutToken = payload.data.checkoutToken;

  try {
    await prisma.pixelEventReceipt.upsert({
      where: {
        shopId_orderId_eventType: {
          shopId,
          orderId,
          eventType: "purchase",
        },
      },
      create: {
        shopId,
        orderId,
        eventType: "purchase",
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
    logger.warn(`Failed to write PixelEventReceipt for order ${orderId}`, {
      error: String(error),
    });
    return { success: false, eventId };
  }
}

/**
 * Record conversion logs for platforms.
 */
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
    // Try batch transaction first
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

    // Fallback to individual upserts
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

/**
 * Get active pixel configs for a shop.
 */
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

/**
 * Generate event ID for deduplication.
 */
export function generatePurchaseEventId(
  orderId: string,
  shopDomain: string
): string {
  return generateEventId(orderId, "purchase", shopDomain);
}

