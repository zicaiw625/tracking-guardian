/**
 * 告警调度服务
 * 对应设计方案 4.6 Monitoring - 告警功能
 * 
 * 功能:
 * - 事件失败率告警 (> 阈值)
 * - Purchase 缺参率告警
 * - 事件量骤降告警 (24h 量降 > 50%)
 * - 去重冲突告警
 */

import prisma from "../db.server";
import { sendAlert } from "./notification.server";
import { logger } from "../utils/logger.server";
import type { AlertData } from "../types";

// ============================================================
// 类型定义
// ============================================================

export interface AlertCheckResult {
  shopId: string;
  shopDomain: string;
  triggered: boolean;
  alertType: AlertType;
  severity: "critical" | "high" | "medium" | "low";
  message: string;
  data?: Record<string, unknown>;
}

export type AlertType = 
  | "failure_rate"        // 事件失败率
  | "missing_params"      // 参数缺失率
  | "volume_drop"         // 事件量骤降
  | "dedup_conflict"      // 去重冲突
  | "reconciliation"      // 对账差异
  | "pixel_heartbeat";    // 像素心跳丢失

interface AlertThresholds {
  failureRateThreshold: number;      // 失败率阈值 (0-1)
  missingParamsThreshold: number;    // 缺参率阈值 (0-1)
  volumeDropThreshold: number;       // 量降阈值 (0-1)
  dedupConflictThreshold: number;    // 去重冲突阈值 (次数)
  heartbeatStaleHours: number;       // 心跳过期时间 (小时)
}

const DEFAULT_THRESHOLDS: AlertThresholds = {
  failureRateThreshold: 0.02,        // 2% 失败率
  missingParamsThreshold: 0.1,       // 10% 缺参率
  volumeDropThreshold: 0.5,          // 50% 量降
  dedupConflictThreshold: 5,         // 5 次重复
  heartbeatStaleHours: 24,           // 24 小时
};

// ============================================================
// 告警检查函数
// ============================================================

/**
 * 检查事件失败率
 */
export async function checkFailureRate(
  shopId: string,
  shopDomain: string,
  thresholds: Partial<AlertThresholds> = {}
): Promise<AlertCheckResult> {
  const threshold = thresholds.failureRateThreshold ?? DEFAULT_THRESHOLDS.failureRateThreshold;
  
  const last24h = new Date();
  last24h.setHours(last24h.getHours() - 24);

  const stats = await prisma.conversionLog.groupBy({
    by: ["status"],
    where: {
      shopId,
      createdAt: { gte: last24h },
    },
    _count: true,
  });

  const total = stats.reduce((sum, s) => sum + s._count, 0);
  const failed = stats.find(s => s.status === "failed")?._count || 0;
  const failureRate = total > 0 ? failed / total : 0;

  const triggered = failureRate > threshold && total >= 10; // 至少 10 条才触发

  return {
    shopId,
    shopDomain,
    triggered,
    alertType: "failure_rate",
    severity: failureRate > 0.1 ? "critical" : failureRate > 0.05 ? "high" : "medium",
    message: `事件发送失败率 ${(failureRate * 100).toFixed(1)}% 超过阈值 ${(threshold * 100).toFixed(1)}%`,
    data: { total, failed, failureRate, threshold },
  };
}

/**
 * 检查参数缺失率
 */
export async function checkMissingParams(
  shopId: string,
  shopDomain: string,
  thresholds: Partial<AlertThresholds> = {}
): Promise<AlertCheckResult> {
  const threshold = thresholds.missingParamsThreshold ?? DEFAULT_THRESHOLDS.missingParamsThreshold;
  
  const last24h = new Date();
  last24h.setHours(last24h.getHours() - 24);

  // 检查 purchase 事件中缺少 value 或 currency 的比例
  const allPurchases = await prisma.conversionLog.count({
    where: {
      shopId,
      eventType: "purchase",
      createdAt: { gte: last24h },
    },
  });

  // 查找缺少关键参数的记录 (通过 platformResponse 或 errorMessage 判断)
  const purchasesWithIssues = await prisma.conversionLog.count({
    where: {
      shopId,
      eventType: "purchase",
      createdAt: { gte: last24h },
      OR: [
        { errorMessage: { contains: "missing" } },
        { errorMessage: { contains: "required" } },
        { orderValue: { equals: 0 } },
      ],
    },
  });

  const missingRate = allPurchases > 0 ? purchasesWithIssues / allPurchases : 0;
  const triggered = missingRate > threshold && allPurchases >= 5;

  return {
    shopId,
    shopDomain,
    triggered,
    alertType: "missing_params",
    severity: missingRate > 0.2 ? "high" : "medium",
    message: `Purchase 事件参数缺失率 ${(missingRate * 100).toFixed(1)}% 超过阈值`,
    data: { allPurchases, purchasesWithIssues, missingRate, threshold },
  };
}

/**
 * 检查事件量骤降
 */
