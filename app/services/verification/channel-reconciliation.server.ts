import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { extractPlatformFromPayload, isRecord } from "../../utils/common";

export interface ChannelReconciliationDetail {
  platform: string;
  shopifyOrders: number;
  platformEvents: number;
  matchRate: number;
  discrepancy: number;
  discrepancyRate: number;
  valueDiscrepancy?: number;
  valueDiscrepancyRate?: number;
  shopifyTotalValue: number;
  platformTotalValue: number;
  missingOrders: string[];
  duplicateOrders: string[];
  lastCheckedAt: Date;
}

export interface PlatformComparison {
  platform: string;
  stats: ChannelReconciliationDetail;
  issues: ReconciliationIssue[];
}

export interface ReconciliationIssue {
  type: "missing_order" | "value_mismatch" | "duplicate_order" | "timing_issue";
  severity: "critical" | "warning" | "info";
  message: string;
  orderId?: string;
  details?: Record<string, unknown>;
}

export interface MultiPlatformReconciliationResult {
  summary: {
    totalShopifyOrders: number;
    totalPlatformEvents: number;
    overallMatchRate: number;
    platformsCompared: number;
    periodStart: Date;
    periodEnd: Date;
  };
  platforms: PlatformComparison[];
  crossPlatformAnalysis: {
    platformsInAgreement: string[];
    platformsWithDiscrepancies: string[];
    commonMissingOrders: string[];
    valueVarianceByPlatform: Record<string, number>;
  };
}

