/**
 * 增强版渠道对账服务
 * 对应设计方案 4.5 Verification - 渠道对账
 * 
 * 功能:
 * - 与 Shopify 订单金额对比
 * - 本地一致性检查
 * - 像素端与服务端对账
 * - 平台返回验证
 */

import prisma from "../db.server";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { logger } from "../utils/logger.server";
import { Decimal } from "@prisma/client/runtime/library";

// ============================================================
// 类型定义
// ============================================================

export interface ReconciliationResult {
  shopId: string;
  period: {
    start: Date;
    end: Date;
  };
  summary: {
    totalShopifyOrders: number;
    totalShopifyRevenue: number;
    totalTrackedEvents: number;
    totalTrackedRevenue: number;
    matchRate: number;
    revenueMatchRate: number;
  };
  platforms: Record<string, PlatformReconciliation>;
  discrepancies: OrderDiscrepancy[];
  issues: ReconciliationIssue[];
}

export interface PlatformReconciliation {
  platform: string;
  ordersTracked: number;
  ordersSent: number;
  ordersFailed: number;
  successRate: number;
  revenueTracked: number;
  avgLatencyMs: number;
  dedupConflicts: number;
}

export interface OrderDiscrepancy {
  orderId: string;
  orderNumber: string | null;
  shopifyValue: number;
  shopifyCurrency: string;
  trackedValue: number | null;
  trackedCurrency: string | null;
  discrepancyType: "missing" | "value_mismatch" | "currency_mismatch" | "duplicate";
  details: string;
}

export interface ReconciliationIssue {
  type: "error" | "warning" | "info";
  category: "missing_events" | "value_mismatch" | "dedup" | "latency" | "params";
  message: string;
  count: number;
  affectedOrders?: string[];
}

interface ShopifyOrder {
  id: string;
  name: string;
  totalPriceSet: {
    shopMoney: {
      amount: string;
      currencyCode: string;
    };
  };
  createdAt: string;
  financialStatus: string;
}

// ============================================================
// Shopify 订单获取
// ============================================================

/**
 * 从 Shopify 获取指定时间范围的订单
 */
export async function fetchShopifyOrders(
  admin: AdminApiContext,
  startDate: Date,
  endDate: Date,
  limit: number = 100
): Promise<ShopifyOrder[]> {
  const query = `
    query GetOrders($query: String!, $first: Int!) {
      orders(first: $first, query: $query) {
        edges {
          node {
            id
            name
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            createdAt
            financialStatus
          }
        }
      }
    }
  `;

  const queryString = `created_at:>=${startDate.toISOString()} created_at:<=${endDate.toISOString()} financial_status:paid`;

  try {
    const response = await admin.graphql(query, {
      variables: {
        query: queryString,
        first: limit,
      },
    });

    const data = await response.json();
    const orders = data.data?.orders?.edges?.map((edge: { node: ShopifyOrder }) => edge.node) || [];
    return orders;
  } catch (error) {
    logger.error("Failed to fetch Shopify orders", { error });
    return [];
  }
}

/**
 * 从订单 GID 中提取数字 ID
 */
function extractOrderId(gid: string): string {
  const match = gid.match(/Order\/(\d+)/);
  return match ? match[1] : gid;
}

// ============================================================
// 对账核心逻辑
// ============================================================

/**
 * 执行完整对账
 */
