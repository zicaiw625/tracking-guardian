

import prisma from "../db.server";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { logger } from "../utils/logger.server";
import { Decimal } from "@prisma/client/runtime/library";

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

function extractOrderId(gid: string): string {
  const match = gid.match(/Order\/(\d+)/);
  return match ? match[1] : gid;
}

export async function runReconciliation(
  admin: AdminApiContext,
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<ReconciliationResult> {
  logger.info("Starting reconciliation", { shopId, startDate, endDate });

  const shopifyOrders = await fetchShopifyOrders(admin, startDate, endDate);

  const conversionLogs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: { gte: startDate, lte: endDate },
      eventType: "purchase",
    },
  });

  const pixelReceipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      createdAt: { gte: startDate, lte: endDate },
      eventType: "checkout_completed",
    },
  });

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

  const discrepancies: OrderDiscrepancy[] = [];
  const platformStats: Record<string, PlatformReconciliation> = {};
  const issues: ReconciliationIssue[] = [];

  let totalShopifyRevenue = 0;
  let totalTrackedRevenue = 0;
  let matchedOrders = 0;

  for (const [orderId, shopifyOrder] of shopifyOrderMap) {
    const shopifyValue = parseFloat(shopifyOrder.totalPriceSet.shopMoney.amount);
    const shopifyCurrency = shopifyOrder.totalPriceSet.shopMoney.currencyCode;
    totalShopifyRevenue += shopifyValue;

    const conversions = conversionMap.get(orderId);
    const receipt = receiptMap.get(orderId);

    if (!conversions || conversions.length === 0) {

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

  for (const stats of Object.values(platformStats)) {
    stats.successRate = stats.ordersTracked > 0
      ? stats.ordersSent / stats.ordersTracked
      : 0;
  }

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

export async function reconcilePixelVsCapi(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<{
  pixelOnly: number;
  capiOnly: number;
  both: number;
  consentBlocked: number;
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
    details: details.slice(0, 100),
  };
}

export async function saveReconciliationReport(
  result: ReconciliationResult
): Promise<string> {

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

export interface LocalConsistencyCheck {
  orderId: string;
  orderNumber: string | null;
  shopifyOrder: {
    value: number;
    currency: string;
    itemCount: number;
  };
  pixelReceipt: {
    hasReceipt: boolean;
    payloadValid: boolean;
    valueMatch: boolean;
    currencyMatch: boolean;
    payloadErrors?: string[];
  };
  capiEvents: Array<{
    platform: string;
    value: number | null;
    currency: string | null;
    status: string;
    valueMatch: boolean;
    currencyMatch: boolean;
  }>;
  consistencyStatus: "consistent" | "partial" | "inconsistent";
  issues: string[];
}

export async function checkLocalConsistency(
  shopId: string,
  orderId: string,
  admin?: AdminApiContext
): Promise<LocalConsistencyCheck | null> {
  // 获取 Shopify 订单信息
  let shopifyOrder: { value: number; currency: string; itemCount: number } | null = null;

  if (admin) {
    const orders = await fetchShopifyOrders(
      admin,
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      new Date(),
      100
    );
    const order = orders.find((o) => extractOrderId(o.id) === orderId);
    if (order) {
      shopifyOrder = {
        value: parseFloat(order.totalPriceSet.shopMoney.amount),
        currency: order.totalPriceSet.shopMoney.currencyCode,
        itemCount: 0, // 需要在 GraphQL 查询中添加
      };
    }
  }

  // 如果没有 Shopify 订单信息，尝试从 conversionJob 获取
  if (!shopifyOrder) {
    const job = await prisma.conversionJob.findFirst({
      where: {
        shopId,
        orderId,
      },
      orderBy: { createdAt: "desc" },
    });

    if (job) {
      shopifyOrder = {
        value: Number(job.orderValue || 0),
        currency: job.currency || "USD",
        itemCount: 0,
      };
    }
  }

  if (!shopifyOrder) {
    return null;
  }

  // 获取 Pixel 收据
  const pixelReceipt = await prisma.pixelEventReceipt.findFirst({
    where: {
      shopId,
      orderId,
    },
    orderBy: { createdAt: "desc" },
  });

  // 获取 CAPI 事件
  const capiEvents = await prisma.conversionLog.findMany({
    where: {
      shopId,
      orderId,
    },
    orderBy: { createdAt: "desc" },
  });

  const issues: string[] = [];
  let consistencyStatus: "consistent" | "partial" | "inconsistent" = "consistent";

  // 验证 Pixel Payload
  let pixelPayloadValid = true;
  const pixelPayloadErrors: string[] = [];

  if (pixelReceipt) {
    if (!pixelReceipt.payload) {
      pixelPayloadValid = false;
      pixelPayloadErrors.push("Pixel 收据缺少 payload");
    } else {
      try {
        const payload = typeof pixelReceipt.payload === "string"
          ? JSON.parse(pixelReceipt.payload)
          : pixelReceipt.payload;

        if (!payload.event_name) {
          pixelPayloadErrors.push("缺少 event_name");
        }
        if (!payload.event_time) {
          pixelPayloadErrors.push("缺少 event_time");
        }
      } catch (error) {
        pixelPayloadValid = false;
        pixelPayloadErrors.push("Payload 格式无效");
      }
    }

    // 验证金额和币种
    if (pixelReceipt.orderValue) {
      const pixelValue = Number(pixelReceipt.orderValue);
      const valueMatch = Math.abs(pixelValue - shopifyOrder.value) < 0.01;
      const currencyMatch = pixelReceipt.currency === shopifyOrder.currency;

      if (!valueMatch) {
        issues.push(`Pixel 金额不匹配: ${pixelValue} vs ${shopifyOrder.value}`);
      }
      if (!currencyMatch) {
        issues.push(`Pixel 币种不匹配: ${pixelReceipt.currency} vs ${shopifyOrder.currency}`);
      }
    }
  } else {
    issues.push("缺少 Pixel 收据");
  }

  // 验证 CAPI 事件
  const capiEventChecks = capiEvents.map((event) => {
    const value = Number(event.orderValue || 0);
    const currency = event.currency || "";
    const valueMatch = Math.abs(value - shopifyOrder!.value) < 0.01;
    const currencyMatch = currency === shopifyOrder!.currency;

    if (!valueMatch) {
      issues.push(`${event.platform} CAPI 金额不匹配: ${value} vs ${shopifyOrder!.value}`);
    }
    if (!currencyMatch) {
      issues.push(`${event.platform} CAPI 币种不匹配: ${currency} vs ${shopifyOrder!.currency}`);
    }

    return {
      platform: event.platform,
      value,
      currency,
      status: event.status,
      valueMatch,
      currencyMatch,
    };
  });

  if (capiEventChecks.length === 0) {
    issues.push("缺少 CAPI 事件");
    consistencyStatus = "inconsistent";
  } else {
    const failedPlatforms = capiEventChecks.filter((c) => c.status !== "sent");
    if (failedPlatforms.length > 0) {
      consistencyStatus = "partial";
      issues.push(`${failedPlatforms.length} 个平台的 CAPI 发送失败`);
    }

    const valueMismatches = capiEventChecks.filter((c) => !c.valueMatch);
    const currencyMismatches = capiEventChecks.filter((c) => !c.currencyMatch);
    if (valueMismatches.length > 0 || currencyMismatches.length > 0) {
      if (consistencyStatus === "consistent") {
        consistencyStatus = "partial";
      }
    }
  }

  if (!pixelReceipt || !pixelPayloadValid || capiEventChecks.length === 0) {
    consistencyStatus = "inconsistent";
  }

  return {
    orderId,
    orderNumber: pixelReceipt?.orderNumber || null,
    shopifyOrder,
    pixelReceipt: {
      hasReceipt: !!pixelReceipt,
      payloadValid: pixelPayloadValid,
      valueMatch: pixelReceipt ? Math.abs(Number(pixelReceipt.orderValue || 0) - shopifyOrder.value) < 0.01 : false,
      currencyMatch: pixelReceipt ? pixelReceipt.currency === shopifyOrder.currency : false,
      payloadErrors: pixelPayloadErrors.length > 0 ? pixelPayloadErrors : undefined,
    },
    capiEvents: capiEventChecks,
    consistencyStatus,
    issues,
  };
}

export async function performChannelReconciliation(
  shopId: string,
  orderIds: string[],
  admin?: AdminApiContext
): Promise<LocalConsistencyCheck[]> {
  const results: LocalConsistencyCheck[] = [];

  for (const orderId of orderIds) {
    const check = await checkLocalConsistency(shopId, orderId, admin);
    if (check) {
      results.push(check);
    }
  }

  return results;
}