export async function performEnhancedChannelReconciliation(
  shopId: string,
  hours: number = 24
): Promise<MultiPlatformReconciliationResult> {
  const since = new Date();
  since.setHours(since.getHours() - hours);
  const now = new Date();
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    include: {
      pixelConfigs: {
        where: { isActive: true },
        select: { platform: true },
      },
    },
  });
  if (!shop || shop.pixelConfigs.length === 0) {
    return {
      summary: {
        totalShopifyOrders: 0,
        totalPlatformEvents: 0,
        overallMatchRate: 0,
        platformsCompared: 0,
        periodStart: since,
        periodEnd: now,
      },
      platforms: [],
      crossPlatformAnalysis: {
        platformsInAgreement: [],
        platformsWithDiscrepancies: [],
        commonMissingOrders: [],
        valueVarianceByPlatform: {},
      },
    };
  }
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      createdAt: { gte: since },
      eventType: { in: ["checkout_completed", "purchase"] },
    },
    select: {
      orderKey: true,
      payloadJson: true,
      createdAt: true,
    },
  });
  const shopifyOrderIds = new Set<string>();
  const shopifyOrderMap = new Map<string, { orderId: string; orderValue: number; currency: string }>();
  let shopifyTotalValue = 0;
  for (const receipt of receipts) {
    if (!receipt.orderKey) continue;
    shopifyOrderIds.add(receipt.orderKey);
    const payload = receipt.payloadJson as Record<string, unknown> | null;
    const data = payload?.data as Record<string, unknown> | undefined;
    const value = (data?.value as number) || 0;
    const currency = (data?.currency as string) || "USD";
    if (!shopifyOrderMap.has(receipt.orderKey)) {
      shopifyOrderMap.set(receipt.orderKey, {
        orderId: receipt.orderKey,
        orderValue: value,
        currency,
      });
      shopifyTotalValue += value;
    }
  }
  const platformComparisons: PlatformComparison[] = [];
  const platformOrderMaps: Record<string, Set<string>> = {};
  const platformValueMaps: Record<string, Map<string, number>> = {};
  for (const config of shop.pixelConfigs) {
    const platform = config.platform;
    const platformReceipts = receipts.filter(r => {
      const payload = r.payloadJson as Record<string, unknown> | null;
      const receiptPlatform = extractPlatformFromPayload(payload);
      return receiptPlatform === platform;
    });
    const platformLogs = platformReceipts.map((receipt) => {
      const payload = receipt.payloadJson as Record<string, unknown> | null;
      const data = payload?.data as Record<string, unknown> | undefined;
      let orderId = receipt.orderKey || "";
      let value = (data?.value as number) || 0;
      let currency = (data?.currency as string) || "USD";
      if (platform === "google") {
        const events = payload?.events as Array<Record<string, unknown>> | undefined;
        if (events && events.length > 0) {
          const params = events[0].params as Record<string, unknown> | undefined;
          if (params?.value !== undefined) value = (params.value as number) || 0;
          if (params?.currency) currency = String(params.currency);
          if (params?.transaction_id) orderId = String(params.transaction_id);
        }
      } else if (platform === "meta" || platform === "facebook") {
        const eventsData = payload?.data as Array<Record<string, unknown>> | undefined;
        if (eventsData && eventsData.length > 0) {
          const customData = eventsData[0].custom_data as Record<string, unknown> | undefined;
          if (customData?.value !== undefined) value = (customData.value as number) || 0;
          if (customData?.currency) currency = String(customData.currency);
          if (customData?.order_id) orderId = String(customData.order_id);
        }
      } else if (platform === "tiktok") {
        const eventsData = payload?.data as Array<Record<string, unknown>> | undefined;
        if (eventsData && eventsData.length > 0) {
          const properties = eventsData[0].properties as Record<string, unknown> | undefined;
          if (properties?.value !== undefined) value = (properties.value as number) || 0;
          if (properties?.currency) currency = String(properties.currency);
          if (properties?.order_id) orderId = String(properties.order_id);
        }
      }
      return {
        orderId: orderId || receipt.orderKey || "",
        orderNumber: null,
        orderValue: value,
        currency,
        createdAt: receipt.createdAt,
      };
    });
    const platformOrderIds = new Set(platformLogs.map((l: { orderId: string }) => l.orderId));
    const platformOrderMap = new Map(
      platformLogs.map((l: { orderId: string }) => [l.orderId, l])
    );
    const platformTotalValue = platformLogs.reduce(
      (sum: number, l: { orderValue: { toNumber: () => number } | number }) => {
        const value = typeof l.orderValue === 'object' && 'toNumber' in l.orderValue
          ? l.orderValue.toNumber()
          : typeof l.orderValue === 'number'
          ? l.orderValue
          : 0;
        return sum + value;
      },
      0
    );
    platformOrderMaps[platform] = platformOrderIds;
    platformValueMaps[platform] = new Map(
      platformLogs.map((l: { orderId: string; orderValue: { toNumber: () => number } | number }) => {
        const value = typeof l.orderValue === 'object' && 'toNumber' in l.orderValue
          ? l.orderValue.toNumber()
          : typeof l.orderValue === 'number'
          ? l.orderValue
          : 0;
        return [l.orderId, value];
      })
    );
    const missingOrders: string[] = [];
    for (const orderId of shopifyOrderIds) {
      if (!platformOrderIds.has(orderId)) {
        missingOrders.push(orderId);
      }
    }
    const orderIdCounts = new Map<string, number>();
    platformLogs.forEach((log: { orderId: string }) => {
      orderIdCounts.set(
        log.orderId,
        (orderIdCounts.get(log.orderId) || 0) + 1
      );
    });
    const duplicateOrders = Array.from(orderIdCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([orderId]) => orderId);
    const matchRate =
      shopifyOrderIds.size > 0
        ? (platformOrderIds.size / shopifyOrderIds.size) * 100
        : 0;
    const discrepancy = Math.max(0, shopifyOrderIds.size - platformOrderIds.size);
    const discrepancyRate =
      shopifyOrderIds.size > 0
        ? (discrepancy / shopifyOrderIds.size) * 100
        : 0;
    const valueDiscrepancy = Math.abs(shopifyTotalValue - platformTotalValue);
    const valueDiscrepancyRate =
      shopifyTotalValue > 0 ? (valueDiscrepancy / shopifyTotalValue) * 100 : 0;
    const issues: ReconciliationIssue[] = [];
    if (missingOrders.length > 0) {
      const missingRate = (missingOrders.length / shopifyOrderIds.size) * 100;
      issues.push({
        type: "missing_order",
        severity: missingRate > 10 ? "critical" : missingRate > 5 ? "warning" : "info",
        message: `有 ${missingOrders.length} 个订单未追踪到平台事件（缺失率: ${missingRate.toFixed(2)}%）`,
        details: {
          missingCount: missingOrders.length,
          missingRate,
        },
      });
    }
    if (valueDiscrepancyRate > 5) {
      issues.push({
        type: "value_mismatch",
        severity: valueDiscrepancyRate > 20 ? "critical" : "warning",
        message: `订单金额差异 ${valueDiscrepancyRate.toFixed(2)}%（差异金额: ${valueDiscrepancy.toFixed(2)}）`,
        details: {
          valueDiscrepancy,
          valueDiscrepancyRate,
          shopifyTotalValue,
          platformTotalValue,
        },
      });
    }
    if (duplicateOrders.length > 0) {
      issues.push({
        type: "duplicate_order",
        severity: duplicateOrders.length > shopifyOrderIds.size * 0.1 ? "warning" : "info",
        message: `发现 ${duplicateOrders.length} 个订单存在重复事件`,
        details: {
          duplicateCount: duplicateOrders.length,
        },
      });
    }
    platformComparisons.push({
      platform,
      stats: {
        platform,
        shopifyOrders: shopifyOrderIds.size,
        platformEvents: platformOrderIds.size,
        matchRate: Math.round(matchRate * 100) / 100,
        discrepancy,
        discrepancyRate: Math.round(discrepancyRate * 100) / 100,
        valueDiscrepancy: Math.round(valueDiscrepancy * 100) / 100,
        valueDiscrepancyRate: Math.round(valueDiscrepancyRate * 100) / 100,
        shopifyTotalValue: Math.round(shopifyTotalValue * 100) / 100,
        platformTotalValue: Math.round(platformTotalValue * 100) / 100,
        missingOrders: missingOrders.slice(0, 50),
        duplicateOrders: duplicateOrders.slice(0, 50),
        lastCheckedAt: now,
      },
      issues,
    });
  }
  const allPlatforms = Object.keys(platformOrderMaps);
  const commonMissingOrders: string[] = [];
  const platformsWithDiscrepancies: string[] = [];
  const platformsInAgreement: string[] = [];
  const valueVarianceByPlatform: Record<string, number> = {};
  if (allPlatforms.length > 1) {
    for (const orderId of shopifyOrderIds) {
      const missingInAllPlatforms = allPlatforms.every(
        (platform) => !platformOrderMaps[platform].has(orderId)
      );
      if (missingInAllPlatforms) {
        commonMissingOrders.push(orderId);
      }
    }
  }
  platformComparisons.forEach((comparison) => {
    if (comparison.stats.discrepancyRate > 5 || comparison.issues.length > 0) {
      platformsWithDiscrepancies.push(comparison.platform);
    } else {
      platformsInAgreement.push(comparison.platform);
    }
    const platformValues = Array.from(platformValueMaps[comparison.platform].values());
    if (platformValues.length > 0) {
      const mean = platformValues.reduce((sum, v) => sum + v, 0) / platformValues.length;
      const variance =
        platformValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) /
        platformValues.length;
      valueVarianceByPlatform[comparison.platform] = Math.sqrt(variance);
    }
  });
  const overallMatchRate =
    platformComparisons.length > 0
      ? platformComparisons.reduce((sum, p) => sum + p.stats.matchRate, 0) /
        platformComparisons.length
      : 0;
  return {
    summary: {
      totalShopifyOrders: shopifyOrderIds.size,
      totalPlatformEvents: platformComparisons.reduce(
        (sum, p) => sum + p.stats.platformEvents,
        0
      ),
      overallMatchRate: Math.round(overallMatchRate * 100) / 100,
      platformsCompared: platformComparisons.length,
      periodStart: since,
      periodEnd: now,
    },
    platforms: platformComparisons,
    crossPlatformAnalysis: {
      platformsInAgreement,
      platformsWithDiscrepancies,
      commonMissingOrders: commonMissingOrders.slice(0, 100),
      valueVarianceByPlatform,
    },
  };
}