export async function checkVolumeDrop(
  shopId: string,
  shopDomain: string,
  thresholds: Partial<AlertThresholds> = {}
): Promise<AlertCheckResult> {
  const threshold = thresholds.volumeDropThreshold ?? DEFAULT_THRESHOLDS.volumeDropThreshold;
  
  const now = new Date();
  const last24h = new Date(now);
  last24h.setHours(last24h.getHours() - 24);
  const prev24h = new Date(last24h);
  prev24h.setHours(prev24h.getHours() - 24);

  // 当前 24 小时事件量
  const currentVolume = await prisma.conversionLog.count({
    where: {
      shopId,
      createdAt: { gte: last24h },
    },
  });

  // 前一个 24 小时事件量
  const previousVolume = await prisma.conversionLog.count({
    where: {
      shopId,
      createdAt: { gte: prev24h, lt: last24h },
    },
  });

  // 计算降幅
  const dropRate = previousVolume > 0 ? (previousVolume - currentVolume) / previousVolume : 0;
  const triggered = dropRate > threshold && previousVolume >= 10;

  return {
    shopId,
    shopDomain,
    triggered,
    alertType: "volume_drop",
    severity: dropRate > 0.8 ? "critical" : dropRate > 0.6 ? "high" : "medium",
    message: `事件量骤降 ${(dropRate * 100).toFixed(1)}%（前24h: ${previousVolume}，当前24h: ${currentVolume}）`,
    data: { currentVolume, previousVolume, dropRate, threshold },
  };
}

/**
 * 检查去重冲突
 */
export async function checkDedupConflicts(
  shopId: string,
  shopDomain: string,
  thresholds: Partial<AlertThresholds> = {}
): Promise<AlertCheckResult> {
  const threshold = thresholds.dedupConflictThreshold ?? DEFAULT_THRESHOLDS.dedupConflictThreshold;
  
  const last24h = new Date();
  last24h.setHours(last24h.getHours() - 24);

  // 查找同一 eventId 出现多次的情况
  const duplicates = await prisma.$queryRaw<Array<{ eventId: string; count: bigint }>>`
    SELECT "eventId", COUNT(*) as count
    FROM "ConversionLog"
    WHERE "shopId" = ${shopId}
      AND "createdAt" >= ${last24h}
      AND "eventId" IS NOT NULL
    GROUP BY "eventId"
    HAVING COUNT(*) > 1
  `;

  const conflictCount = duplicates.length;
  const totalDuplicates = duplicates.reduce((sum, d) => sum + Number(d.count) - 1, 0);
  const triggered = conflictCount >= threshold;

  return {
    shopId,
    shopDomain,
    triggered,
    alertType: "dedup_conflict",
    severity: conflictCount > 20 ? "high" : "medium",
    message: `检测到 ${conflictCount} 个事件 ID 存在重复发送（共 ${totalDuplicates} 次重复）`,
    data: { conflictCount, totalDuplicates, threshold },
  };
}

/**
 * 检查像素心跳
 */
export async function checkPixelHeartbeat(
  shopId: string,
  shopDomain: string,
  thresholds: Partial<AlertThresholds> = {}
): Promise<AlertCheckResult> {
  const staleHours = thresholds.heartbeatStaleHours ?? DEFAULT_THRESHOLDS.heartbeatStaleHours;
  
  const lastReceipt = await prisma.pixelEventReceipt.findFirst({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const now = new Date();
  const lastReceiptTime = lastReceipt?.createdAt;
  const hoursSinceLastReceipt = lastReceiptTime
    ? (now.getTime() - lastReceiptTime.getTime()) / (1000 * 60 * 60)
    : Infinity;

  const triggered = hoursSinceLastReceipt > staleHours;

  return {
    shopId,
    shopDomain,
    triggered,
    alertType: "pixel_heartbeat",
    severity: hoursSinceLastReceipt > 48 ? "critical" : "high",
    message: lastReceiptTime
      ? `超过 ${Math.round(hoursSinceLastReceipt)} 小时未收到像素心跳`
      : "从未收到像素心跳事件",
    data: { lastReceiptTime: lastReceiptTime?.toISOString(), hoursSinceLastReceipt, staleHours },
  };
}

// ============================================================
// 告警调度
// ============================================================

/**
 * 运行所有告警检查并发送通知
 */
export async function runAlertChecks(shopId: string): Promise<{
  checked: number;
  triggered: number;
  sent: number;
  results: AlertCheckResult[];
}> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      id: true,
      shopDomain: true,
      alertConfigs: {
        where: { isEnabled: true },
      },
    },
  });

  if (!shop) {
    logger.warn(`Shop not found for alert checks: ${shopId}`);
    return { checked: 0, triggered: 0, sent: 0, results: [] };
  }

  const results: AlertCheckResult[] = [];

  // 运行所有检查
  results.push(await checkFailureRate(shopId, shop.shopDomain));
  results.push(await checkMissingParams(shopId, shop.shopDomain));
  results.push(await checkVolumeDrop(shopId, shop.shopDomain));
  results.push(await checkDedupConflicts(shopId, shop.shopDomain));
  results.push(await checkPixelHeartbeat(shopId, shop.shopDomain));

  const triggeredAlerts = results.filter(r => r.triggered);
  let sent = 0;

  // 对每个触发的告警发送通知
  for (const alertResult of triggeredAlerts) {
    for (const config of shop.alertConfigs) {
      // 检查频率限制
      const canSend = await canSendAlert(config.id, config.frequency);
      if (!canSend) {
        logger.debug(`Skipping alert due to frequency limit`, { configId: config.id });
        continue;
      }

      // 转换为 AlertData 格式
      const alertData: AlertData = {
        platform: alertResult.alertType,
        reportDate: new Date(),
        shopifyOrders: (alertResult.data?.total as number) || 0,
        platformConversions: (alertResult.data?.sent as number) || 0,
        orderDiscrepancy: (alertResult.data?.failureRate as number) || 0,
        revenueDiscrepancy: 0,
        shopDomain: shop.shopDomain,
        // 额外字段通过扩展传递
        customMessage: alertResult.message,
        alertType: alertResult.alertType,
        severity: alertResult.severity,
      } as AlertData;

      try {
        const success = await sendAlert(config as unknown as Parameters<typeof sendAlert>[0], alertData);
        if (success) {
          sent++;
          await prisma.alertConfig.update({
            where: { id: config.id },
            data: { lastAlertAt: new Date() },
          });
        }
      } catch (error) {
        logger.error(`Failed to send alert`, { configId: config.id, error });
      }
    }
  }

  logger.info(`Alert checks completed`, {
    shopId,
    checked: results.length,
    triggered: triggeredAlerts.length,
    sent,
  });

  return {
    checked: results.length,
    triggered: triggeredAlerts.length,
    sent,
    results,
  };
}

