import { randomUUID } from "crypto";
import prisma from "../db.server";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { logger } from "../utils/logger.server";
import { Decimal } from "@prisma/client/runtime/library";
import { extractPlatformFromPayload, isRecord, extractStringValue, extractNumberValue } from "../utils/common";

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_CONCURRENT = 5;
const VALUE_MATCH_THRESHOLD = 0.01;
const TIMESTAMP_SECOND_THRESHOLD = 10000000000;

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value);
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
      return { data: null, errors: [{ message: "Failed to parse response" }] };
    });
    if (data && typeof data === "object" && "errors" in data && Array.isArray((data as { errors?: unknown }).errors)) {
      const errs = (data as { errors: { message?: string }[] }).errors;
      const hasAccessError = errs.some((err) =>
        err.message?.includes("read_orders") || err.message?.includes("Required access")
      );
      if (hasAccessError) {
        logger.warn("Missing read_orders scope for reconciliation", { errors: errs });
        throw new Error("Missing read_orders scope. Please reauthorize the app with read_orders permission.");
      }
      logger.error("GraphQL errors in fetchShopifyOrders", { errors: errs });
      return [];
    }
    const orders = (data as { data?: { orders?: { edges?: { node: ShopifyOrder }[] } } }).data?.orders?.edges?.map((edge: { node: ShopifyOrder }) => edge.node) || [];
    return orders;
  } catch (error) {
    if (error instanceof Error && error.message.includes("read_orders")) {
      throw error;
    }
    logger.error("Failed to fetch Shopify orders", { error });
    return [];
  }
}

function extractOrderId(gid: string): string {
  const match = gid.match(/Order\/(\d+)/);
  return match ? match[1] : gid;
}

type PixelReceiptType = {
  id: string;
  orderKey: string | null;
  eventType: string;
  createdAt: Date;
  payloadJson: unknown;
};

function matchOrdersWithReceipts(
  shopifyOrders: ShopifyOrder[],
  pixelReceipts: PixelReceiptType[]
): {
  shopifyOrderMap: Map<string, ShopifyOrder>;
  receiptMap: Map<string, PixelReceiptType[]>;
} {
  const shopifyOrderMap = new Map<string, ShopifyOrder>();
  shopifyOrders.forEach(order => {
    const orderId = extractOrderId(order.id);
    shopifyOrderMap.set(orderId, order);
  });
  const receiptMap = new Map<string, PixelReceiptType[]>();
  pixelReceipts.forEach(receipt => {
    if (!receipt.orderKey) return;
    const existing = receiptMap.get(receipt.orderKey) || [];
    existing.push(receipt);
    receiptMap.set(receipt.orderKey, existing);
  });
  return { shopifyOrderMap, receiptMap };
}

function calculatePlatformStats(
  receipts: PixelReceiptType[],
  platformStats: Record<string, PlatformReconciliation>
): { totalTrackedRevenue: number; matchedOrders: number } {
  let totalTrackedRevenue = 0;
  let matchedOrders = 0;
  for (const receipt of receipts) {
    const payload = isRecord(receipt.payloadJson) ? receipt.payloadJson : null;
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
    const data = payload && isRecord(payload.data) ? payload.data : null;
    const trackedValue = extractNumberValue(data, "value", 0);
    const trackedCurrency = extractStringValue(data, "currency", "");
    const hasValue = trackedValue > 0 && trackedCurrency.length > 0;
    platformStats[platform].ordersTracked++;
    platformStats[platform].revenueTracked += trackedValue;
    if (hasValue) {
      platformStats[platform].ordersSent++;
      totalTrackedRevenue += trackedValue;
    } else {
      platformStats[platform].ordersFailed++;
    }
  }
  if (receipts.length > 0) {
    matchedOrders = 1;
  }
  return { totalTrackedRevenue, matchedOrders };
}

