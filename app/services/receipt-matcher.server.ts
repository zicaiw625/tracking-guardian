import prisma from '../db.server';
import { matchKeysEqual } from '../utils/crypto.server';
import { logger } from '../utils/logger.server';

export interface ReceiptFields {
  consentState: unknown;
  isTrusted: boolean;
  checkoutToken: string | null;
  orderId: string;
  trustLevel: string;
  signatureStatus: string;
  originHost: string | null;
  pixelTimestamp: Date | null;
  createdAt: Date;

  eventId: string | null;
}

export interface JobForReceiptMatch {
  shopId: string;
  orderId: string;
  checkoutToken: string | null | undefined;
  createdAt: Date;
}

const RECEIPT_SELECT_FIELDS = {
  consentState: true,
  isTrusted: true,
  checkoutToken: true,
  orderId: true,
  trustLevel: true,
  signatureStatus: true,
  originHost: true,
  pixelTimestamp: true,
  createdAt: true,
  shopId: true,
  eventId: true,
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
  const checkoutTokens = jobs
    .map(j => j.checkoutToken)
    .filter((t): t is string => !!t);

  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId: { in: shopIds },
      eventType: 'purchase',
      OR: [
        { orderId: { in: orderIds } },
        ...(checkoutTokens.length > 0
          ? [{ checkoutToken: { in: checkoutTokens } }]
          : []
        ),
      ],
    },
    select: RECEIPT_SELECT_FIELDS,
  });

  const receiptMap = new Map<string, ReceiptFields>();

  for (const receipt of receipts) {

    const orderKey = buildReceiptKey(receipt.shopId, 'order', receipt.orderId);
    receiptMap.set(orderKey, receipt);

    if (receipt.checkoutToken) {
      const tokenKey = buildReceiptKey(receipt.shopId, 'token', receipt.checkoutToken);
      receiptMap.set(tokenKey, receipt);
    }
  }

  logger.debug(`Batch fetched ${receipts.length} receipts for ${jobs.length} jobs`, {
    shopCount: shopIds.length,
    orderIdCount: orderIds.length,
    tokenCount: checkoutTokens.length,
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
  webhookCheckoutToken: string | undefined
): ReceiptFields | null {

  const orderKey = buildReceiptKey(shopId, 'order', orderId);
  let receipt = receiptMap.get(orderKey);
  if (receipt) {
    return receipt;
  }

  if (webhookCheckoutToken) {
    const tokenKey = buildReceiptKey(shopId, 'token', webhookCheckoutToken);
    receipt = receiptMap.get(tokenKey);
    if (receipt) {
      return receipt;
    }
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

  if (webhookCheckoutToken) {
    const potentialReceipts = await findReceiptsByTimeWindow(
      shopId,
      jobCreatedAt,
      FUZZY_MATCH_WINDOW_MS
    );

    for (const candidate of potentialReceipts) {
      if (
        matchKeysEqual(
          { orderId, checkoutToken: webhookCheckoutToken },
          { orderId: candidate.orderId, checkoutToken: candidate.checkoutToken }
        )
      ) {
        logger.debug(`Found receipt via fuzzy matching`, {
          shopId: shopId.slice(0, 8),
          orderId: orderId.slice(0, 8),
        });
        return candidate;
      }
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
  try {
    await prisma.pixelEventReceipt.update({
      where: {
        shopId_orderId_eventType: {
          shopId,
          orderId,
          eventType: 'purchase',
        },
      },
      data: {
        trustLevel,
        untrustedReason: reason,
      },
    });
  } catch (error) {
    logger.debug(`Failed to update receipt trust level`, {
      shopId: shopId.slice(0, 8),
      orderId: orderId.slice(0, 8),
      error: error instanceof Error ? error.message : String(error),
    });
  }
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
