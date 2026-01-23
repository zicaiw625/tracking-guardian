import { createHash } from "crypto";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { generateEventId as generateEventIdUnified } from "../utils/crypto.server";
import { extractPlatformFromPayload } from "../utils/common";

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
  const { windowHours, checkPixelReceipt } = {
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
  if (checkPixelReceipt) {
    const receipts = await prisma.pixelEventReceipt.findMany({
      where: {
        shopId,
        orderKey: orderId,
        eventType: { in: ["checkout_completed", "purchase"] },
        createdAt: { gte: windowStart },
      },
      select: {
        payloadJson: true,
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    for (const receipt of receipts) {
      const payload = receipt.payloadJson as Record<string, unknown> | null;
      const receiptPlatform = extractPlatformFromPayload(payload);
      if (receiptPlatform !== platform) continue;
      const consent = payload?.consent as { marketing?: boolean; analytics?: boolean } | null;
      if (consent?.marketing === false && ["meta", "tiktok", "pinterest", "snapchat", "twitter"].includes(platform)) {
        logger.debug("Dedup: Consent blocked", { orderId, platform });
        return {
          shouldSend: false,
          eventId,
          reason: "consent_blocked",
        };
      }
      const data = payload?.data as Record<string, unknown> | undefined;
      const hasValue = data?.value !== undefined && data?.value !== null;
      const hasCurrency = !!data?.currency;
      if (hasValue && hasCurrency) {
        logger.debug("Dedup: Already sent", { orderId, platform, eventId });
        return {
          shouldSend: false,
          eventId,
          reason: "already_sent",
        };
      }
    }
  }
  logger.debug("Dedup: Should send", { orderId, platform, eventId });
  return {
    shouldSend: true,
    eventId,
  };
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
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      createdAt: { gte: startDate, lte: endDate },
    },
    select: {
      id: true,
      orderKey: true,
      eventType: true,
      payloadJson: true,
    },
  });
  type ReceiptWithPlatform = typeof receipts[0] & { platform: string };
  const groupedEvents = new Map<string, ReceiptWithPlatform[]>();
  receipts.forEach(receipt => {
    if (!receipt.orderKey) return;
    const payload = receipt.payloadJson as Record<string, unknown> | null;
    const platform = extractPlatformFromPayload(payload);
    if (!platform) return;
    const key = `${receipt.orderKey}:${platform}:${receipt.eventType}`;
    const existing = groupedEvents.get(key) || [];
    existing.push({ ...receipt, platform } as ReceiptWithPlatform);
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const [_key, events] of groupedEvents) {
    const payload = events[0].payloadJson as Record<string, unknown> | null;
    const platform = extractPlatformFromPayload(payload) || "unknown";
    if (!duplicatesByPlatform[platform]) {
      duplicatesByPlatform[platform] = { total: 0, duplicates: 0 };
    }
    duplicatesByPlatform[platform].total += events.length;
    if (events.length > 1) {
      duplicateEvents += events.length - 1;
      duplicatesByPlatform[platform].duplicates += events.length - 1;
      topDuplicates.push({
        eventId: events[0].id,
        orderId: events[0].orderKey || "",
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
    totalEvents: receipts.length,
    uniqueEvents: groupedEvents.size,
    duplicateEvents,
    duplicateRate: receipts.length > 0 ? duplicateEvents / receipts.length : 0,
    byPlatform,
    topDuplicates: topDuplicates.slice(0, 20),
  };
}

export async function cleanupExpiredNonces(): Promise<number> {
  try {
    const now = new Date();
    const result = await prisma.eventNonce.deleteMany({
      where: {
        expiresAt: {
          lt: now,
        },
      },
    });
    return result.count;
  } catch (error) {
    logger.error("Failed to cleanup expired nonces", {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
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
