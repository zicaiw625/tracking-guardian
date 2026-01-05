

import { randomUUID } from "crypto";
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

    const data = await response.json().catch((jsonError) => {
      logger.error("Failed to parse GraphQL response as JSON", { error: jsonError });
      return { data: null };
    });
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
        id: randomUUID(),
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
  admin?: AdminApiContext,
  signal?: AbortSignal
): Promise<LocalConsistencyCheck | null> {
  // 检查是否已取消
  if (signal?.aborted) {
    return null;
  }

  let shopifyOrder: { value: number; currency: string; itemCount: number } | null = null;

  if (admin) {
    const orders = await fetchShopifyOrders(
      admin,
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      new Date(),
      100
    );
    
    // 检查是否已取消
    if (signal?.aborted) {
      return null;
    }
    
    const order = orders.find((o) => extractOrderId(o.id) === orderId);
    if (order) {
      shopifyOrder = {
        value: parseFloat(order.totalPriceSet.shopMoney.amount),
        currency: order.totalPriceSet.shopMoney.currencyCode,
        itemCount: 0,
      };
    }
  }

  // 检查是否已取消
  if (signal?.aborted) {
    return null;
  }

  if (!shopifyOrder) {
    const job = await prisma.conversionJob.findFirst({
      where: {
        shopId,
        orderId,
      },
      orderBy: { createdAt: "desc" },
    });

    // 检查是否已取消
    if (signal?.aborted) {
      return null;
    }

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

  // 检查是否已取消
  if (signal?.aborted) {
    return null;
  }

  // 检查是否已取消
  if (signal?.aborted) {
    return null;
  }

  const job = await prisma.conversionJob.findFirst({
    where: {
      shopId,
      orderId,
    },
    select: {
      capiInput: true,
      orderValue: true,
      currency: true,
      orderNumber: true,
    },
  });

  // 检查是否已取消
  if (signal?.aborted) {
    return null;
  }

  if (job?.capiInput) {
    try {
      const eventData = typeof job.capiInput === "string"
        ? JSON.parse(job.capiInput)
        : job.capiInput;
      if (eventData && typeof eventData === "object" && "items" in eventData && Array.isArray(eventData.items)) {
        shopifyOrder.itemCount = eventData.items.reduce(
          (sum: number, item: { quantity?: number }) => sum + (item.quantity || 1),
          0
        );
      }
    } catch (error) {

    }
  }

  // 检查是否已取消
  if (signal?.aborted) {
    return null;
  }

  const pixelReceipt = await prisma.pixelEventReceipt.findFirst({
    where: {
      shopId,
      orderId,
    },
    select: {
      id: true,
      orderId: true,
      metadata: true,
      checkoutToken: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // 检查是否已取消
  if (signal?.aborted) {
    return null;
  }

  const capiEvents = await prisma.conversionLog.findMany({
    where: {
      shopId,
      orderId,
    },
    orderBy: { createdAt: "desc" },
  });

  // 检查是否已取消
  if (signal?.aborted) {
    return null;
  }

  const issues: string[] = [];
  let consistencyStatus: "consistent" | "partial" | "inconsistent" = "consistent";

  let pixelPayloadValid = true;
  const pixelPayloadErrors: string[] = [];

  if (pixelReceipt) {
    const metadata = pixelReceipt.metadata as Record<string, unknown> | null;
    const payload = metadata?.payload || metadata;
    
    if (!payload) {
      pixelPayloadValid = false;
      pixelPayloadErrors.push("Pixel 收据缺少 payload");
    } else {
      try {
        const parsedPayload = typeof payload === "string"
          ? JSON.parse(payload)
          : payload;

        if (parsedPayload && typeof parsedPayload === "object") {
          if (!("event_name" in parsedPayload)) {
            pixelPayloadErrors.push("缺少 event_name");
          }
          if (!("event_time" in parsedPayload)) {
            pixelPayloadErrors.push("缺少 event_time");
          }
        }
      } catch (error) {
        pixelPayloadValid = false;
        pixelPayloadErrors.push("Payload 格式无效");
      }
    }

    const orderValue = metadata?.orderValue || metadata?.value;
    const currency = metadata?.currency;
    
    if (orderValue !== undefined && orderValue !== null) {
      const pixelValue = Number(orderValue);
      const valueMatch = Math.abs(pixelValue - shopifyOrder.value) < 0.01;
      const currencyMatch = currency ? String(currency) === shopifyOrder.currency : false;

      if (!valueMatch) {
        issues.push(`Pixel 金额不匹配: ${pixelValue} vs ${shopifyOrder.value}`);
      }
      if (currency && !currencyMatch) {
        issues.push(`Pixel 币种不匹配: ${String(currency)} vs ${shopifyOrder.currency}`);
      }
    }
  } else {
    issues.push("缺少 Pixel 收据");
  }

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

    if (!event.eventId) {
      issues.push(`${event.platform} CAPI 缺少 event_id（可能影响去重）`);
    }

    if (event.sentAt) {
      const eventTime = new Date(event.sentAt).getTime();
      const orderTime = new Date(event.createdAt).getTime();
      const timeDiff = Math.abs(eventTime - orderTime);
      const oneHour = 60 * 60 * 1000;
      if (timeDiff > oneHour) {
        issues.push(`${event.platform} CAPI 事件时间戳异常（延迟 ${Math.round(timeDiff / 1000 / 60)} 分钟）`);
      }
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

  const platformCounts = new Map<string, number>();
  capiEvents.forEach((event) => {
    const count = platformCounts.get(event.platform) || 0;
    platformCounts.set(event.platform, count + 1);
  });
  platformCounts.forEach((count, platform) => {
    if (count > 1) {
      issues.push(`${platform} CAPI 重复发送 ${count} 次（可能影响去重）`);
    }
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
    orderNumber: job?.orderNumber || null,
    shopifyOrder,
    pixelReceipt: {
      hasReceipt: !!pixelReceipt,
      payloadValid: pixelPayloadValid,
      valueMatch: pixelReceipt ? (() => {
        const metadata = pixelReceipt.metadata as Record<string, unknown> | null;
        const orderValue = metadata?.orderValue || metadata?.value;
        return orderValue !== undefined && orderValue !== null ? Math.abs(Number(orderValue) - shopifyOrder.value) < 0.01 : false;
      })() : false,
      currencyMatch: pixelReceipt ? (() => {
        const metadata = pixelReceipt.metadata as Record<string, unknown> | null;
        const currency = metadata?.currency;
        return currency ? String(currency) === shopifyOrder.currency : false;
      })() : false,
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
  admin?: AdminApiContext,
  options?: {
    maxConcurrent?: number;
    timeout?: number;
  }
): Promise<LocalConsistencyCheck[]> {
  const results: LocalConsistencyCheck[] = [];
  const maxConcurrent = options?.maxConcurrent || 5;
  const timeout = options?.timeout || 10000;

  for (let i = 0; i < orderIds.length; i += maxConcurrent) {
    const batch = orderIds.slice(i, i + maxConcurrent);
    const batchPromises = batch.map(async (orderId) => {
      let timeoutId: NodeJS.Timeout | null = null;
      let timeoutController: AbortController | null = null;
      let isTimedOut = false;
      let checkPromise: Promise<LocalConsistencyCheck | null> | null = null;

      try {
        // 创建 AbortController 用于取消操作
        timeoutController = new AbortController();
        const timeoutSignal = timeoutController.signal;

        // 启动检查操作，传入 AbortSignal
        checkPromise = checkLocalConsistency(shopId, orderId, admin, timeoutSignal);
        
        // 创建超时Promise，使用AbortSignal来避免竞态条件
        const timeoutPromise = new Promise<null>((resolve) => {
          if (timeoutSignal.aborted) {
            resolve(null);
            return;
          }
          
          timeoutId = setTimeout(() => {
            if (!timeoutSignal.aborted) {
              isTimedOut = true;
              // 取消操作
              timeoutController?.abort();
            }
            resolve(null);
          }, timeout);
        });

        // 使用 Promise.race 竞争执行
        // 注意：即使超时，checkPromise可能仍在运行，但会被AbortSignal取消
        const check = await Promise.race([checkPromise, timeoutPromise]);

        // 清理定时器（无论结果如何）
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        // 如果超时，返回 null（checkPromise 可能仍在运行，但会被 AbortSignal 取消）
        if (isTimedOut || (check === null && timeoutController?.signal.aborted)) {
          // 记录超时警告，帮助识别性能问题
          if (isTimedOut) {
            logger.warn("Local consistency check timed out", { 
              shopId, 
              orderId, 
              timeoutMs: timeout 
            });
          }
          // 如果超时，确保取消操作并等待checkPromise完成（如果仍在运行）
          if (checkPromise && timeoutController && !timeoutController.signal.aborted) {
            timeoutController.abort();
            // 等待checkPromise完成以避免资源泄漏（使用race避免无限等待）
            let cleanupTimeoutId: NodeJS.Timeout | null = null;
            try {
              await Promise.race([
                checkPromise.catch(() => null), // 忽略错误，因为我们已经超时了
                new Promise<void>(resolve => {
                  cleanupTimeoutId = setTimeout(() => {
                    resolve();
                  }, 1000); // 最多等待1秒
                })
              ]);
            } catch {
              // 忽略错误
            } finally {
              // 确保清理cleanup超时定时器
              if (cleanupTimeoutId !== null) {
                clearTimeout(cleanupTimeoutId);
              }
            }
          }
          return null;
        }

        // 验证返回结果的有效性
        if (check === null) {
          logger.warn("Local consistency check returned null", {
            shopId,
            orderId,
            wasAborted: timeoutController?.signal.aborted ?? false,
          });
          return null;
        }

        return check;
      } catch (error) {
        // 清理定时器
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        // 如果已经超时或被取消，不记录错误
        if (!isTimedOut && !timeoutController?.signal.aborted) {
          logger.warn("Failed to check local consistency", { orderId, error });
        }
        return null;
      } finally {
        // 确保清理资源
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        // 取消操作（如果仍在运行）
        if (timeoutController && !timeoutController.signal.aborted) {
          timeoutController.abort();
        }
        timeoutController = null;
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults.filter((r): r is LocalConsistencyCheck => r !== null));
  }

  return results;
}

export async function performBulkLocalConsistencyCheck(
  shopId: string,
  startDate: Date,
  endDate: Date,
  admin?: AdminApiContext,
  options?: {
    maxOrders?: number;
    maxConcurrent?: number;
    sampleRate?: number;
  }
): Promise<{
  totalChecked: number;
  consistent: number;
  partial: number;
  inconsistent: number;
  issues: Array<{
    orderId: string;
    status: "consistent" | "partial" | "inconsistent";
    issues: string[];
  }>;
}> {

  const jobs = await prisma.conversionJob.findMany({
    where: {
      shopId,
      createdAt: { gte: startDate, lte: endDate },
    },
    select: {
      orderId: true,
    },
    distinct: ["orderId"],
    take: options?.maxOrders || 100,
  });

  let orderIds = jobs.map((j) => j.orderId);

  if (options?.sampleRate && options.sampleRate < 1.0) {
    const sampleSize = Math.floor(orderIds.length * options.sampleRate);
    orderIds = orderIds.slice(0, sampleSize);
  }

  const checks = await performChannelReconciliation(shopId, orderIds, admin, {
    maxConcurrent: options?.maxConcurrent || 5,
  });

  const consistent = checks.filter((c) => c.consistencyStatus === "consistent").length;
  const partial = checks.filter((c) => c.consistencyStatus === "partial").length;
  const inconsistent = checks.filter((c) => c.consistencyStatus === "inconsistent").length;

  const issues = checks
    .filter((c) => c.consistencyStatus !== "consistent" || c.issues.length > 0)
    .map((c) => ({
      orderId: c.orderId,
      status: c.consistencyStatus,
      issues: c.issues,
    }));

  return {
    totalChecked: checks.length,
    consistent,
    partial,
    inconsistent,
    issues,
  };
}