/**
 * 检查是否可以发送告警（基于频率限制）
 */
async function canSendAlert(configId: string, frequency: string): Promise<boolean> {
  const config = await prisma.alertConfig.findUnique({
    where: { id: configId },
    select: { lastAlertAt: true },
  });

  if (!config?.lastAlertAt) return true;

  const now = new Date();
  const lastAlert = config.lastAlertAt;
  const hoursSinceLastAlert = (now.getTime() - lastAlert.getTime()) / (1000 * 60 * 60);

  switch (frequency) {
    case "instant":
      return hoursSinceLastAlert >= 1; // 最少 1 小时间隔
    case "hourly":
      return hoursSinceLastAlert >= 1;
    case "daily":
      return hoursSinceLastAlert >= 24;
    case "weekly":
      return hoursSinceLastAlert >= 168;
    default:
      return hoursSinceLastAlert >= 24;
  }
}

/**
 * 批量运行所有店铺的告警检查（用于 cron job）
 */
export async function runAllShopAlertChecks(): Promise<{
  shopsChecked: number;
  totalTriggered: number;
  totalSent: number;
}> {
  const shops = await prisma.shop.findMany({
    where: {
      isActive: true,
      alertConfigs: {
        some: { isEnabled: true },
      },
    },
    select: { id: true },
  });

  let totalTriggered = 0;
  let totalSent = 0;

  for (const shop of shops) {
    try {
      const result = await runAlertChecks(shop.id);
      totalTriggered += result.triggered;
      totalSent += result.sent;
    } catch (error) {
      logger.error(`Alert check failed for shop`, { shopId: shop.id, error });
    }
  }

  logger.info(`All shop alert checks completed`, {
    shopsChecked: shops.length,
    totalTriggered,
    totalSent,
  });

  return {
    shopsChecked: shops.length,
    totalTriggered,
    totalSent,
  };
}

// ============================================================
// 获取告警历史
// ============================================================

export async function getAlertHistory(
  shopId: string,
  limit: number = 50
): Promise<Array<{
  id: string;
  alertType: AlertType;
  severity: string;
  message: string;
  createdAt: Date;
  acknowledged: boolean;
}>> {
  // 从 AuditLog 中获取告警记录
  const logs = await prisma.auditLog.findMany({
    where: {
      shopId,
      action: "alert_triggered",
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      metadata: true,
      createdAt: true,
    },
  });

  return logs.map(log => {
    const metadata = log.metadata as Record<string, unknown> || {};
    return {
      id: log.id,
      alertType: (metadata.alertType as AlertType) || "failure_rate",
      severity: (metadata.severity as string) || "medium",
      message: (metadata.message as string) || "告警",
      createdAt: log.createdAt,
      acknowledged: (metadata.acknowledged as boolean) || false,
    };
  });
}

/**
 * 确认告警（标记为已读）
 */
export async function acknowledgeAlert(
  alertId: string,
  shopId: string
): Promise<boolean> {
  try {
    await prisma.auditLog.updateMany({
      where: {
        id: alertId,
        shopId,
        action: "alert_triggered",
      },
      data: {
        metadata: {
          acknowledged: true,
          acknowledgedAt: new Date().toISOString(),
        },
      },
    });
    return true;
  } catch {
    return false;
  }
}

