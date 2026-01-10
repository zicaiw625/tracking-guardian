import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";

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

export interface ShopWithConfigs {
  id: string;
  shopDomain: string;
  plan: string | null;
  consentStrategy: string | null;
  primaryDomain: string | null;
  storefrontDomains: string[];
  pixelConfigs: Array<{
    id: string;
    platform: string;
    platformId: string | null;
    credentialsEncrypted: string | null;
    clientConfig: unknown;
  }>;
}

export interface JobWithRelations {
  id: string;
  shopId: string;
  orderId: string;
  orderNumber: string | null;
  orderValue: number | { toNumber(): number };
  currency: string;
  capiInput: unknown;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  shop: ShopWithConfigs;
}

export interface ConversionLogWithShop {
  id: string;
  shopId: string;
  orderId: string;
  platform: string;
  status: string;
  createdAt: Date;
  shop: {
    shopDomain: string;
    plan: string | null;
  };
}

export async function fetchJobsWithRelations(
  jobIds: string[]
): Promise<JobWithRelations[]> {
  return [];
}

export async function fetchShopsWithConfigs(
  shopDomains: string[]
): Promise<ShopWithConfigs[]> {
  if (shopDomains.length === 0) return [];
  return prisma.shop.findMany({
    where: { shopDomain: { in: shopDomains }, isActive: true },
    select: {
      id: true,
      shopDomain: true,
      plan: true,
      consentStrategy: true,
      primaryDomain: true,
      storefrontDomains: true,
      pixelConfigs: {
        where: { isActive: true, serverSideEnabled: true },
        select: {
          id: true,
          platform: true,
          platformId: true,
          credentialsEncrypted: true,
          clientConfig: true,
        },
      },
    },
  });
}

export async function fetchReceiptsMap(
  queries: Array<{ shopId: string; orderId: string }>
): Promise<Map<string, { orderId: string; checkoutToken: string | null; consentState: unknown; trustLevel: string }>> {
  if (queries.length === 0) return new Map();
  const orderIds = queries.map(q => q.orderId);
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId: queries[0].shopId,
      orderKey: { in: orderIds },
    },
    select: {
      shopId: true,
      orderKey: true,
      payloadJson: true,
    },
  });
  const map = new Map<string, { orderId: string; checkoutToken: string | null; consentState: unknown; trustLevel: string }>();
  for (const receipt of receipts) {
    if (!receipt.orderKey) continue;
    const key = `${receipt.shopId}:${receipt.orderKey}`;
    const payload = receipt.payloadJson as Record<string, unknown> | null;
    map.set(key, {
      orderId: receipt.orderKey,
      checkoutToken: null,
      consentState: payload?.consent || null,
      trustLevel: "trusted",
    });
  }
  return map;
}

export async function fetchConversionLogsForReconciliation(
  shopId: string,
  startDate: Date,
  endDate: Date,
  platforms: string[]
): Promise<Array<{
  platform: string;
  status: string;
  orderValue: import("@prisma/client").Prisma.Decimal;
  currency: string;
}>> {
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      createdAt: { gte: startDate, lt: endDate },
      eventType: { in: ["purchase", "checkout_completed"] },
    },
    select: {
      payloadJson: true,
    },
  });
  return receipts
    .filter(receipt => {
      const payload = receipt.payloadJson as Record<string, unknown> | null;
      const platform = extractPlatformFromPayload(payload);
      return platform && platforms.includes(platform);
    })
    .map(receipt => {
      const payload = receipt.payloadJson as Record<string, unknown> | null;
      const platform = extractPlatformFromPayload(payload) || "";
      const data = payload?.data as Record<string, unknown> | undefined;
      const value = typeof data?.value === "number" ? data.value : 0;
      const currency = (data?.currency as string) || "USD";
      const hasValue = value > 0 && !!currency;
      return {
        platform,
        status: hasValue ? "sent" : "pending",
        orderValue: value as any,
        currency,
      };
    });
}

export async function countPendingJobsPerShop(
  shopIds: string[]
): Promise<Map<string, number>> {
  return new Map();
}

export interface CursorPaginationParams {
  cursor?: string;
  take: number;
  orderBy?: "asc" | "desc";
}

export interface CursorPaginationResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function paginateConversionLogs(
  shopId: string,
  params: CursorPaginationParams
): Promise<CursorPaginationResult<{ id: string; orderId: string; status: string; createdAt: Date }>> {
  const { cursor, take, orderBy = "desc" } = params;
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      eventType: { in: ["purchase", "checkout_completed"] },
      ...(cursor ? { id: { gt: cursor } } : {}),
    },
    select: {
      id: true,
      orderKey: true,
      createdAt: true,
      payloadJson: true,
    },
    take: take + 1,
    orderBy: { createdAt: orderBy },
  });
  const items = receipts.map(receipt => {
    const payload = receipt.payloadJson as Record<string, unknown> | null;
    const data = payload?.data as Record<string, unknown> | undefined;
    const hasValue = data?.value !== undefined && data?.value !== null;
    const hasCurrency = !!data?.currency;
    const status = hasValue && hasCurrency ? "sent" : "pending";
    return {
      id: receipt.id,
      orderId: receipt.orderKey || "",
      status,
      createdAt: receipt.createdAt,
    };
  });
  const hasMore = items.length > take;
  const resultItems = hasMore ? items.slice(0, -1) : items;
  const nextCursor = hasMore ? resultItems[resultItems.length - 1]?.id : null;
  return {
    items: resultItems,
    nextCursor,
    hasMore,
  };
}

export async function getConversionStats(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<{
  totalOrders: number;
  totalValue: number;
  successRate: number;
  platformBreakdown: Record<string, { count: number; value: number }>;
}> {
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      createdAt: { gte: startDate, lt: endDate },
      eventType: { in: ["purchase", "checkout_completed"] },
    },
    select: {
      payloadJson: true,
    },
  });
  const platformBreakdown: Record<string, { count: number; value: number }> = {};
  let totalOrders = 0;
  let successfulOrders = 0;
  let totalValue = 0;
  for (const receipt of receipts) {
    const payload = receipt.payloadJson as Record<string, unknown> | null;
    const platform = extractPlatformFromPayload(payload);
    if (!platform) continue;
    totalOrders++;
    const data = payload?.data as Record<string, unknown> | undefined;
    const value = typeof data?.value === "number" ? data.value : 0;
    const hasValue = value > 0;
    const hasCurrency = !!data?.currency;
    if (hasValue && hasCurrency) {
      successfulOrders++;
    }
    totalValue += value;
    if (!platformBreakdown[platform]) {
      platformBreakdown[platform] = { count: 0, value: 0 };
    }
    platformBreakdown[platform].count++;
    platformBreakdown[platform].value += value;
  }
  return {
    totalOrders,
    totalValue,
    successRate: totalOrders > 0 ? successfulOrders / totalOrders : 0,
    platformBreakdown,
  };
}

export async function getJobQueueHealth(): Promise<{
  queued: number;
  processing: number;
  failed: number;
  deadLetter: number;
  oldestQueuedAt: Date | null;
}> {
  return {
    queued: 0,
    processing: 0,
    failed: 0,
    deadLetter: 0,
    oldestQueuedAt: null,
  };
}

export async function measureQuery<T>(
  name: string,
  query: () => Promise<T>,
  warnThresholdMs = 1000
): Promise<T> {
  const start = Date.now();
  try {
    return await query();
  } finally {
    const duration = Date.now() - start;
    if (duration > warnThresholdMs) {
      logger.warn(`Slow query: ${name}`, { durationMs: duration });
    }
  }
}
