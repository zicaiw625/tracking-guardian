/**
 * Receipt Matching Service
 * 
 * Handles matching pixel event receipts to conversion jobs.
 * Provides batch fetching and fuzzy matching capabilities.
 */

import prisma from '../db.server';
import { matchKeysEqual } from '../utils/crypto.server';
import { logger } from '../utils/logger.server';

// =============================================================================
// Types
// =============================================================================

/**
 * Fields from PixelEventReceipt needed for job processing.
 * 
 * PR-1: 增加 eventId 字段，确保 job-processor 可以使用 pixel 侧生成的 eventId，
 * 从而保证平台去重一致性。
 */
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
  /** PR-1: Pixel 侧生成的 eventId，用于平台去重一致性 */
  eventId: string | null;
}

/**
 * Job data needed for receipt matching.
 */
export interface JobForReceiptMatch {
  shopId: string;
  orderId: string;
  checkoutToken: string | null | undefined;
  createdAt: Date;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Select fields for receipt queries.
 * 
 * PR-1: 增加 eventId 字段选择，确保 job-processor 可以使用 pixel 侧生成的 eventId。
 */
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
  eventId: true, // PR-1: 用于平台去重一致性
};

/**
 * Time window for fuzzy matching (1 hour).
 */
const FUZZY_MATCH_WINDOW_MS = 60 * 60 * 1000;

/**
 * Maximum candidates for fuzzy matching.
 */
const MAX_FUZZY_CANDIDATES = 10;

// =============================================================================
// Batch Fetching
// =============================================================================

/**
 * Batch prefetch receipts for multiple jobs.
 * Returns a Map for O(1) lookup during job processing.
 * 
 * @param jobs - Array of jobs to fetch receipts for
 * @returns Map keyed by "shopId:type:identifier" for fast lookup
 */
export async function batchFetchReceipts(
  jobs: JobForReceiptMatch[]
): Promise<Map<string, ReceiptFields>> {
  if (jobs.length === 0) {
    return new Map();
  }

  // Collect all shop IDs and identifiers
  const shopIds = [...new Set(jobs.map(j => j.shopId))];
  const orderIds = jobs.map(j => j.orderId);
  const checkoutTokens = jobs
    .map(j => j.checkoutToken)
    .filter((t): t is string => !!t);

  // Single batch query for all potential receipts
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

  // Build lookup map with multiple keys for each receipt
  const receiptMap = new Map<string, ReceiptFields>();
  
  for (const receipt of receipts) {
    // Key by orderId
    const orderKey = buildReceiptKey(receipt.shopId, 'order', receipt.orderId);
    receiptMap.set(orderKey, receipt);
    
    // Key by checkoutToken if available
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

// =============================================================================
// Receipt Lookup
// =============================================================================

/**
 * Build a receipt lookup key.
 */
export function buildReceiptKey(
  shopId: string,
  type: 'order' | 'token',
  identifier: string
): string {
  return `${shopId}:${type}:${identifier}`;
}

/**
 * Find matching receipt for a job from pre-fetched map.
 * Uses direct lookup strategies.
 * 
 * @param receiptMap - Pre-fetched receipt map
 * @param shopId - Shop identifier
 * @param orderId - Order identifier
 * @param webhookCheckoutToken - Checkout token from webhook (optional)
 * @returns Matching receipt or null
 */
export function findReceiptFromMap(
  receiptMap: Map<string, ReceiptFields>,
  shopId: string,
  orderId: string,
  webhookCheckoutToken: string | undefined
): ReceiptFields | null {
  // Strategy 1: Direct lookup by orderId
  const orderKey = buildReceiptKey(shopId, 'order', orderId);
  let receipt = receiptMap.get(orderKey);
  if (receipt) {
    return receipt;
  }

  // Strategy 2: Lookup by checkoutToken
  if (webhookCheckoutToken) {
    const tokenKey = buildReceiptKey(shopId, 'token', webhookCheckoutToken);
    receipt = receiptMap.get(tokenKey);
    if (receipt) {
      return receipt;
    }
  }

  return null;
}

/**
 * Find matching receipt with fuzzy matching fallback.
 * Only calls database if simple lookups fail.
 * 
 * @param receiptMap - Pre-fetched receipt map
 * @param shopId - Shop identifier
 * @param orderId - Order identifier
 * @param webhookCheckoutToken - Checkout token from webhook (optional)
 * @param jobCreatedAt - Job creation timestamp for time window
 * @returns Matching receipt or null
 */
export async function findReceiptForJob(
  receiptMap: Map<string, ReceiptFields>,
  shopId: string,
  orderId: string,
  webhookCheckoutToken: string | undefined,
  jobCreatedAt: Date
): Promise<ReceiptFields | null> {
  // Try fast map lookup first
  const fromMap = findReceiptFromMap(receiptMap, shopId, orderId, webhookCheckoutToken);
  if (fromMap) {
    return fromMap;
  }

  // Fallback: Fuzzy matching within time window (rare case)
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

/**
 * Find receipts within a time window for fuzzy matching.
 */
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

// =============================================================================
// Receipt Updates
// =============================================================================

/**
 * Update receipt trust level after verification.
 * 
 * @param shopId - Shop identifier
 * @param orderId - Order identifier
 * @param trustLevel - New trust level
 * @param reason - Reason if untrusted
 */
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

// =============================================================================
// Batch Processing Helpers
// =============================================================================

/**
 * Extract checkout tokens from job CAPI inputs.
 * 
 * @param jobs - Jobs with capiInput
 * @returns Array of non-null checkout tokens
 */
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

