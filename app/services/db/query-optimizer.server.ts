import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { Prisma } from "@prisma/client";
import { isRecord, extractPlatformFromPayload, normalizeDecimalValue, parseReceiptPayload, type ReceiptParsedData } from "../../utils/common";

function isPrismaDecimal(value: unknown): value is Prisma.Decimal {
  return value !== null && typeof value === "object" && "toNumber" in value && typeof (value as { toNumber(): number }).toNumber === "function";
}

function normalizeOrderValue(value: unknown): number {
  return normalizeDecimalValue(value);
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
  if (jobIds.length === 0) return [];
  const jobs = await prisma.conversionJob.findMany({
    where: { id: { in: jobIds } },
    include: {
      Shop: {
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
      },
    },
  });
  return jobs.map(job => ({
    id: job.id,
    shopId: job.shopId,
    orderId: job.orderId,
    orderNumber: job.orderNumber,
    orderValue: normalizeDecimalValue(job.orderValue),
    currency: job.currency,
    capiInput: job.capiInput,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    createdAt: job.createdAt,
    shop: {
      id: job.Shop.id,
      shopDomain: job.Shop.shopDomain,
      plan: job.Shop.plan,
      consentStrategy: job.Shop.consentStrategy,
      primaryDomain: job.Shop.primaryDomain,
      storefrontDomains: Array.isArray(job.Shop.storefrontDomains)
        ? job.Shop.storefrontDomains
        : [],
      pixelConfigs: job.Shop.pixelConfigs.map(config => ({
        id: config.id,
        platform: config.platform,
        platformId: config.platformId,
        credentialsEncrypted: config.credentialsEncrypted,
        clientConfig: config.clientConfig,
      })),
    },
  }));
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
  const shopIds = Array.from(new Set(queries.map(q => q.shopId)));
  const orderIds = queries.map(q => q.orderId);
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId: { in: shopIds },
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
    const payload = isRecord(receipt.payloadJson) ? receipt.payloadJson : null;
    map.set(key, {
      orderId: receipt.orderKey,
      checkoutToken: null,
      consentState: payload && 'consent' in payload ? payload.consent : null,
      trustLevel: "trusted",
    });
  }
  return map;
}

const MAX_RECONCILIATION_RECEIPTS = 50000;

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
  if (platforms.length === 0) {
    return [];
  }
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      createdAt: { gte: startDate, lt: endDate },
      eventType: { in: ["purchase", "checkout_completed"] },
    },
    select: {
      payloadJson: true,
    },
    take: MAX_RECONCILIATION_RECEIPTS,
  });
  const results: Array<{
    platform: string;
    status: string;
    orderValue: Prisma.Decimal;
    currency: string;
  }> = [];
  for (const receipt of receipts) {
    const payload = isRecord(receipt.payloadJson) ? receipt.payloadJson : null;
    const platform = extractPlatformFromPayload(payload);
    if (!platform || !platforms.includes(platform)) {
      continue;
    }
    const data = payload && isRecord(payload.data) ? payload.data : null;
    const value = typeof data?.value === "number" ? data.value : 0;
    const currency = typeof data?.currency === "string" ? data.currency : "USD";
    const hasValue = value > 0 && !!currency;
    results.push({
      platform,
      status: hasValue ? "sent" : "pending",
      orderValue: new Prisma.Decimal(value),
      currency,
    });
  }
  return results;
}

