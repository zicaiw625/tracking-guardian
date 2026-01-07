

import { randomUUID, createHash } from "crypto";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { generateEventId as generateEventIdUnified } from "../utils/crypto.server";

export interface DedupResult {
  shouldSend: boolean;
  eventId: string;
  reason?: "duplicate" | "already_sent" | "consent_blocked" | "rate_limited";
  existingLogId?: string;
}

export interface DedupConfig {
  windowHours: number;
  maxAttempts: number;
  checkPixelReceipt: boolean;
  strictMode: boolean;
}

const DEFAULT_CONFIG: DedupConfig = {
  windowHours: 24,
  maxAttempts: 3,
  checkPixelReceipt: true,
  strictMode: false,
};

export function generateEventId(
  orderId: string,
  eventType: string,
  shopDomain: string,
  platform?: string
): string {

  if (platform) {
    const input = `${shopDomain}:${orderId}:${eventType}:${platform}`;
    return createHash("sha256").update(input).digest("hex").substring(0, 32);
  }

  return generateEventIdUnified(orderId, eventType, shopDomain);
}

export function generateTimestampedEventId(
  identifier: string,
  eventType: string,
  shopDomain: string,
  timestamp?: Date
): string {
  const ts = timestamp || new Date();
  const timeWindow = Math.floor(ts.getTime() / (5 * 60 * 1000));
  const input = `${shopDomain}:${identifier}:${eventType}:${timeWindow}`;
  return createHash("sha256").update(input).digest("hex").substring(0, 32);
}

