import { randomUUID } from "crypto";
import prisma from "../db.server";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { logger } from "../utils/logger.server";
import { Decimal } from "@prisma/client/runtime/library";

function extractPlatformFromPayload(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  if (payload.platform && typeof payload.platform === "string") {
    return payload.platform;
  }
  if (payload.destination && typeof payload.destination === "string") {
    return payload.destination;
  }
  return null;
}

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
  const pixelReceipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      createdAt: { gte: startDate, lte: endDate },
      eventType: { in: ["purchase", "checkout_completed"] },
    },
    select: {
      id: true,
      orderKey: true,
      eventType: true,
      createdAt: true,
      payloadJson: true,
    },
  });
  const shopifyOrderMap = new Map<string, ShopifyOrder>();
  shopifyOrders.forEach(order => {
    const orderId = extractOrderId(order.id);
    shopifyOrderMap.set(orderId, order);
  });
  const receiptMap = new Map<string, typeof pixelReceipts[0][]>();
  pixelReceipts.forEach(receipt => {
    if (!receipt.orderKey) return;
    const existing = receiptMap.get(receipt.orderKey) || [];
    existing.push(receipt);
    receiptMap.set(receipt.orderKey, existing);
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
    const receipts = receiptMap.get(orderId) || [];
    if (receipts.length === 0) {
      discrepancies.push({
        orderId,
        orderNumber: shopifyOrder.name,
        shopifyValue,
        shopifyCurrency,
        trackedValue: null,
        trackedCurrency: null,
        discrepancyType: "missing",
        details: "订单未被追踪",
      });
    } else {
      matchedOrders++;
      for (const receipt of receipts) {
        const payload = receipt.payloadJson as Record<string, unknown> | null;
        const platform = extractPlatformFromPayload(payload) || "unknown";
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
        const data = payload?.data as Record<string, unknown> | undefined;
        const trackedValue = typeof data?.value === "number" ? data.value : 0;
        const trackedCurrency = (data?.currency as string) || shopifyCurrency;
        const hasValue = trackedValue > 0 && !!trackedCurrency;
        platformStats[platform].ordersTracked++;
        platformStats[platform].revenueTracked += trackedValue;
        if (hasValue) {
          platformStats[platform].ordersSent++;
          totalTrackedRevenue += trackedValue;
        } else {
          platformStats[platform].ordersFailed++;
        }
        if (hasValue && Math.abs(trackedValue - shopifyValue) > 0.01) {
          discrepancies.push({
            orderId,
            orderNumber: shopifyOrder.name,
            shopifyValue,
            shopifyCurrency,
            trackedValue,
            trackedCurrency,
            discrepancyType: "value_mismatch",
            details: `金额差异: Shopify ${shopifyValue} vs 追踪 ${trackedValue}`,
          });
        }
        if (hasValue && trackedCurrency !== shopifyCurrency) {
          discrepancies.push({
            orderId,
            orderNumber: shopifyOrder.name,
            shopifyValue,
            shopifyCurrency,
            trackedValue,
            trackedCurrency,
            discrepancyType: "currency_mismatch",
            details: `币种差异: Shopify ${shopifyCurrency} vs 追踪 ${trackedCurrency}`,
          });
        }
      }
      if (receipts.length > 1) {
        const platformCounts = new Map<string, number>();
        receipts.forEach(r => {
          const platform = r.platform || "unknown";
          platformCounts.set(platform, (platformCounts.get(platform) || 0) + 1);
        });
        for (const [platform, count] of platformCounts) {
          if (count > 1) {
            if (platformStats[platform]) {
              platformStats[platform].dedupConflicts++;
            }
            const firstReceipt = receipts[0];
            const payload = firstReceipt.payloadJson as Record<string, unknown> | null;
            const data = payload?.data as Record<string, unknown> | undefined;
            const trackedValue = typeof data?.value === "number" ? data.value : 0;
            const trackedCurrency = (data?.currency as string) || shopifyCurrency;
            discrepancies.push({
              orderId,
              orderNumber: shopifyOrder.name,
              shopifyValue,
              shopifyCurrency,
              trackedValue,
              trackedCurrency,
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
  const totalTrackedEvents = pixelReceipts.length;
  const result: ReconciliationResult = {
    shopId,
    period: { start: startDate, end: endDate },
    summary: {
      totalShopifyOrders: shopifyOrders.length,
      totalShopifyRevenue,
      totalTrackedEvents,
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
      orderKey: true,
      consentState: true,
    },
  });
  const pixelMap = new Map<string, { marketing: boolean; analytics: boolean } | null>();
  pixelReceipts.forEach(r => {
    if (r.orderKey) {
      pixelMap.set(r.orderKey, r.consentState as { marketing: boolean; analytics: boolean } | null);
    }
  });
  const capiMap = new Map<string, string>();
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
  if (signal?.aborted) {
    return null;
  }
  if (!shopifyOrder) {
    const receipt = await prisma.pixelEventReceipt.findFirst({
      where: {
        shopId,
        orderKey: orderId,
      },
      orderBy: { createdAt: "desc" },
      select: {
        payloadJson: true,
      },
    });
    if (signal?.aborted) {
      return null;
    }
    if (receipt) {
      const payload = receipt.payloadJson as Record<string, unknown> | null;
      const data = payload?.data as Record<string, unknown> | undefined;
      const value = typeof data?.value === "number" ? data.value : 0;
      const currency = (data?.currency as string) || "USD";
      if (value > 0) {
        shopifyOrder = {
          value,
          currency,
          itemCount: 0,
        };
      }
    }
  }
  if (!shopifyOrder) {
    return null;
  }
  if (signal?.aborted) {
    return null;
  }
  const pixelReceipt = await prisma.pixelEventReceipt.findFirst({
    where: {
      shopId,
      orderKey: orderId,
    },
    select: {
      id: true,
      orderKey: true,
      payloadJson: true,
    },
    orderBy: { createdAt: "desc" },
  });
  if (signal?.aborted) {
    return null;
  }
  const capiEvents = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      orderKey: orderId,
      eventType: { in: ["purchase", "checkout_completed"] },
    },
    select: {
      id: true,
      orderKey: true,
      eventType: true,
      payloadJson: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  if (signal?.aborted) {
    return null;
  }
  const issues: string[] = [];
  let consistencyStatus: "consistent" | "partial" | "inconsistent" = "consistent";
  let pixelPayloadValid = true;
  const pixelPayloadErrors: string[] = [];
  if (pixelReceipt) {
    const payload = pixelReceipt.payloadJson as Record<string, unknown> | null;
    if (!payload) {
      pixelPayloadValid = false;
      pixelPayloadErrors.push("Pixel 收据缺少 payload");
    } else {
      try {
        if (payload && typeof payload === "object") {
          if (!("event_name" in payload || "eventName" in payload)) {
            pixelPayloadErrors.push("缺少 event_name");
          }
          if (!("event_time" in payload || "eventTime" in payload)) {
            pixelPayloadErrors.push("缺少 event_time");
          }
        }
      } catch (error) {
        pixelPayloadValid = false;
        pixelPayloadErrors.push("Payload 格式无效");
      }
    }
    const data = payload?.data as Record<string, unknown> | undefined;
    const orderValue = data?.value || data?.orderValue;
    const currency = data?.currency;
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
    const payload = event.payloadJson as Record<string, unknown> | null;
    const platform = extractPlatformFromPayload(payload) || "unknown";
    const data = payload?.data as Record<string, unknown> | undefined;
    const value = typeof data?.value === "number" ? data.value : 0;
    const currency = (data?.currency as string) || "";
    const valueMatch = Math.abs(value - shopifyOrder!.value) < 0.01;
    const currencyMatch = currency === shopifyOrder!.currency;
    if (!valueMatch && value > 0) {
      issues.push(`${platform} Pixel 金额不匹配: ${value} vs ${shopifyOrder!.value}`);
    }
    if (!currencyMatch && currency) {
      issues.push(`${platform} Pixel 币种不匹配: ${currency} vs ${shopifyOrder!.currency}`);
    }
    const eventId = payload?.eventId as string | undefined || payload?.event_id as string | undefined;
    if (!eventId) {
      issues.push(`${platform} Pixel 缺少 event_id（可能影响去重）`);
    }
    const pixelTimestamp = payload?.event_time as number | undefined || payload?.eventTime as number | undefined;
    if (pixelTimestamp) {
      const eventTime = typeof pixelTimestamp === "number" ? pixelTimestamp * 1000 : new Date(pixelTimestamp).getTime();
      const orderTime = event.createdAt.getTime();
      const timeDiff = Math.abs(eventTime - orderTime);
      const oneHour = 60 * 60 * 1000;
      if (timeDiff > oneHour) {
        issues.push(`${platform} Pixel 事件时间戳异常（延迟 ${Math.round(timeDiff / 1000 / 60)} 分钟）`);
      }
    }
    return {
      platform,
      value,
      currency,
      status: value > 0 ? "sent" : "pending",
      valueMatch,
      currencyMatch,
    };
  });
  const platformCounts = new Map<string, number>();
  capiEvents.forEach((event) => {
    const payload = event.payloadJson as Record<string, unknown> | null;
    const eventPlatform = extractPlatformFromPayload(payload) || "unknown";
    const count = platformCounts.get(eventPlatform) || 0;
    platformCounts.set(eventPlatform, count + 1);
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
  const pixelPayload = pixelReceipt?.payloadJson as Record<string, unknown> | null;
  const pixelData = pixelPayload?.data as Record<string, unknown> | undefined;
  const pixelValue = typeof pixelData?.value === "number" ? pixelData.value : 0;
  const pixelCurrency = (pixelData?.currency as string) || "";
  const valueMatch = pixelReceipt && Math.abs(pixelValue - shopifyOrder.value) < 0.01;
  const currencyMatch = pixelReceipt && pixelCurrency === shopifyOrder.currency;

  return {
    orderId,
    orderNumber: null,
    shopifyOrder,
    pixelReceipt: {
      hasReceipt: !!pixelReceipt,
      payloadValid: pixelPayloadValid,
      valueMatch: valueMatch || false,
      currencyMatch: currencyMatch || false,
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
        timeoutController = new AbortController();
        const timeoutSignal = timeoutController.signal;
        checkPromise = checkLocalConsistency(shopId, orderId, admin, timeoutSignal);
        const timeoutPromise = new Promise<null>((resolve) => {
          if (timeoutSignal.aborted) {
            resolve(null);
            return;
          }
          timeoutId = setTimeout(() => {
            if (!timeoutSignal.aborted) {
              isTimedOut = true;
              timeoutController?.abort();
            }
            resolve(null);
          }, timeout);
        });
        const check = await Promise.race([checkPromise, timeoutPromise]);
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (isTimedOut || (check === null && timeoutController?.signal.aborted)) {
          if (isTimedOut) {
            logger.warn("Local consistency check timed out", {
              shopId,
              orderId,
              timeoutMs: timeout
            });
          }
          if (checkPromise && timeoutController && !timeoutController.signal.aborted) {
            timeoutController.abort();
            let cleanupTimeoutId: NodeJS.Timeout | null = null;
            try {
              await Promise.race([
                checkPromise.catch(() => null),
                new Promise<void>(resolve => {
                  cleanupTimeoutId = setTimeout(() => {
                    resolve();
                  }, 1000);
                })
              ]);
            } catch {
            } finally {
              if (cleanupTimeoutId !== null) {
                clearTimeout(cleanupTimeoutId);
              }
            }
          }
          return null;
        }
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
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (!isTimedOut && !timeoutController?.signal.aborted) {
          logger.warn("Failed to check local consistency", { orderId, error });
        }
        return null;
      } finally {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
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
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      createdAt: { gte: startDate, lte: endDate },
      eventType: { in: ["purchase", "checkout_completed"] },
    },
    select: {
      orderKey: true,
    },
    distinct: ["orderKey"],
    take: options?.maxOrders || 100,
  });
  let orderIds = receipts.map((r) => r.orderKey).filter(Boolean) as string[];
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
