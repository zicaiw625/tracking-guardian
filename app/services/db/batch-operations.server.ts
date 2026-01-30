import { randomUUID } from "crypto";
import { getDb } from "../../container";
import type { Prisma } from "@prisma/client";
import { logger } from "../../utils/logger.server";
import { toInputJsonValue } from "../../utils/prisma-json";

export interface JobCompletionData {
  jobId: string;
  shopId: string;
  orderId: string;
  status: 'completed' | 'failed' | 'limit_exceeded' | 'dead_letter';
  platformResults?: Prisma.JsonValue;
  trustMetadata?: Prisma.JsonValue;
  consentEvidence?: Prisma.JsonValue;
  errorMessage?: string | null;
  nextRetryAt?: Date;
}

export interface PixelReceiptData {
  shopId: string;
  eventId: string;
  orderId: string;
  eventType: string;
  platform?: string;
  originHost?: string | null;
  pixelTimestamp?: Date;
  capiInput?: Prisma.JsonValue;
}

export interface BatchResult<T = unknown> {
  success: boolean;
  processed: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
  results?: T[];
}

export async function batchCompleteJobs(
  _completions: JobCompletionData[]
): Promise<BatchResult> {
  return { success: true, processed: 0, failed: 0, errors: [] };
}

export async function batchInsertReceipts(
  receipts: PixelReceiptData[]
): Promise<BatchResult> {
  if (receipts.length === 0) {
    return { success: true, processed: 0, failed: 0, errors: [] };
  }
  const errors: Array<{ id: string; error: string }> = [];
  let processed = 0;
  const now = new Date();
  const db = getDb();
  try {
    await db.$transaction(async (tx) => {
      const upsertResults = await Promise.allSettled(
        receipts.map((receipt) => {
          const platform = receipt.platform ?? "unknown";
          return tx.pixelEventReceipt.upsert({
            where: {
              shopId_eventId_eventType_platform: {
                shopId: receipt.shopId,
                eventId: receipt.eventId,
                eventType: receipt.eventType,
                platform,
              },
            },
            create: {
              id: randomUUID(),
              shopId: receipt.shopId,
              eventId: receipt.eventId,
              eventType: receipt.eventType,
              platform,
              originHost: receipt.originHost,
              pixelTimestamp: receipt.pixelTimestamp ?? now,
              payloadJson: toInputJsonValue(receipt.capiInput),
              orderKey: receipt.orderId,
            },
            update: {
              originHost: receipt.originHost,
              orderKey: receipt.orderId,
            },
          });
        })
      );
      upsertResults.forEach((result, index) => {
        if (index >= receipts.length || index >= upsertResults.length) {
          logger.error('Index out of bounds: arrays length mismatch', { 
            index, 
            receiptsLength: receipts.length,
            upsertResultsLength: upsertResults.length 
          });
          return;
        }
        const receipt = receipts[index];
        if (result.status === 'fulfilled') {
          processed++;
        } else {
          const errMsg =
            result.reason instanceof Error ? result.reason.message : String(result.reason);
          errors.push({ id: `${receipt.shopId}:${receipt.orderId}`, error: errMsg });
        }
      });
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Batch insert receipts transaction failed', { error: errorMsg, count: receipts.length });
    const allErrors = errors.length > 0 
      ? errors 
      : receipts.map((r) => ({ id: `${r.shopId}:${r.orderId}`, error: `Transaction failed: ${errorMsg}` }));
    return {
      success: false,
      processed: 0, 
      failed: receipts.length, 
      errors: allErrors,
    };
  }
  return {
    success: errors.length === 0,
    processed,
    failed: errors.length,
    errors,
  };
}

export async function batchUpdateShops(
  updates: Array<{
    shopId: string;
    data: Partial<{
      consentStrategy: string;
      isActive: boolean;
    }>;
  }>
): Promise<BatchResult> {
  if (updates.length === 0) {
    return { success: true, processed: 0, failed: 0, errors: [] };
  }
  const errors: Array<{ id: string; error: string }> = [];
  let processed = 0;
  const db = getDb();
  try {
    await db.$transaction(async (tx) => {
      const updateResults = await Promise.allSettled(
        updates.map(({ shopId, data }) =>
          tx.shop.update({
            where: { id: shopId },
            data,
          })
        )
      );
      updateResults.forEach((result, index) => {
        if (index >= updates.length || index >= updateResults.length) {
          logger.error('Index out of bounds: arrays length mismatch', { 
            index, 
            updatesLength: updates.length,
            updateResultsLength: updateResults.length 
          });
          return;
        }
        const { shopId } = updates[index];
        if (result.status === 'fulfilled') {
          processed++;
        } else {
          const errorMsg =
            result.reason instanceof Error ? result.reason.message : String(result.reason);
          logger.warn('Failed to update shop', { shopId, error: errorMsg });
          errors.push({ id: shopId, error: errorMsg });
        }
      });
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Batch update shops transaction failed', { error: errorMsg, count: updates.length });
    const remainingErrors = updates
      .slice(processed)
      .map((u) => ({ id: u.shopId, error: `Transaction failed: ${errorMsg}` }));
    return {
      success: false,
      processed,
      failed: updates.length - processed,
      errors: [...errors, ...remainingErrors],
    };
  }
  return {
    success: true,
    processed,
    failed: errors.length,
    errors,
  };
}

export async function batchCreateAuditLogs(
  entries: Array<{
    shopId: string;
    action: string;
    actor?: string;
    details?: Prisma.JsonValue;
  }>
): Promise<BatchResult> {
  if (entries.length === 0) {
    return { success: true, processed: 0, failed: 0, errors: [] };
  }
  const db = getDb();
  try {
    const result = await db.auditLog.createMany({
      data: entries.map((entry) => ({
        id: randomUUID(),
        shopId: entry.shopId,
        action: entry.action,
        actorType: "system",
        actorId: entry.actor || "system",
        resourceType: "conversion_job",
        metadata: toInputJsonValue(entry.details),
      })),
      skipDuplicates: true,
    });
    return {
      success: true,
      processed: result.count,
      failed: 0,
      errors: [],
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Batch create audit logs failed', { error: errorMsg, count: entries.length });
    return {
      success: false,
      processed: 0,
      failed: entries.length,
      errors: [{ id: 'batch', error: errorMsg }],
    };
  }
}

export async function executeInTransaction<T>(
  operations: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<{ success: true; result: T } | { success: false; error: string }> {
  const db = getDb();
  try {
    const result = await db.$transaction(operations);
    return { success: true, result };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error("Transaction execution failed", { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

export async function processInChunks<T, R>(
  items: T[],
  chunkSize: number,
  processor: (chunk: T[]) => Promise<BatchResult<R>>
): Promise<BatchResult<R>> {
  const allResults: R[] = [];
  const allErrors: Array<{ id: string; error: string }> = [];
  let totalProcessed = 0;
  let totalFailed = 0;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const result = await processor(chunk);
    totalProcessed += result.processed;
    totalFailed += result.failed;
    allErrors.push(...result.errors);
    if (result.results) {
      allResults.push(...result.results);
    }
    if (i + chunkSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  return {
    success: allErrors.length === 0,
    processed: totalProcessed,
    failed: totalFailed,
    errors: allErrors,
    results: allResults.length > 0 ? allResults : undefined,
  };
}
