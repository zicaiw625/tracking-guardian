/**
 * Query Optimizer Service
 *
 * Provides optimized database query patterns to avoid N+1 problems
 * and improve query performance.
 */

import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";

// =============================================================================
// Types
// =============================================================================

/**
 * Shop with active pixel configs
 */
export interface ShopWithConfigs {
  id: string;
  shopDomain: string;
  plan: string | null;
  piiEnabled: boolean;
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

/**
 * Job with all required relations for processing
 */
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

/**
 * Conversion log with shop info
 */
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

// =============================================================================
// Optimized Queries
// =============================================================================

/**
 * Fetch jobs with all relations needed for processing.
 * Eliminates N+1 by eager loading shop and pixel configs.
 */
export async function fetchJobsWithRelations(
  jobIds: string[]
): Promise<JobWithRelations[]> {
  if (jobIds.length === 0) return [];

  return prisma.conversionJob.findMany({
    where: { id: { in: jobIds } },
    include: {
      shop: {
        select: {
          id: true,
          shopDomain: true,
          plan: true,
          piiEnabled: true,
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
}

/**
 * Fetch shops with their active pixel configurations.
 * Useful for bulk operations that need shop + config data.
 */
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
      piiEnabled: true,
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

/**
 * Fetch pixel event receipts in batch.
 * Returns a Map for O(1) lookups.
 */
export async function fetchReceiptsMap(
  queries: Array<{ shopId: string; orderId: string }>
): Promise<Map<string, { orderId: string; checkoutToken: string | null; consentState: unknown; trustLevel: string }>> {
  if (queries.length === 0) return new Map();

  // Build OR conditions for efficient batch query
  const orConditions = queries.map(q => ({
    shopId: q.shopId,
    orderId: q.orderId,
  }));

  const receipts = await prisma.pixelEventReceipt.findMany({
    where: { OR: orConditions },
    select: {
      shopId: true,
      orderId: true,
      checkoutToken: true,
      consentState: true,
      trustLevel: true,
    },
  });

  // Build map with composite key
  const map = new Map<string, { orderId: string; checkoutToken: string | null; consentState: unknown; trustLevel: string }>();
  for (const receipt of receipts) {
    const key = `${receipt.shopId}:${receipt.orderId}`;
    map.set(key, {
      orderId: receipt.orderId,
      checkoutToken: receipt.checkoutToken,
      consentState: receipt.consentState,
      trustLevel: receipt.trustLevel,
    });
  }

  return map;
}

/**
 * Fetch recent conversion logs for reconciliation.
 * Optimized for date range queries with proper indexing.
 */
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
  return prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: { gte: startDate, lt: endDate },
      platform: { in: platforms },
    },
    select: {
      platform: true,
      status: true,
      orderValue: true,
      currency: true,
    },
  });
}

/**
 * Count pending jobs per shop for dashboard.
 */
export async function countPendingJobsPerShop(
  shopIds: string[]
): Promise<Map<string, number>> {
  if (shopIds.length === 0) return new Map();

  const results = await prisma.conversionJob.groupBy({
    by: ["shopId"],
    where: {
      shopId: { in: shopIds },
      status: { in: ["queued", "failed"] },
    },
    _count: { id: true },
  });

  const map = new Map<string, number>();
  for (const result of results) {
    map.set(result.shopId, result._count.id);
  }

  return map;
}

// =============================================================================
// Pagination Helpers
// =============================================================================

/**
 * Cursor-based pagination for large datasets.
 */
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

/**
 * Paginate conversion logs with cursor.
 */
export async function paginateConversionLogs(
  shopId: string,
  params: CursorPaginationParams
): Promise<CursorPaginationResult<{ id: string; orderId: string; status: string; createdAt: Date }>> {
  const { cursor, take, orderBy = "desc" } = params;

  const items = await prisma.conversionLog.findMany({
    where: { shopId },
    select: {
      id: true,
      orderId: true,
      status: true,
      createdAt: true,
    },
    take: take + 1, // Fetch one extra to check if there's more
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : 0,
    orderBy: { createdAt: orderBy },
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

// =============================================================================
// Aggregate Queries
// =============================================================================

/**
 * Get conversion statistics for a shop.
 */
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
  const logs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: { gte: startDate, lt: endDate },
    },
    select: {
      platform: true,
      status: true,
      orderValue: true,
    },
  });

  const totalOrders = logs.length;
  const successfulOrders = logs.filter(l => l.status === "sent").length;
  const totalValue = logs.reduce((sum, l) => sum + Number(l.orderValue), 0);

  const platformBreakdown: Record<string, { count: number; value: number }> = {};
  for (const log of logs) {
    if (!platformBreakdown[log.platform]) {
      platformBreakdown[log.platform] = { count: 0, value: 0 };
    }
    platformBreakdown[log.platform].count++;
    platformBreakdown[log.platform].value += Number(log.orderValue);
  }

  return {
    totalOrders,
    totalValue,
    successRate: totalOrders > 0 ? successfulOrders / totalOrders : 0,
    platformBreakdown,
  };
}

/**
 * Get job queue health metrics.
 */
export async function getJobQueueHealth(): Promise<{
  queued: number;
  processing: number;
  failed: number;
  deadLetter: number;
  oldestQueuedAt: Date | null;
}> {
  const [counts, oldestQueued] = await Promise.all([
    prisma.conversionJob.groupBy({
      by: ["status"],
      _count: { id: true },
    }),
    prisma.conversionJob.findFirst({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);

  const countMap = new Map(counts.map(c => [c.status, c._count.id]));

  return {
    queued: countMap.get("queued") ?? 0,
    processing: countMap.get("processing") ?? 0,
    failed: countMap.get("failed") ?? 0,
    deadLetter: countMap.get("dead_letter") ?? 0,
    oldestQueuedAt: oldestQueued?.createdAt ?? null,
  };
}

// =============================================================================
// Query Logging
// =============================================================================

/**
 * Log slow queries for monitoring.
 */
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