export async function runReconciliation(
  admin: AdminApiContext,
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<ReconciliationResult> {
  logger.info("Starting reconciliation", { shopId, startDate, endDate });

  // 1. 获取 Shopify 订单
  const shopifyOrders = await fetchShopifyOrders(admin, startDate, endDate);
  
  // 2. 获取本地追踪记录
  const conversionLogs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: { gte: startDate, lte: endDate },
      eventType: "purchase",
    },
  });

  // 3. 获取 Pixel 收据
  const pixelReceipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      createdAt: { gte: startDate, lte: endDate },
      eventType: "checkout_completed",
    },
  });

  // 4. 构建对账映射
  const shopifyOrderMap = new Map<string, ShopifyOrder>();
  shopifyOrders.forEach(order => {
    const orderId = extractOrderId(order.id);
    shopifyOrderMap.set(orderId, order);
  });

  const conversionMap = new Map<string, typeof conversionLogs[0][]>();
  conversionLogs.forEach(log => {
    const existing = conversionMap.get(log.orderId) || [];
    existing.push(log);
    conversionMap.set(log.orderId, existing);
  });

  const receiptMap = new Map<string, typeof pixelReceipts[0]>();
  pixelReceipts.forEach(receipt => {
    receiptMap.set(receipt.orderId, receipt);
  });

  // 5. 执行对账
  const discrepancies: OrderDiscrepancy[] = [];
  const platformStats: Record<string, PlatformReconciliation> = {};
  const issues: ReconciliationIssue[] = [];

  let totalShopifyRevenue = 0;
  let totalTrackedRevenue = 0;
  let matchedOrders = 0;

  // 检查每个 Shopify 订单
  for (const [orderId, shopifyOrder] of shopifyOrderMap) {
    const shopifyValue = parseFloat(shopifyOrder.totalPriceSet.shopMoney.amount);
    const shopifyCurrency = shopifyOrder.totalPriceSet.shopMoney.currencyCode;
    totalShopifyRevenue += shopifyValue;

    const conversions = conversionMap.get(orderId);
    const receipt = receiptMap.get(orderId);

    if (!conversions || conversions.length === 0) {
      // 订单未被追踪
      discrepancies.push({
        orderId,
        orderNumber: shopifyOrder.name,
        shopifyValue,
        shopifyCurrency,
        trackedValue: null,
        trackedCurrency: null,
        discrepancyType: "missing",
        details: receipt ? "有 Pixel 收据但无 CAPI 发送" : "订单未被追踪",
      });
    } else {
      matchedOrders++;

      // 按平台统计
      for (const conversion of conversions) {
        const platform = conversion.platform;
        if (!platformStats[platform]) {
          platformStats[platform] = {
            platform,
            ordersTracked: 0,
            ordersSent: 0,
            ordersFailed: 0,
            successRate: 0,
            revenueTracked: 0,
            avgLatencyMs: 0,
            dedupConflicts: 0,
          };
        }

        platformStats[platform].ordersTracked++;
        platformStats[platform].revenueTracked += Number(conversion.orderValue);

        if (conversion.status === "sent") {
          platformStats[platform].ordersSent++;
        } else if (conversion.status === "failed") {
          platformStats[platform].ordersFailed++;
        }

        // 检查金额一致性
        const trackedValue = Number(conversion.orderValue);
        totalTrackedRevenue += trackedValue;

        if (Math.abs(trackedValue - shopifyValue) > 0.01) {
          discrepancies.push({
            orderId,
            orderNumber: shopifyOrder.name,
            shopifyValue,
            shopifyCurrency,
            trackedValue,
            trackedCurrency: conversion.currency,
            discrepancyType: "value_mismatch",
            details: `金额差异: Shopify ${shopifyValue} vs 追踪 ${trackedValue}`,
          });
        }

        if (conversion.currency !== shopifyCurrency) {
          discrepancies.push({
            orderId,
            orderNumber: shopifyOrder.name,
            shopifyValue,
            shopifyCurrency,
            trackedValue,
            trackedCurrency: conversion.currency,
            discrepancyType: "currency_mismatch",
            details: `币种差异: Shopify ${shopifyCurrency} vs 追踪 ${conversion.currency}`,
          });
        }
      }

      // 检查重复发送
      if (conversions.length > 1) {
        const platformCounts = new Map<string, number>();
        conversions.forEach(c => {
          platformCounts.set(c.platform, (platformCounts.get(c.platform) || 0) + 1);
        });

        for (const [platform, count] of platformCounts) {
          if (count > 1) {
            if (platformStats[platform]) {
              platformStats[platform].dedupConflicts++;
            }
            discrepancies.push({
              orderId,
              orderNumber: shopifyOrder.name,
              shopifyValue,
              shopifyCurrency,
              trackedValue: Number(conversions[0].orderValue),
              trackedCurrency: conversions[0].currency,
              discrepancyType: "duplicate",
              details: `${platform} 平台重复发送 ${count} 次`,
            });
          }
        }
      }
    }
  }

  // 计算平台成功率
  for (const stats of Object.values(platformStats)) {
    stats.successRate = stats.ordersTracked > 0
      ? stats.ordersSent / stats.ordersTracked
      : 0;
  }

  // 生成问题汇总
  const missingCount = discrepancies.filter(d => d.discrepancyType === "missing").length;
  if (missingCount > 0) {
    issues.push({
      type: missingCount > shopifyOrders.length * 0.1 ? "error" : "warning",
      category: "missing_events",
      message: `${missingCount} 个订单未被追踪`,
      count: missingCount,
      affectedOrders: discrepancies
        .filter(d => d.discrepancyType === "missing")
        .slice(0, 10)
        .map(d => d.orderId),
    });
  }

  const valueMismatchCount = discrepancies.filter(d => d.discrepancyType === "value_mismatch").length;
  if (valueMismatchCount > 0) {
    issues.push({
      type: "warning",
      category: "value_mismatch",
      message: `${valueMismatchCount} 个订单金额不一致`,
      count: valueMismatchCount,
    });
  }

  const duplicateCount = discrepancies.filter(d => d.discrepancyType === "duplicate").length;
  if (duplicateCount > 0) {
    issues.push({
      type: "warning",
      category: "dedup",
      message: `${duplicateCount} 个订单存在重复发送`,
      count: duplicateCount,
    });
  }

  const result: ReconciliationResult = {
    shopId,
    period: { start: startDate, end: endDate },
    summary: {
      totalShopifyOrders: shopifyOrders.length,
      totalShopifyRevenue,
      totalTrackedEvents: conversionLogs.length,
      totalTrackedRevenue,
      matchRate: shopifyOrders.length > 0 ? matchedOrders / shopifyOrders.length : 1,
      revenueMatchRate: totalShopifyRevenue > 0 
        ? Math.min(totalTrackedRevenue / totalShopifyRevenue, 1) 
        : 1,
    },
    platforms: platformStats,
    discrepancies,
    issues,
  };

  logger.info("Reconciliation completed", {
    shopId,
    totalOrders: shopifyOrders.length,
    matchRate: result.summary.matchRate,
    issueCount: issues.length,
  });

  return result;
}

