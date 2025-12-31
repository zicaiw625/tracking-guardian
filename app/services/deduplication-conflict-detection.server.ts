

import prisma from "../db.server";
import { logger } from "../utils/logger.server";

export interface DeduplicationConflict {
  eventId: string;
  orderId: string;
  platform: string;
  eventType: string;
  count: number;
  occurrences: Array<{
    timestamp: Date;
    source: "client" | "server";
    status: string;
  }>;
  severity: "high" | "medium" | "low";
  recommendation: string;
}

export interface DeduplicationConflictStats {
  totalConflicts: number;
  byPlatform: Record<string, number>;
  byEventType: Record<string, number>;
  bySeverity: {
    high: number;
    medium: number;
    low: number;
  };
  recentConflicts: DeduplicationConflict[];
}

export async function detectDeduplicationConflicts(
  shopId: string,
  hours: number = 24
): Promise<DeduplicationConflict[]> {
  const since = new Date();
  since.setHours(since.getHours() - hours);

  const logs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: { gte: since },
      eventId: { not: null },
    },
    select: {
      orderId: true,
      platform: true,
      eventType: true,
      eventId: true,
      status: true,
      createdAt: true,
      clientSideSent: true,
      serverSideSent: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const conflictMap = new Map<string, DeduplicationConflict>();

  for (const log of logs) {
    if (!log.eventId) continue;

    const key = `${log.eventId}:${log.platform}`;
    const existing = conflictMap.get(key);

    if (existing) {
      existing.count++;
      existing.occurrences.push({
        timestamp: log.createdAt,
        source: log.serverSideSent ? "server" : "client",
        status: log.status,
      });
    } else {
      conflictMap.set(key, {
        eventId: log.eventId,
        orderId: log.orderId,
        platform: log.platform,
        eventType: log.eventType,
        count: 1,
        occurrences: [
          {
            timestamp: log.createdAt,
            source: log.serverSideSent ? "server" : "client",
            status: log.status,
          },
        ],
        severity: "low",
        recommendation: "",
      });
    }
  }

  const conflicts: DeduplicationConflict[] = [];

  for (const conflict of conflictMap.values()) {
    if (conflict.count > 1) {

      conflict.severity = calculateSeverity(conflict);
      conflict.recommendation = generateRecommendation(conflict);
      conflicts.push(conflict);

      conflict.occurrences.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    }
  }

  return conflicts.sort((a, b) => {

    const severityOrder = { high: 3, medium: 2, low: 1 };
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[b.severity] - severityOrder[a.severity];
    }
    return b.count - a.count;
  });
}

function calculateSeverity(conflict: DeduplicationConflict): "high" | "medium" | "low" {

  if (conflict.eventType === "purchase" || conflict.eventType === "checkout_completed") {
    if (conflict.count >= 3) {
      return "high";
    }
    if (conflict.count === 2) {

      const timeDiff = Math.abs(
        conflict.occurrences[0].timestamp.getTime() -
        conflict.occurrences[1].timestamp.getTime()
      );
      if (timeDiff < 60000) {
        return "high";
      }
      return "medium";
    }
  }

  if (conflict.count >= 3) {
    return "medium";
  }

  return "low";
}

function generateRecommendation(conflict: DeduplicationConflict): string {
  const sources = conflict.occurrences.map((o) => o.source);
  const hasBothSources = sources.includes("client") && sources.includes("server");

  if (hasBothSources) {
    return "客户端和服务端同时发送了相同事件。建议：1) 检查去重策略配置 2) 确保 event_id 生成一致 3) 考虑使用服务端优先策略";
  }

  if (sources.every((s) => s === "client")) {
    return "客户端多次发送相同事件。可能原因：页面重复加载、事件监听器重复绑定。建议：检查 Web Pixel 实现，确保事件只发送一次";
  }

  if (sources.every((s) => s === "server")) {
    return "服务端多次发送相同事件。可能原因：Webhook 重复处理、重试机制问题。建议：检查 webhook 去重逻辑和重试策略";
  }

  return "检测到事件重复发送。建议：检查事件发送逻辑和去重机制";
}

export async function getDeduplicationConflictStats(
  shopId: string,
  hours: number = 24
): Promise<DeduplicationConflictStats> {
  const conflicts = await detectDeduplicationConflicts(shopId, hours);

  const byPlatform: Record<string, number> = {};
  const byEventType: Record<string, number> = {};
  const bySeverity = {
    high: 0,
    medium: 0,
    low: 0,
  };

  for (const conflict of conflicts) {
    byPlatform[conflict.platform] = (byPlatform[conflict.platform] || 0) + 1;
    byEventType[conflict.eventType] = (byEventType[conflict.eventType] || 0) + 1;
    bySeverity[conflict.severity]++;
  }

  return {
    totalConflicts: conflicts.length,
    byPlatform,
    byEventType,
    bySeverity,
    recentConflicts: conflicts.slice(0, 20),
  };
}

export interface DeduplicationAlertResult {
  shouldAlert: boolean;
  reason: string;
  severity: "critical" | "warning" | "info";
  stats: {
    totalConflicts: number;
    highSeverityConflicts: number;
    purchaseConflicts: number;
  };
}

export async function checkDeduplicationAlerts(
  shopId: string,
  threshold: number = 5
): Promise<DeduplicationAlertResult> {
  const stats = await getDeduplicationConflictStats(shopId, 24);

  const highSeverityConflicts = stats.recentConflicts.filter(
    (c) => c.severity === "high"
  ).length;

  const purchaseConflicts = stats.recentConflicts.filter(
    (c) => c.eventType === "purchase" || c.eventType === "checkout_completed"
  ).length;

  if (highSeverityConflicts >= 3) {
    return {
      shouldAlert: true,
      reason: `检测到 ${highSeverityConflicts} 个高严重程度去重冲突，可能影响转化追踪准确性`,
      severity: "critical",
      stats: {
        totalConflicts: stats.totalConflicts,
        highSeverityConflicts,
        purchaseConflicts,
      },
    };
  }

  if (purchaseConflicts >= threshold) {
    return {
      shouldAlert: true,
      reason: `检测到 ${purchaseConflicts} 个 Purchase 事件去重冲突，建议立即检查`,
      severity: purchaseConflicts >= 10 ? "critical" : "warning",
      stats: {
        totalConflicts: stats.totalConflicts,
        highSeverityConflicts,
        purchaseConflicts,
      },
    };
  }

  if (stats.totalConflicts >= threshold * 2) {
    return {
      shouldAlert: true,
      reason: `检测到 ${stats.totalConflicts} 个去重冲突，建议检查事件发送逻辑`,
      severity: "warning",
      stats: {
        totalConflicts: stats.totalConflicts,
        highSeverityConflicts,
        purchaseConflicts,
      },
    };
  }

  return {
    shouldAlert: false,
    reason: "去重冲突检测正常",
    severity: "info",
    stats: {
      totalConflicts: stats.totalConflicts,
      highSeverityConflicts,
      purchaseConflicts,
    },
  };
}