export async function getOrderCrossPlatformComparison(
  shopId: string,
  orderId: string
): Promise<{
  orderId: string;
  shopifyOrder: {
    orderId: string;
    orderNumber?: string;
    orderValue: number;
    currency: string;
    createdAt: Date;
  } | null;
  platformEvents: Array<{
    platform: string;
    orderId: string;
    orderValue: number;
    currency: string;
    createdAt: Date;
    status: string;
  }>;
  discrepancies: Array<{
    platform: string;
    type: "missing" | "value_mismatch" | "timing_delay";
    message: string;
  }>;
}> {
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      orderKey: orderId,
      eventType: { in: ["checkout_completed", "purchase"] },
    },
    select: {
      id: true,
      payloadJson: true,
      pixelTimestamp: true,
      createdAt: true,
      orderKey: true,
    },
  });
  let shopifyOrder: { orderId: string; orderValue: number; currency: string; createdAt: Date } | null = null;
  const platformEvents: Array<{
    platform: string;
    orderId: string;
    orderValue: number;
    currency: string;
    createdAt: Date;
    status: string;
  }> = [];
  for (const receipt of receipts) {
    const payload = receipt.payloadJson as Record<string, unknown> | null;
    const platform = extractPlatformFromPayload(payload);
    if (!platform) continue;
    const data = payload?.data as Record<string, unknown> | undefined;
    let value = (data?.value as number) || 0;
    let currency = (data?.currency as string) || "USD";
    if (platform === "google") {
      const events = payload?.events as Array<Record<string, unknown>> | undefined;
      if (events && events.length > 0) {
        const params = events[0].params as Record<string, unknown> | undefined;
        if (params?.value !== undefined) value = (params.value as number) || 0;
        if (params?.currency) currency = String(params.currency);
      }
    } else if (platform === "meta" || platform === "facebook") {
      const eventsData = payload?.data as Array<Record<string, unknown>> | undefined;
      if (eventsData && eventsData.length > 0) {
        const customData = eventsData[0].custom_data as Record<string, unknown> | undefined;
        if (customData?.value !== undefined) value = (customData.value as number) || 0;
        if (customData?.currency) currency = String(customData.currency);
      }
    } else if (platform === "tiktok") {
      const eventsData = payload?.data as Array<Record<string, unknown>> | undefined;
      if (eventsData && eventsData.length > 0) {
        const properties = eventsData[0].properties as Record<string, unknown> | undefined;
        if (properties?.value !== undefined) value = (properties.value as number) || 0;
        if (properties?.currency) currency = String(properties.currency);
      }
    }
    if (!shopifyOrder && value > 0) {
      shopifyOrder = {
        orderId,
        orderValue: value,
        currency,
        createdAt: receipt.createdAt,
      };
    }
    const hasValue = value > 0 && !!currency;
    platformEvents.push({
      platform,
      orderId,
      orderValue: value,
      currency,
      createdAt: receipt.createdAt,
      status: hasValue ? "sent" : "fail",
    });
  }
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    include: {
      pixelConfigs: {
        where: { isActive: true },
        select: { platform: true },
      },
    },
  });
  const configuredPlatforms =
    shop?.pixelConfigs.map((c: { platform: string }) => c.platform) || [];
  const platformsWithEvents = new Set(platformEvents.map((e: { platform: string }) => e.platform));
  const discrepancies: Array<{
    platform: string;
    type: "missing" | "value_mismatch" | "timing_delay";
    message: string;
  }> = [];
  if (shopifyOrder) {
    const shopifyValue = shopifyOrder.orderValue;
    for (const platform of configuredPlatforms) {
      const platformEvent = platformEvents.find((e: { platform: string }) => e.platform === platform);
      if (!platformEvent) {
        discrepancies.push({
          platform,
          type: "missing",
          message: "未找到该平台的事件记录",
        });
      } else {
        const platformValue = Number(platformEvent.orderValue || 0);
        const valueDiff = Math.abs(shopifyValue - platformValue);
        const valueDiffRate = shopifyValue > 0 ? (valueDiff / shopifyValue) * 100 : 0;
        if (valueDiffRate > 1) {
          discrepancies.push({
            platform,
            type: "value_mismatch",
            message: `金额差异 ${valueDiffRate.toFixed(2)}%（Shopify: ${shopifyValue}, 平台: ${platformValue}）`,
          });
        }
        const timeDiff = platformEvent.createdAt.getTime() - shopifyOrder.createdAt.getTime();
        if (timeDiff > 5 * 60 * 1000) {
          discrepancies.push({
            platform,
            type: "timing_delay",
            message: `事件延迟 ${Math.round(timeDiff / 1000 / 60)} 分钟`,
          });
        }
      }
    }
  }
  return {
    orderId,
    shopifyOrder: shopifyOrder
      ? {
          orderId: shopifyOrder.orderId,
          orderNumber: undefined,
          orderValue: shopifyOrder.orderValue,
          currency: shopifyOrder.currency,
          createdAt: shopifyOrder.createdAt,
        }
      : null,
    platformEvents: platformEvents.map((e) => {
      return {
        platform: e.platform,
        orderId: e.orderId,
        orderValue: e.orderValue,
        currency: e.currency || "USD",
        createdAt: e.createdAt,
        status: e.status || "unknown",
      };
    }),
    discrepancies,
  };
}
