/**
 * CAPI 强去重服务
 * 对应设计方案 4.3 Pixels - 去重与一致性
 * 
 * 功能:
 * - 生成确定性 event_id
 * - 防止重复发送
 * - 客户端 + 服务端混合去重
 * - 去重冲突检测和报告
 */

import prisma from "../db.server";
import { createHash } from "crypto";
import { logger } from "../utils/logger.server";

// ============================================================
// 类型定义
// ============================================================

export interface DedupResult {
  shouldSend: boolean;
  eventId: string;
  reason?: "duplicate" | "already_sent" | "consent_blocked" | "rate_limited";
  existingLogId?: string;
}

export interface DedupConfig {
  windowHours: number;           // 去重窗口（小时）
  maxAttempts: number;           // 最大重试次数
  checkPixelReceipt: boolean;    // 是否检查 Pixel 收据
  strictMode: boolean;           // 严格模式（阻止所有疑似重复）
}

const DEFAULT_CONFIG: DedupConfig = {
  windowHours: 24,
  maxAttempts: 3,
  checkPixelReceipt: true,
  strictMode: false,
};

// ============================================================
// Event ID 生成
// ============================================================

/**
 * 生成确定性 Event ID
 * 使用 orderId + eventType + shopDomain 组合确保唯一性
 */
export function generateEventId(
  orderId: string,
  eventType: string,
  shopDomain: string,
  platform?: string
): string {
  const input = `${shopDomain}:${orderId}:${eventType}${platform ? `:${platform}` : ""}`;
  return createHash("sha256").update(input).digest("hex").substring(0, 32);
}

/**
 * 生成带时间戳的 Event ID（用于非订单事件）
 */
export function generateTimestampedEventId(
  identifier: string,
  eventType: string,
  shopDomain: string,
  timestamp?: Date
): string {
  const ts = timestamp || new Date();
  const timeWindow = Math.floor(ts.getTime() / (5 * 60 * 1000)); // 5分钟窗口
  const input = `${shopDomain}:${identifier}:${eventType}:${timeWindow}`;
  return createHash("sha256").update(input).digest("hex").substring(0, 32);
}

// ============================================================
// 去重检查
// ============================================================

/**
 * 检查是否应该发送事件（核心去重逻辑）
 */
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

  // 1. 检查 ConversionLog 中是否已存在成功发送的记录
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
    // 已成功发送，不再发送
    if (existingLog.status === "sent") {
      logger.debug("Dedup: Already sent", { orderId, platform, eventId });
      return {
        shouldSend: false,
        eventId,
        reason: "already_sent",
        existingLogId: existingLog.id,
      };
    }

    // 检查重试次数
    if (existingLog.attempts >= maxAttempts) {
      logger.debug("Dedup: Max attempts reached", { orderId, platform, attempts: existingLog.attempts });
      return {
        shouldSend: false,
        eventId,
        reason: "rate_limited",
        existingLogId: existingLog.id,
      };
    }

    // 严格模式下，任何已存在的记录都不重发
    if (strictMode && existingLog.status !== "failed") {
      return {
        shouldSend: false,
        eventId,
        reason: "duplicate",
        existingLogId: existingLog.id,
      };
    }
  }

  // 2. 检查 Pixel 收据中的 consent 状态
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
      // 如果明确拒绝 marketing，不发送到广告平台
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

  // 3. 检查 EventNonce 表防止快速重复请求
  try {
    await prisma.eventNonce.create({
      data: {
        shopId,
        nonce: eventId,
        eventType,
        expiresAt: new Date(Date.now() + windowHours * 60 * 60 * 1000),
      },
    });
  } catch (error) {
    // 如果插入失败（唯一约束），说明已存在
    if ((error as { code?: string }).code === "P2002") {
      logger.debug("Dedup: Nonce exists", { orderId, platform, eventId });
      return {
        shouldSend: false,
        eventId,
        reason: "duplicate",
      };
    }
    // 其他错误继续处理
  }

  logger.debug("Dedup: Should send", { orderId, platform, eventId });
  return {
    shouldSend: true,
    eventId,
  };
}

/**
 * 标记事件已发送
 */
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

/**
 * 标记事件发送失败
 */
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

// ============================================================
// 去重分析
// ============================================================

/**
 * 分析去重冲突
 */
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
  // 获取时间范围内的所有事件
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

  // 按 orderId + platform + eventType 分组
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

  // 排序获取 top duplicates
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

// ============================================================
// 清理过期 Nonces
// ============================================================

/**
 * 清理过期的 EventNonce 记录
 */
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

// ============================================================
// 平台特定的 Event ID 格式
// ============================================================

/**
 * 为 Meta CAPI 格式化 event_id
 */
export function formatMetaEventId(eventId: string): string {
  // Meta 接受任意字符串，最长 1000 字符
  return eventId;
}

/**
 * 为 GA4 格式化 transaction_id
 */
export function formatGA4TransactionId(orderId: string): string {
  // GA4 使用 transaction_id 作为去重标识
  return orderId.replace(/[^a-zA-Z0-9]/g, "");
}

/**
 * 为 TikTok 格式化 event_id
 */
export function formatTikTokEventId(eventId: string): string {
  // TikTok 接受字符串
  return eventId;
}

/**
 * 为 Pinterest 格式化 event_id
 */
export function formatPinterestEventId(eventId: string): string {
  // Pinterest 使用 event_id
  return eventId;
}

/**
 * 为 Snapchat 格式化 client_dedup_id
 */
export function formatSnapchatDedupId(eventId: string): string {
  // Snapchat 使用 client_dedup_id
  return eventId;
}