export async function countPendingJobsPerShop(
  shopIds: string[]
): Promise<Map<string, number>> {
  if (shopIds.length === 0) return new Map();
  const uniqueIds = [...new Set(shopIds)];
  const counts = await prisma.conversionJob.groupBy({
    by: ['shopId'],
    where: {
      shopId: { in: uniqueIds },
      status: { in: ['queued', 'processing'] },
    },
    _count: true,
  });
  const result = new Map<string, number>();
  for (const shopId of uniqueIds) {
    result.set(shopId, 0);
  }
  for (const item of counts) {
    result.set(item.shopId, item._count);
  }
  return result;
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

function parseCursor(cursor: string): { createdAt: Date; id: string } | null {
  const idx = cursor.lastIndexOf("|");
  if (idx === -1) return null;
  const createdAt = new Date(cursor.slice(0, idx));
  const id = cursor.slice(idx + 1);
  if (isNaN(createdAt.getTime()) || !id) return null;
  return { createdAt, id };
}

export async function paginateConversionLogs(
  shopId: string,
  params: CursorPaginationParams
): Promise<CursorPaginationResult<{ id: string; orderId: string; status: string; createdAt: Date }>> {
  const { cursor, take, orderBy = "desc" } = params;
  const baseWhere: Prisma.PixelEventReceiptWhereInput = {
    shopId,
    eventType: { in: ["purchase", "checkout_completed"] },
  };
  let cursorWhere: Prisma.PixelEventReceiptWhereInput | null = null;
  if (cursor) {
    const parsed = parseCursor(cursor);
    if (parsed) {
      if (orderBy === "desc") {
        cursorWhere = {
          OR: [
            { createdAt: { lt: parsed.createdAt } },
            { createdAt: parsed.createdAt, id: { lt: parsed.id } },
          ],
        };
      } else {
        cursorWhere = {
          OR: [
            { createdAt: { gt: parsed.createdAt } },
            { createdAt: parsed.createdAt, id: { gt: parsed.id } },
          ],
        };
      }
    }
  }
  const where: Prisma.PixelEventReceiptWhereInput = cursorWhere
    ? { AND: [baseWhere, cursorWhere] }
    : baseWhere;
  const receipts = await prisma.pixelEventReceipt.findMany({
    where,
    select: {
      id: true,
      orderKey: true,
      createdAt: true,
      payloadJson: true,
    },
    take: take + 1,
    orderBy: [{ createdAt: orderBy }, { id: orderBy }],
  });
  const items = receipts.map(receipt => {
    const payload = isRecord(receipt.payloadJson) ? receipt.payloadJson : null;
    const data = payload && isRecord(payload.data) ? payload.data : null;
    const hasValue = data !== null && data.value !== undefined && data.value !== null;
    const hasCurrency = data !== null && typeof data.currency === "string" && data.currency.trim().length > 0;
    const status = hasValue && hasCurrency ? "sent" : "pending";
    return {
      id: receipt.id,
      orderId: receipt.orderKey ?? "",
      status,
      createdAt: receipt.createdAt,
    };
  });
  const hasMore = items.length > take;
  const resultItems = hasMore ? items.slice(0, -1) : items;
  const last = resultItems[resultItems.length - 1];
  const nextCursor = hasMore && last
    ? `${last.createdAt.toISOString()}|${last.id}`
    : null;
  return {
    items: resultItems,
    nextCursor,
    hasMore,
  };
}


const MAX_STATS_RECEIPTS = 50000;

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
    take: MAX_STATS_RECEIPTS,
  });
  const platformBreakdown: Record<string, { count: number; value: number; successful: number }> = {};
  let totalOrders = 0;
  let successfulOrders = 0;
  let totalValue = 0;
  for (const receipt of receipts) {
    const parsed = parseReceiptPayload(receipt.payloadJson);
    if (!parsed) continue;
    totalOrders++;
    if (parsed.hasValue && parsed.hasCurrency) {
      successfulOrders++;
    }
    totalValue += parsed.value;
    if (!platformBreakdown[parsed.platform]) {
      platformBreakdown[parsed.platform] = { count: 0, value: 0, successful: 0 };
    }
    platformBreakdown[parsed.platform].count++;
    platformBreakdown[parsed.platform].value += parsed.value;
    if (parsed.hasValue && parsed.hasCurrency) {
      platformBreakdown[parsed.platform].successful++;
    }
  }
  const result: Record<string, { count: number; value: number }> = {};
  for (const [platform, stats] of Object.entries(platformBreakdown)) {
    result[platform] = { count: stats.count, value: stats.value };
  }
  return {
    totalOrders,
    totalValue,
    successRate: totalOrders > 0 ? successfulOrders / totalOrders : 0,
    platformBreakdown: result,
  };
}

export async function getJobQueueHealth(): Promise<{
  queued: number;
  processing: number;
  failed: number;
  deadLetter: number;
  oldestQueuedAt: Date | null;
}> {
  const [queuedCount, processingCount, failedCount, deadLetterCount, oldestQueued] = await Promise.all([
    prisma.conversionJob.count({ where: { status: 'queued' } }),
    prisma.conversionJob.count({ where: { status: 'processing' } }),
    prisma.conversionJob.count({ where: { status: 'failed' } }),
    prisma.conversionJob.count({ where: { status: 'dead_letter' } }),
    prisma.conversionJob.findFirst({
      where: { status: 'queued' },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  return {
    queued: queuedCount,
    processing: processingCount,
    failed: failedCount,
    deadLetter: deadLetterCount,
    oldestQueuedAt: oldestQueued?.createdAt ?? null,
  };
}

export async function measureQuery<T>(
  name: string,
  query: () => Promise<T>,
  warnThresholdMs = 1000
): Promise<T> {
  const start = performance.now();
  try {
    return await query();
  } finally {
    const duration = Math.round(performance.now() - start);
    if (duration > warnThresholdMs) {
      logger.warn(`Slow query: ${name}`, { durationMs: duration });
    }
  }
}
