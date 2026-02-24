import prisma from "../../db.server";
import { extractPlatformFromPayload } from "../../utils/common";
import { extractEventData } from "../../utils/receipt-parser";

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
  missingOrders: Array<{ orderId: string; orderValue: number; currency: string }>;
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
    limitReached: boolean;
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
  hours: number = 24,
  targetPlatforms?: string[]
): Promise<MultiPlatformReconciliationResult> {
  const since = new Date();
  since.setUTCHours(since.getUTCHours() - hours);
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
        limitReached: false,
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

  // Filter platforms if targetPlatforms is provided
  const platformsToAnalyze = targetPlatforms && targetPlatforms.length > 0
    ? shop.pixelConfigs.filter(c => targetPlatforms.includes(c.platform))
    : shop.pixelConfigs;

  if (platformsToAnalyze.length === 0 && targetPlatforms && targetPlatforms.length > 0) {
      // Case where user requested platforms but none are configured/active in pixelConfigs.
      // We should arguably still return results saying "Not Configured" or just empty.
      // But adhering to current logic, we proceed with empty list.
  }

  // 1. Fetch Orders (Source of Truth) AND Receipts in parallel
  // Limit to prevent OOM on large shops
  const LIMIT = 10000;
  const [receipts, orders] = await Promise.all([
    prisma.pixelEventReceipt.findMany({
      where: {
        shopId,
        createdAt: { gte: since },
        eventType: { in: ["checkout_completed", "purchase"] },
      },
      orderBy: { createdAt: "desc" },
      take: LIMIT,
      select: {
        orderKey: true,
        payloadJson: true,
        createdAt: true,
        platform: true,
        totalValue: true,
        currency: true,
      },
    }),
    prisma.orderSummary.findMany({
      where: {
        shopId,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: LIMIT,
      select: {
        orderId: true,
        totalPrice: true,
        currency: true,
        createdAt: true,
      },
    }),
  ]);

  const limitReached = orders.length >= LIMIT || receipts.length >= LIMIT;

  // Fix: Align time windows if limit reached to prevent false "missing orders"
  // If we fetched 10k orders (2 days) but 10k receipts (1 day), orders from day 2 would falsely appear missing.
  let effectiveOrders = orders;
  let effectiveReceipts = receipts;

  if (limitReached && orders.length > 0 && receipts.length > 0) {
    const oldestOrderDate = orders[orders.length - 1].createdAt;
    const oldestReceiptDate = receipts[receipts.length - 1].createdAt;
    
    // Use the more recent of the two oldest dates as the cutoff
    const safeCutoffDate = oldestOrderDate > oldestReceiptDate ? oldestOrderDate : oldestReceiptDate;
    
    effectiveOrders = orders.filter(o => o.createdAt >= safeCutoffDate);
    effectiveReceipts = receipts.filter(r => r.createdAt >= safeCutoffDate);
  }

  const shopifyOrderIds = new Set<string>();
  const shopifyOrderMap = new Map<string, { orderId: string; orderValue: number; currency: string }>();
  let shopifyTotalValue = 0;

  // Build Truth Map from Orders
  for (const order of effectiveOrders) {
    shopifyOrderIds.add(order.orderId);
    const value = Number(order.totalPrice);
    shopifyOrderMap.set(order.orderId, {
      orderId: order.orderId,
      orderValue: value,
      currency: order.currency || "USD",
    });
    shopifyTotalValue += value;
  }

  const platformComparisons: PlatformComparison[] = [];
  const platformOrderMaps: Record<string, Set<string>> = {};
  const platformValueMaps: Record<string, Map<string, number>> = {};

  for (const config of platformsToAnalyze) {
    const platform = config.platform;
    const platformReceipts = effectiveReceipts.filter(r => {
      // First check direct platform field if available
      if (r.platform === platform) return true;
      const payload = r.payloadJson as Record<string, unknown> | null;
      const receiptPlatform = extractPlatformFromPayload(payload);
      return receiptPlatform === platform;
    });

    const platformLogs = platformReceipts.map((receipt) => {
      const { value: parsedValue, currency: parsedCurrency, orderId: parsedOrderId } = extractEventData(receipt.payloadJson);
      const orderId = receipt.orderKey || parsedOrderId || "";
      
      // Prefer DB columns, fallback to parsed JSON
      const val = receipt.totalValue ? Number(receipt.totalValue) : (parsedValue || 0);
      const cur = receipt.currency || parsedCurrency || "USD";

      return {
        orderId,
        orderNumber: null,
        orderValue: val,
        currency: cur,
        createdAt: receipt.createdAt,
      };
    }).filter(l => !!l.orderId);

    const platformOrderIds = new Set(platformLogs.map((l) => l.orderId));
    const platformTotalValue = platformLogs.reduce(
      (sum, l) => sum + l.orderValue,
      0
    );

    platformOrderMaps[platform] = platformOrderIds;
    platformValueMaps[platform] = new Map(
      platformLogs.map((l) => [l.orderId, l.orderValue])
    );

    const missingOrders: Array<{ orderId: string; orderValue: number; currency: string }> = [];
    for (const orderId of shopifyOrderIds) {
      if (!platformOrderIds.has(orderId)) {
        const details = shopifyOrderMap.get(orderId);
        if (details) {
          missingOrders.push(details);
        }
      }
    }

    const orderIdCounts = new Map<string, number>();
    platformLogs.forEach((log) => {
      orderIdCounts.set(
        log.orderId,
        (orderIdCounts.get(log.orderId) || 0) + 1
      );
    });

    const duplicateOrders = Array.from(orderIdCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([orderId]) => orderId);

    // Calculate intersection for strict match rate
    let matchedCount = 0;
    for (const orderId of shopifyOrderIds) {
      if (platformOrderIds.has(orderId)) {
        matchedCount++;
      }
    }

    const matchRate =
      shopifyOrderIds.size > 0
        ? (matchedCount / shopifyOrderIds.size) * 100
        : 0;

    const discrepancy = Math.max(0, shopifyOrderIds.size - matchedCount);
    const discrepancyRate =
      shopifyOrderIds.size > 0
        ? (discrepancy / shopifyOrderIds.size) * 100
        : 0;

    const valueDiscrepancy = Math.abs(shopifyTotalValue - platformTotalValue);
    const valueDiscrepancyRate =
      shopifyTotalValue > 0 ? (valueDiscrepancy / shopifyTotalValue) * 100 : 0;

    const issues: ReconciliationIssue[] = [];
    if (missingOrders.length > 0 && shopifyOrderIds.size > 0) {
      const missingRate = (missingOrders.length / shopifyOrderIds.size) * 100;
      issues.push({
        type: "missing_order",
        severity: missingRate > 10 ? "critical" : missingRate > 5 ? "warning" : "info",
        message: `${missingOrders.length} orders not tracked by platform events (missing rate: ${missingRate.toFixed(2)}%)`,
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
        message: `Order value discrepancy ${valueDiscrepancyRate.toFixed(2)}% (difference: ${valueDiscrepancy.toFixed(2)})`,
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
        message: `Found ${duplicateOrders.length} orders with duplicate events`,
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
      limitReached,
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
  // 1. Fetch Order (Source of Truth) AND Receipts
  const [order, receipts] = await Promise.all([
    prisma.orderSummary.findFirst({
        where: { shopId, orderId }
    }),
    prisma.pixelEventReceipt.findMany({
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
        platform: true,
        totalValue: true,
        currency: true,
      },
    })
  ]);

  let shopifyOrder: { orderId: string; orderValue: number; currency: string; createdAt: Date } | null = null;
  
  if (order) {
      shopifyOrder = {
          orderId: order.orderId,
          orderValue: Number(order.totalPrice),
          currency: order.currency || "USD",
          createdAt: order.createdAt
      };
  } else if (receipts.length > 0) {
      // Fallback: Infer from receipt if OrderSummary missing (legacy behavior)
      const firstValid = receipts.find(r => {
          const val = r.totalValue ? Number(r.totalValue) : extractEventData(r.payloadJson).value;
          return val && val > 0;
      });
      if (firstValid) {
          const parsed = extractEventData(firstValid.payloadJson);
          const val = firstValid.totalValue ? Number(firstValid.totalValue) : parsed.value;
          const cur = firstValid.currency || parsed.currency || "USD";
          
          shopifyOrder = {
              orderId,
              orderValue: val || 0,
              currency: cur,
              createdAt: firstValid.createdAt
          };
      }
  }

  const platformEvents: Array<{
    platform: string;
    orderId: string;
    orderValue: number;
    currency: string;
    createdAt: Date;
    status: string;
  }> = [];

  for (const receipt of receipts) {
    const { value: parsedValue, currency: parsedCurrency, platform: parsedPlatform } = extractEventData(receipt.payloadJson);
    const platform = receipt.platform || parsedPlatform;
    
    if (!platform || platform === "unknown") continue;
    
    const val = receipt.totalValue ? Number(receipt.totalValue) : (parsedValue || 0);
    const cur = receipt.currency || parsedCurrency || "USD";
    const hasValue = val > 0 && !!cur;

    platformEvents.push({
      platform,
      orderId,
      orderValue: val,
      currency: cur,
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
          message: "No event record found for this platform",
        });
      } else {
        const platformValue = Number(platformEvent.orderValue || 0);
        const valueDiff = Math.abs(shopifyValue - platformValue);
        const valueDiffRate = shopifyValue > 0 ? (valueDiff / shopifyValue) * 100 : 0;
        if (valueDiffRate > 1) {
          discrepancies.push({
            platform,
            type: "value_mismatch",
            message: `Value discrepancy ${valueDiffRate.toFixed(2)}% (Shopify: ${shopifyValue}, Platform: ${platformValue})`,
          });
        }
        const timeDiff = platformEvent.createdAt.getTime() - shopifyOrder.createdAt.getTime();
        if (timeDiff > 5 * 60 * 1000) {
          discrepancies.push({
            platform,
            type: "timing_delay",
            message: `Event delayed by ${Math.round(timeDiff / 1000 / 60)} minutes`,
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