function detectOrderDiscrepancies(
  orderId: string,
  shopifyOrder: ShopifyOrder,
  receipts: PixelReceiptType[],
  platformStats: Record<string, PlatformReconciliation>
): OrderDiscrepancy[] {
  const discrepancies: OrderDiscrepancy[] = [];
  const shopifyValue = parseFloat(shopifyOrder.totalPriceSet.shopMoney.amount);
  const shopifyCurrency = shopifyOrder.totalPriceSet.shopMoney.currencyCode;
  for (const receipt of receipts) {
    const payload = isRecord(receipt.payloadJson) ? receipt.payloadJson : null;
    const platform = extractPlatformFromPayload(payload) || "unknown";
    const data = payload && isRecord(payload.data) ? payload.data : null;
    const trackedValue = extractNumberValue(data, "value", 0);
    const trackedCurrency = extractStringValue(data, "currency", shopifyCurrency);
    const hasValue = trackedValue > 0 && !!trackedCurrency;
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
      const receiptPayload = isRecord(r.payloadJson) ? r.payloadJson : null;
      const receiptPlatform = extractPlatformFromPayload(receiptPayload) || "unknown";
      platformCounts.set(receiptPlatform, (platformCounts.get(receiptPlatform) || 0) + 1);
    });
    for (const [platform, count] of platformCounts) {
      if (count > 1) {
        if (platformStats[platform]) {
          platformStats[platform].dedupConflicts++;
        }
        const firstReceipt = receipts[0];
        const payload = isRecord(firstReceipt.payloadJson) ? firstReceipt.payloadJson : null;
        const data = payload && isRecord(payload.data) ? payload.data : null;
        const trackedValue = extractNumberValue(data, "value", 0);
        const trackedCurrency = extractStringValue(data, "currency", shopifyCurrency);
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
  return discrepancies;
}

function generateReconciliationIssues(
  discrepancies: OrderDiscrepancy[],
  shopifyOrders: ShopifyOrder[]
): ReconciliationIssue[] {
  const issues: ReconciliationIssue[] = [];
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
  return issues;
}

function processOrderReconciliation(
  orderId: string,
  shopifyOrder: ShopifyOrder,
  receipts: PixelReceiptType[],
  platformStats: Record<string, PlatformReconciliation>,
  discrepancies: OrderDiscrepancy[]
): { revenue: number; matched: boolean } {
  const shopifyValue = parseFloat(shopifyOrder.totalPriceSet.shopMoney.amount);
  if (receipts.length === 0) {
    discrepancies.push({
      orderId,
      orderNumber: shopifyOrder.name,
      shopifyValue,
      shopifyCurrency: shopifyOrder.totalPriceSet.shopMoney.currencyCode,
      trackedValue: null,
      trackedCurrency: null,
      discrepancyType: "missing",
      details: "订单未被追踪",
    });
    return { revenue: 0, matched: false };
  }
  const statsResult = calculatePlatformStats(receipts, platformStats);
  const orderDiscrepancies = detectOrderDiscrepancies(
    orderId,
    shopifyOrder,
    receipts,
    platformStats
  );
  discrepancies.push(...orderDiscrepancies);
  return { revenue: statsResult.totalTrackedRevenue, matched: true };
}

function calculateReconciliationSummary(
  shopifyOrders: ShopifyOrder[],
  pixelReceipts: PixelReceiptType[],
  matchedOrders: number,
  totalShopifyRevenue: number,
  totalTrackedRevenue: number
) {
  return {
    totalShopifyOrders: shopifyOrders.length,
    totalShopifyRevenue,
    totalTrackedEvents: pixelReceipts.length,
    totalTrackedRevenue,
    matchRate: shopifyOrders.length > 0 ? matchedOrders / shopifyOrders.length : 1,
    revenueMatchRate: totalShopifyRevenue > 0
      ? Math.min(totalTrackedRevenue / totalShopifyRevenue, 1)
      : 1,
  };
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
  const { shopifyOrderMap, receiptMap } = matchOrdersWithReceipts(shopifyOrders, pixelReceipts);
  const discrepancies: OrderDiscrepancy[] = [];
  const platformStats: Record<string, PlatformReconciliation> = {};
  let totalShopifyRevenue = 0;
  let totalTrackedRevenue = 0;
  let matchedOrders = 0;
  
  for (const [orderId, shopifyOrder] of shopifyOrderMap) {
    const shopifyValue = parseFloat(shopifyOrder.totalPriceSet.shopMoney.amount);
    totalShopifyRevenue += shopifyValue;
    const receipts = receiptMap.get(orderId) || [];
    const result = processOrderReconciliation(orderId, shopifyOrder, receipts, platformStats, discrepancies);
    totalTrackedRevenue += result.revenue;
    if (result.matched) {
      matchedOrders++;
    }
  }
  
  for (const stats of Object.values(platformStats)) {
    stats.successRate = stats.ordersTracked > 0
      ? stats.ordersSent / stats.ordersTracked
      : 0;
  }
  
  const issues = generateReconciliationIssues(discrepancies, shopifyOrders);
  const summary = calculateReconciliationSummary(
    shopifyOrders,
    pixelReceipts,
    matchedOrders,
    totalShopifyRevenue,
    totalTrackedRevenue
  );
  
  const result: ReconciliationResult = {
    shopId,
    period: { start: startDate, end: endDate },
    summary,
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
      payloadJson: true,
    },
  });
  const pixelMap = new Map<string, { marketing: boolean; analytics: boolean } | null>();
  pixelReceipts.forEach(r => {
    if (r.orderKey) {
      const consent = (r.payloadJson as Record<string, unknown>)?.consent as { marketing?: boolean; analytics?: boolean } | null | undefined;
      const c = consent && typeof consent === "object" ? { marketing: !!consent.marketing, analytics: !!consent.analytics } : null;
      pixelMap.set(r.orderKey, c);
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

async function fetchShopifyOrderData(
  shopId: string,
  orderId: string,
  admin?: AdminApiContext,
  signal?: AbortSignal
): Promise<{ value: number; currency: string; itemCount: number } | null> {
  if (signal?.aborted) {
    return null;
  }
  if (admin) {
    const orders = await fetchShopifyOrders(
      admin,
      new Date(Date.now() - SEVEN_DAYS_MS),
      new Date(),
      100
    );
    if (signal?.aborted) {
      return null;
    }
    const order = orders.find((o) => extractOrderId(o.id) === orderId);
    if (order) {
      return {
        value: parseFloat(order.totalPriceSet.shopMoney.amount),
        currency: order.totalPriceSet.shopMoney.currencyCode,
        itemCount: 0,
      };
    }
  }
  if (signal?.aborted) {
    return null;
  }
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
    const payload = isRecord(receipt.payloadJson) ? receipt.payloadJson : null;
    const data = payload && isRecord(payload.data) ? payload.data : null;
    const value = extractNumberValue(data, "value", 0);
    const currency = extractStringValue(data, "currency", "USD");
    if (value > 0) {
      return {
        value,
        currency,
        itemCount: 0,
      };
    }
  }
  return null;
}

function checkPixelReceipt(
  pixelReceipt: { id: string; orderKey: string | null; payloadJson: unknown } | null,
  shopifyOrder: { value: number; currency: string }
): { valid: boolean; errors: string[]; valueMatch: boolean; currencyMatch: boolean } {
  const errors: string[] = [];
  let valid = true;
  let valueMatch = false;
  let currencyMatch = false;
  if (!pixelReceipt) {
    return { valid: false, errors: ["缺少 Pixel 收据"], valueMatch: false, currencyMatch: false };
  }
  const payload = isRecord(pixelReceipt.payloadJson) ? pixelReceipt.payloadJson : null;
  if (!payload) {
    valid = false;
    errors.push("Pixel 收据缺少 payload");
  } else {
    if (!("event_name" in payload || "eventName" in payload)) {
      errors.push("缺少 event_name");
    }
    if (!("event_time" in payload || "eventTime" in payload)) {
      errors.push("缺少 event_time");
    }
  }
  const data = payload && isRecord(payload.data) ? payload.data : null;
  const orderValue = data?.value ?? data?.orderValue;
  const currency = data?.currency;
  if (orderValue !== undefined && orderValue !== null) {
    const pixelValue = isNumber(orderValue) ? orderValue : Number(orderValue);
    if (!Number.isNaN(pixelValue)) {
      valueMatch = Math.abs(pixelValue - shopifyOrder.value) < VALUE_MATCH_THRESHOLD;
      currencyMatch = isString(currency) && currency === shopifyOrder.currency;
    }
  }
  return { valid: valid && errors.length === 0, errors, valueMatch, currencyMatch };
}

type CapiEventCheck = {
  platform: string;
  value: number;
  currency: string;
  status: string;
  valueMatch: boolean;
  currencyMatch: boolean;
};

function checkCapiEvents(
  capiEvents: Array<{
    id: string;
    orderKey: string | null;
    eventType: string;
    payloadJson: unknown;
    createdAt: Date;
  }>,
  shopifyOrder: { value: number; currency: string },
  issues: string[]
): CapiEventCheck[] {
  return capiEvents.map((event) => {
    const payload = isRecord(event.payloadJson) ? event.payloadJson : null;
    const platform = extractPlatformFromPayload(payload) || "unknown";
    const data = payload && isRecord(payload.data) ? payload.data : null;
    const value = extractNumberValue(data, "value", 0);
    const currency = extractStringValue(data, "currency", "");
    const valueMatch = Math.abs(value - shopifyOrder.value) < VALUE_MATCH_THRESHOLD;
    const currencyMatch = currency === shopifyOrder.currency;
    if (!valueMatch && value > 0) {
      issues.push(`${platform} Pixel 金额不匹配: ${value} vs ${shopifyOrder.value}`);
    }
    if (!currencyMatch && currency.length > 0) {
      issues.push(`${platform} Pixel 币种不匹配: ${currency} vs ${shopifyOrder.currency}`);
    }
    const eventId = payload ? (extractStringValue(payload, "eventId") || extractStringValue(payload, "event_id")) : "";
    if (!eventId) {
      issues.push(`${platform} Pixel 缺少 event_id（可能影响去重）`);
    }
    const pixelTimestamp = payload ? (extractNumberValue(payload, "event_time") || extractNumberValue(payload, "eventTime")) : undefined;
    if (pixelTimestamp !== undefined && pixelTimestamp > 0) {
      const eventTime = pixelTimestamp < TIMESTAMP_SECOND_THRESHOLD ? pixelTimestamp * 1000 : pixelTimestamp;
      const orderTime = event.createdAt.getTime();
      const timeDiff = Math.abs(eventTime - orderTime);
      if (timeDiff > ONE_HOUR_MS) {
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
}

function collectPixelIssues(
  pixelCheck: { valid: boolean; errors: string[]; valueMatch: boolean; currencyMatch: boolean },
  pixelReceipt: { id: string; orderKey: string | null; payloadJson: unknown } | null,
  shopifyOrder: { value: number; currency: string },
  issues: string[]
): void {
  if (!pixelCheck.valid && pixelCheck.errors.length > 0) {
    issues.push(...pixelCheck.errors);
  }
  if (!pixelCheck.valueMatch && pixelReceipt) {
    const payload = isRecord(pixelReceipt.payloadJson) ? pixelReceipt.payloadJson : null;
    const data = payload && isRecord(payload.data) ? payload.data : null;
    const orderValue = data?.value ?? data?.orderValue;
    if (orderValue !== undefined && orderValue !== null) {
      const pixelValue = isNumber(orderValue) ? orderValue : Number(orderValue);
      if (!Number.isNaN(pixelValue)) {
        issues.push(`Pixel 金额不匹配: ${pixelValue} vs ${shopifyOrder.value}`);
      }
    }
  }
  if (!pixelCheck.currencyMatch && pixelReceipt) {
    const payload = isRecord(pixelReceipt.payloadJson) ? pixelReceipt.payloadJson : null;
    const data = payload && isRecord(payload.data) ? payload.data : null;
    const currency = extractStringValue(data, "currency", "");
    if (currency.length > 0) {
      issues.push(`Pixel 币种不匹配: ${currency} vs ${shopifyOrder.currency}`);
    }
  }
}

function collectCapiIssues(
  capiEvents: Array<{ payloadJson: unknown }>,
  capiEventChecks: CapiEventCheck[],
  issues: string[]
): void {
  const platformCounts = new Map<string, number>();
  capiEvents.forEach((event) => {
    const payload = isRecord(event.payloadJson) ? event.payloadJson : null;
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
  } else {
    const failedPlatforms = capiEventChecks.filter((c) => c.status !== "sent");
    if (failedPlatforms.length > 0) {
      issues.push(`${failedPlatforms.length} 个平台的 CAPI 发送失败`);
    }
  }
}

function evaluateConsistency(
  pixelReceipt: { id: string; orderKey: string | null; payloadJson: unknown } | null,
  pixelValid: boolean,
  capiEventChecks: CapiEventCheck[]
): "consistent" | "partial" | "inconsistent" {
  if (!pixelReceipt || !pixelValid || capiEventChecks.length === 0) {
    return "inconsistent";
  }
  const failedPlatforms = capiEventChecks.filter((c) => c.status !== "sent");
  if (failedPlatforms.length > 0) {
    return "partial";
  }
  const valueMismatches = capiEventChecks.filter((c) => !c.valueMatch);
  const currencyMismatches = capiEventChecks.filter((c) => !c.currencyMatch);
  if (valueMismatches.length > 0 || currencyMismatches.length > 0) {
    return "partial";
  }
  return "consistent";
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
  const shopifyOrder = await fetchShopifyOrderData(shopId, orderId, admin, signal);
  if (!shopifyOrder || signal?.aborted) {
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
  const pixelCheck = checkPixelReceipt(pixelReceipt, shopifyOrder);
  collectPixelIssues(pixelCheck, pixelReceipt, shopifyOrder, issues);
  const capiEventChecks = checkCapiEvents(capiEvents, shopifyOrder, issues);
  collectCapiIssues(capiEvents, capiEventChecks, issues);
  const consistencyStatus = evaluateConsistency(pixelReceipt, pixelCheck.valid, capiEventChecks);
  const pixelPayload = pixelReceipt && isRecord(pixelReceipt.payloadJson) ? pixelReceipt.payloadJson : null;
  const pixelData = pixelPayload && isRecord(pixelPayload.data) ? pixelPayload.data : null;
  const pixelValue = extractNumberValue(pixelData, "value", 0);
  const pixelCurrency = extractStringValue(pixelData, "currency", "");

  return {
    orderId,
    orderNumber: null,
    shopifyOrder,
    pixelReceipt: {
      hasReceipt: !!pixelReceipt,
      payloadValid: pixelCheck.valid,
      valueMatch: pixelCheck.valueMatch,
      currencyMatch: pixelCheck.currencyMatch,
      payloadErrors: pixelCheck.errors.length > 0 ? pixelCheck.errors : undefined,
    },
    capiEvents: capiEventChecks,
    consistencyStatus,
    issues,
  };
}

async function executeWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void
): Promise<T | null> {
  let timeoutId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => {
      onTimeout();
      resolve(null);
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    return result;
  } catch (error) {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    throw error;
  }
}

async function checkOrderWithTimeout(
  shopId: string,
  orderId: string,
  admin: AdminApiContext | undefined,
  timeoutMs: number
): Promise<LocalConsistencyCheck | null> {
  const timeoutController = new AbortController();
  let isTimedOut = false;
  const onTimeout = () => {
    isTimedOut = true;
    timeoutController.abort();
    logger.warn("Local consistency check timed out", {
      shopId,
      orderId,
      timeoutMs,
    });
  };
  try {
    const checkPromise = checkLocalConsistency(shopId, orderId, admin, timeoutController.signal);
    const result = await executeWithTimeout(checkPromise, timeoutMs, onTimeout);
    if (result === null && !isTimedOut) {
      logger.warn("Local consistency check returned null", {
        shopId,
        orderId,
        wasAborted: timeoutController.signal.aborted,
      });
    }
    return result;
  } catch (error) {
    if (!isTimedOut && !timeoutController.signal.aborted) {
      logger.warn("Failed to check local consistency", { orderId, error });
    }
    return null;
  } finally {
    if (!timeoutController.signal.aborted) {
      timeoutController.abort();
    }
  }
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
  const maxConcurrent = options?.maxConcurrent || DEFAULT_MAX_CONCURRENT;
  const timeout = options?.timeout || DEFAULT_TIMEOUT_MS;
  for (let i = 0; i < orderIds.length; i += maxConcurrent) {
    const batch = orderIds.slice(i, i + maxConcurrent);
    const batchPromises = batch.map((orderId) =>
      checkOrderWithTimeout(shopId, orderId, admin, timeout)
    );
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
  let orderIds: string[] = receipts
    .map((r) => r.orderKey)
    .filter((key): key is string => typeof key === "string" && key.length > 0);
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