// ============================================================
// Pixel vs CAPI 对账
// ============================================================

/**
 * 对比 Pixel 收据和 CAPI 发送记录
 */
export async function reconcilePixelVsCapi(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<{
  pixelOnly: number;      // 只有 Pixel 没有 CAPI
  capiOnly: number;       // 只有 CAPI 没有 Pixel
  both: number;           // 两者都有
  consentBlocked: number; // 因同意而阻止
  details: Array<{
    orderId: string;
    hasPixel: boolean;
    hasCapi: boolean;
    pixelConsent: { marketing: boolean; analytics: boolean } | null;
    capiStatus: string | null;
  }>;
}> {
  const pixelReceipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      createdAt: { gte: startDate, lte: endDate },
      eventType: "checkout_completed",
    },
    select: {
      orderId: true,
      consentState: true,
    },
  });

  const capiLogs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: { gte: startDate, lte: endDate },
      eventType: "purchase",
    },
    select: {
      orderId: true,
      status: true,
      platform: true,
    },
  });

  const pixelMap = new Map<string, { marketing: boolean; analytics: boolean } | null>();
  pixelReceipts.forEach(r => {
    pixelMap.set(r.orderId, r.consentState as { marketing: boolean; analytics: boolean } | null);
  });

  const capiMap = new Map<string, string>();
  capiLogs.forEach(l => {
    if (!capiMap.has(l.orderId) || l.status === "sent") {
      capiMap.set(l.orderId, l.status);
    }
  });

  const allOrderIds = new Set([...pixelMap.keys(), ...capiMap.keys()]);
  
  let pixelOnly = 0;
  let capiOnly = 0;
  let both = 0;
  let consentBlocked = 0;
  const details: Array<{
    orderId: string;
    hasPixel: boolean;
    hasCapi: boolean;
    pixelConsent: { marketing: boolean; analytics: boolean } | null;
    capiStatus: string | null;
  }> = [];

  for (const orderId of allOrderIds) {
    const hasPixel = pixelMap.has(orderId);
    const hasCapi = capiMap.has(orderId);
    const pixelConsent = pixelMap.get(orderId) || null;
    const capiStatus = capiMap.get(orderId) || null;

    if (hasPixel && hasCapi) {
      both++;
    } else if (hasPixel && !hasCapi) {
      pixelOnly++;
      // 检查是否因 consent 阻止
      if (pixelConsent && !pixelConsent.marketing) {
        consentBlocked++;
      }
    } else if (!hasPixel && hasCapi) {
      capiOnly++;
    }

    details.push({
      orderId,
      hasPixel,
      hasCapi,
      pixelConsent,
      capiStatus,
    });
  }

  return {
    pixelOnly,
    capiOnly,
    both,
    consentBlocked,
    details: details.slice(0, 100), // 限制返回数量
  };
}

// ============================================================
// 保存对账报告
// ============================================================

/**
 * 保存对账报告到数据库
 */
export async function saveReconciliationReport(
  result: ReconciliationResult
): Promise<string> {
  // 按平台创建对账记录
  for (const [platform, stats] of Object.entries(result.platforms)) {
    await prisma.reconciliationReport.upsert({
      where: {
        shopId_platform_reportDate: {
          shopId: result.shopId,
          platform,
          reportDate: result.period.start,
        },
      },
      update: {
        shopifyOrders: result.summary.totalShopifyOrders,
        shopifyRevenue: new Decimal(result.summary.totalShopifyRevenue),
        platformConversions: stats.ordersSent,
        platformRevenue: new Decimal(stats.revenueTracked),
        orderDiscrepancy: 1 - result.summary.matchRate,
        revenueDiscrepancy: 1 - result.summary.revenueMatchRate,
        status: "completed",
      },
      create: {
        shopId: result.shopId,
        platform,
        reportDate: result.period.start,
        shopifyOrders: result.summary.totalShopifyOrders,
        shopifyRevenue: new Decimal(result.summary.totalShopifyRevenue),
        platformConversions: stats.ordersSent,
        platformRevenue: new Decimal(stats.revenueTracked),
        orderDiscrepancy: 1 - result.summary.matchRate,
        revenueDiscrepancy: 1 - result.summary.revenueMatchRate,
        status: "completed",
      },
    });
  }

  return result.shopId;
}

