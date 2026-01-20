import prisma from '../db.server';
import { logger } from '../utils/logger.server';

export interface ReceiptFields {
  orderKey: string | null;
  originHost: string | null;
  pixelTimestamp: Date;
  createdAt: Date;
  id: string;
  shopId: string;
  eventType: string;
  payloadJson?: unknown;
}

export interface JobForReceiptMatch {
  shopId: string;
  orderId: string;
  checkoutToken: string | null | undefined;
  createdAt: Date;
}

const RECEIPT_SELECT_FIELDS = {
  id: true,
  shopId: true,
  orderKey: true,
  originHost: true,
  pixelTimestamp: true,
  createdAt: true,
  eventType: true,
  payloadJson: true,
};

const FUZZY_MATCH_WINDOW_MS = 60 * 60 * 1000;

const MAX_FUZZY_CANDIDATES = 10;

export async function batchFetchReceipts(
  jobs: JobForReceiptMatch[]
): Promise<Map<string, ReceiptFields>> {
  if (jobs.length === 0) {
    return new Map();
  }
  const shopIds = [...new Set(jobs.map(j => j.shopId))];
  const orderIds = jobs.map(j => j.orderId);
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId: { in: shopIds },
      eventType: 'purchase',
      orderKey: { in: orderIds },
    },
    select: RECEIPT_SELECT_FIELDS,
  });
  const receiptMap = new Map<string, ReceiptFields>();
  for (const receipt of receipts) {
    if (receipt.orderKey) {
      const orderKey = buildReceiptKey(receipt.shopId, 'order', receipt.orderKey);
      receiptMap.set(orderKey, receipt as ReceiptFields);
    }
  }
  logger.debug(`Batch fetched ${receipts.length} receipts for ${jobs.length} jobs`, {
    shopCount: shopIds.length,
    orderIdCount: orderIds.length,
  });
  return receiptMap;
}

export function buildReceiptKey(
  shopId: string,
  type: 'order' | 'token',
  identifier: string
): string {
  return `${shopId}:${type}:${identifier}`;
}

export function findReceiptFromMap(
  receiptMap: Map<string, ReceiptFields>,
  shopId: string,
  orderId: string,
  _webhookCheckoutToken: string | undefined
): ReceiptFields | null {
  const orderKey = buildReceiptKey(shopId, 'order', orderId);
  const receipt = receiptMap.get(orderKey);
  if (receipt) {
    return receipt;
  }
  return null;
}

export async function findReceiptForJob(
  receiptMap: Map<string, ReceiptFields>,
  shopId: string,
  orderId: string,
  webhookCheckoutToken: string | undefined,
  jobCreatedAt: Date
): Promise<ReceiptFields | null> {
  const fromMap = findReceiptFromMap(receiptMap, shopId, orderId, webhookCheckoutToken);
  if (fromMap) {
    return fromMap;
  }
  const potentialReceipts = await findReceiptsByTimeWindow(
    shopId,
    jobCreatedAt,
    FUZZY_MATCH_WINDOW_MS
  );
  for (const candidate of potentialReceipts) {
    if (candidate.orderKey === orderId) {
      logger.debug(`Found receipt via fuzzy matching`, {
        shopId: shopId.slice(0, 8),
        orderId: orderId.slice(0, 8),
      });
      return candidate;
    }
  }
  return null;
}

async function findReceiptsByTimeWindow(
  shopId: string,
  centerTime: Date,
  windowMs: number
): Promise<ReceiptFields[]> {
  return prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      eventType: 'purchase',
      createdAt: {
        gte: new Date(centerTime.getTime() - windowMs),
        lte: new Date(centerTime.getTime() + windowMs),
      },
    },
    select: RECEIPT_SELECT_FIELDS,
    take: MAX_FUZZY_CANDIDATES,
  });
}

export async function updateReceiptTrustLevel(
  shopId: string,
  orderId: string,
  trustLevel: string,
  reason?: string
): Promise<void> {
  logger.debug(`updateReceiptTrustLevel called but trust level fields no longer exist`, {
    shopId: shopId.slice(0, 8),
    orderId: orderId.slice(0, 8),
    trustLevel,
    reason,
  });
}

export function extractCheckoutTokensFromJobs(
  jobs: Array<{ capiInput: unknown }>
): string[] {
  return jobs
    .map(j => {
      if (j.capiInput && typeof j.capiInput === 'object') {
        const input = j.capiInput as Record<string, unknown>;
        return typeof input.checkoutToken === 'string' ? input.checkoutToken : null;
      }
      return null;
    })
    .filter((t): t is string => !!t);
}
