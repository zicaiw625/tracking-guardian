import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { isRecord } from "../../utils/common";

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

export async function fetchJobsWithRelations(
  _jobIds: string[]
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

export async function countPendingJobsPerShop(
  _shopIds: string[]
): Promise<Map<string, number>> {
  return new Map();
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