export async function checkShouldSend(
  shopId: string,
  orderId: string,
  eventType: string,
  platform: string,
  config: Partial<DedupConfig> = {}
): Promise<DedupResult> {
  const { windowHours, maxAttempts, checkPixelReceipt, strictMode } = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { shopDomain: true },
  });

  if (!shop) {
    return { shouldSend: false, eventId: "", reason: "rate_limited" };
  }

  const eventId = generateEventId(orderId, eventType, shop.shopDomain, platform);
  const windowStart = new Date();
  windowStart.setHours(windowStart.getHours() - windowHours);

  const existingLog = await prisma.conversionLog.findFirst({
    where: {
      shopId,
      orderId,
      platform,
      eventType,
      createdAt: { gte: windowStart },
    },
    orderBy: { createdAt: "desc" },
  });

  if (existingLog) {

    if (existingLog.status === "sent") {
      logger.debug("Dedup: Already sent", { orderId, platform, eventId });
      return {
        shouldSend: false,
        eventId,
        reason: "already_sent",
        existingLogId: existingLog.id,
      };
    }

    if (existingLog.attempts >= maxAttempts) {
      logger.debug("Dedup: Max attempts reached", { orderId, platform, attempts: existingLog.attempts });
      return {
        shouldSend: false,
        eventId,
        reason: "rate_limited",
        existingLogId: existingLog.id,
      };
    }

    if (strictMode && existingLog.status !== "failed") {
      return {
        shouldSend: false,
        eventId,
        reason: "duplicate",
        existingLogId: existingLog.id,
      };
    }
  }

  if (checkPixelReceipt) {
    const receipt = await prisma.pixelEventReceipt.findFirst({
      where: {
        shopId,
        orderId,
        eventType: "checkout_completed",
      },
      select: { consentState: true },
    });

    if (receipt?.consentState) {
      const consent = receipt.consentState as { marketing?: boolean; analytics?: boolean };

      if (consent.marketing === false && ["meta", "tiktok", "pinterest", "snapchat", "twitter"].includes(platform)) {
        logger.debug("Dedup: Consent blocked", { orderId, platform });
        return {
          shouldSend: false,
          eventId,
          reason: "consent_blocked",
        };
      }
    }
  }

  try {
    await prisma.eventNonce.create({
      data: {
        id: randomUUID(),
        shopId,
        nonce: eventId,
        eventType,
        expiresAt: new Date(Date.now() + windowHours * 60 * 60 * 1000),
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      logger.debug("Dedup: Nonce exists", { orderId, platform, eventId });
      return {
        shouldSend: false,
        eventId,
        reason: "duplicate",
      };
    }

    logger.warn("Failed to create event nonce", {
      orderId,
      platform,
      eventId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.debug("Dedup: Should send", { orderId, platform, eventId });
  return {
    shouldSend: true,
    eventId,
  };
}

export async function markEventSent(
  shopId: string,
  orderId: string,
  eventType: string,
  platform: string,
  eventId: string
): Promise<void> {
  try {
    await prisma.conversionLog.updateMany({
      where: {
        shopId,
        orderId,
        platform,
        eventType,
        eventId,
      },
      data: {
        status: "sent",
        sentAt: new Date(),
      },
    });
  } catch (error) {
    logger.error("Failed to mark event as sent", { orderId, platform, eventId, error });
  }
}

export async function markEventFailed(
  shopId: string,
  orderId: string,
  eventType: string,
  platform: string,
  eventId: string,
  errorMessage: string
): Promise<void> {
  try {
    await prisma.conversionLog.updateMany({
      where: {
        shopId,
        orderId,
        platform,
        eventType,
        eventId,
      },
      data: {
        status: "failed",
        errorMessage,
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });
  } catch (error) {
    logger.error("Failed to mark event as failed", { orderId, platform, eventId, error });
  }
}

export async function analyzeDedupConflicts(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<{
  totalEvents: number;
  uniqueEvents: number;
  duplicateEvents: number;
  duplicateRate: number;
  byPlatform: Record<string, {
    total: number;
    duplicates: number;
    duplicateRate: number;
  }>;
  topDuplicates: Array<{
    eventId: string;
    orderId: string;
    platform: string;
    count: number;
  }>;
}> {

  const logs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: { gte: startDate, lte: endDate },
    },
    select: {
      id: true,
      orderId: true,
      platform: true,
      eventType: true,
      eventId: true,
    },
  });

  const groupedEvents = new Map<string, typeof logs>();
  logs.forEach(log => {
    const key = `${log.orderId}:${log.platform}:${log.eventType}`;
    const existing = groupedEvents.get(key) || [];
    existing.push(log);
    groupedEvents.set(key, existing);
  });

  let duplicateEvents = 0;
  const duplicatesByPlatform: Record<string, { total: number; duplicates: number }> = {};
  const topDuplicates: Array<{
    eventId: string;
    orderId: string;
    platform: string;
    count: number;
  }> = [];

  for (const [_key, events] of groupedEvents) {
    const platform = events[0].platform;

    if (!duplicatesByPlatform[platform]) {
      duplicatesByPlatform[platform] = { total: 0, duplicates: 0 };
    }
    duplicatesByPlatform[platform].total += events.length;

    if (events.length > 1) {
      duplicateEvents += events.length - 1;
      duplicatesByPlatform[platform].duplicates += events.length - 1;

      topDuplicates.push({
        eventId: events[0].eventId || "",
        orderId: events[0].orderId,
        platform,
        count: events.length,
      });
    }
  }

  topDuplicates.sort((a, b) => b.count - a.count);

  const byPlatform: Record<string, { total: number; duplicates: number; duplicateRate: number }> = {};
  for (const [platform, stats] of Object.entries(duplicatesByPlatform)) {
    byPlatform[platform] = {
      ...stats,
      duplicateRate: stats.total > 0 ? stats.duplicates / stats.total : 0,
    };
  }

  return {
    totalEvents: logs.length,
    uniqueEvents: groupedEvents.size,
    duplicateEvents,
    duplicateRate: logs.length > 0 ? duplicateEvents / logs.length : 0,
    byPlatform,
    topDuplicates: topDuplicates.slice(0, 20),
  };
}

export async function cleanupExpiredNonces(): Promise<number> {
  const result = await prisma.eventNonce.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });

  if (result.count > 0) {
    logger.info("Cleaned up expired nonces", { count: result.count });
  }

  return result.count;
}

export function formatMetaEventId(eventId: string): string {

  return eventId;
}

export function formatGA4TransactionId(orderId: string): string {

  return orderId.replace(/[^a-zA-Z0-9]/g, "");
}

export function formatTikTokEventId(eventId: string): string {

  return eventId;
}

export function formatPinterestEventId(eventId: string): string {

  return eventId;
}

export function formatSnapchatDedupId(eventId: string): string {

  return eventId;
}

