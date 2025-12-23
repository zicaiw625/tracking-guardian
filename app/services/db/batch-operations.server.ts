/**
 * Batch Operations Service
 * 
 * Provides transaction-safe batch operations for database writes.
 * Optimizes performance by grouping multiple operations into single transactions.
 */

import prisma from "../../db.server";
import { Prisma } from "@prisma/client";
import { JobStatus } from "../../types";
import { logger } from "../../utils/logger.server";
import { toInputJsonValue } from "../../utils/prisma-json";

// =============================================================================
// Types
// =============================================================================

/**
 * Job completion result for batch processing.
 */
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

/**
 * Pixel event receipt data for batch insert.
 */
export interface PixelReceiptData {
  shopId: string;
  orderId: string;
  eventType: string;
  checkoutToken?: string | null;
  consentState?: Prisma.JsonValue;
  originHost?: string | null;
  signatureStatus: string;
  trustLevel: string;
  pixelTimestamp?: Date;
  capiInput?: Prisma.JsonValue;
}

/**
 * Batch operation result.
 */
export interface BatchResult<T = unknown> {
  success: boolean;
  processed: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
  results?: T[];
}

// =============================================================================
// Batch Operations
// =============================================================================

/**
 * Batch complete multiple conversion jobs in a single transaction.
 * Updates job status and increments usage counters atomically.
 */
export async function batchCompleteJobs(
  completions: JobCompletionData[]
): Promise<BatchResult> {
  if (completions.length === 0) {
    return { success: true, processed: 0, failed: 0, errors: [] };
  }

  const now = new Date();
  const errors: Array<{ id: string; error: string }> = [];
  let processed = 0;

  // Group by status for efficient updates
  const completed = completions.filter(c => c.status === 'completed');
  const failed = completions.filter(c => c.status === 'failed');
  const limitExceeded = completions.filter(c => c.status === 'limit_exceeded');
  const deadLetter = completions.filter(c => c.status === 'dead_letter');

  try {
    await prisma.$transaction(async (tx) => {
      // Update completed jobs
      for (const job of completed) {
        await tx.conversionJob.update({
          where: { id: job.jobId },
          data: {
            status: JobStatus.COMPLETED,
            processedAt: now,
            completedAt: now,
            lastAttemptAt: now,
            platformResults: toInputJsonValue(job.platformResults),
            trustMetadata: toInputJsonValue(job.trustMetadata),
            consentEvidence: toInputJsonValue(job.consentEvidence),
            errorMessage: null,
          },
        });
        processed++;
      }

      // Note: Monthly usage is tracked via MonthlyUsage model, not a Shop field
      // Usage increment happens in billing.server.ts via incrementMonthlyUsage

      // Update failed jobs
      for (const job of failed) {
        await tx.conversionJob.update({
          where: { id: job.jobId },
          data: {
            status: JobStatus.FAILED,
            lastAttemptAt: now,
            nextRetryAt: job.nextRetryAt,
            platformResults: toInputJsonValue(job.platformResults),
            errorMessage: job.errorMessage,
          },
        });
        processed++;
      }

      // Update limit exceeded jobs
      for (const job of limitExceeded) {
        await tx.conversionJob.update({
          where: { id: job.jobId },
          data: {
            status: JobStatus.LIMIT_EXCEEDED,
            lastAttemptAt: now,
            errorMessage: job.errorMessage,
          },
        });
        processed++;
      }

      // Update dead letter jobs
      for (const job of deadLetter) {
        await tx.conversionJob.update({
          where: { id: job.jobId },
          data: {
            status: JobStatus.DEAD_LETTER,
            lastAttemptAt: now,
            platformResults: toInputJsonValue(job.platformResults),
            errorMessage: job.errorMessage,
          },
        });
        processed++;
      }
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Batch complete jobs failed', { error: errorMsg, count: completions.length });
    
    // Mark all as errors
    for (const job of completions) {
      errors.push({ id: job.jobId, error: errorMsg });
    }
    
    return {
      success: false,
      processed: 0,
      failed: completions.length,
      errors,
    };
  }

  return {
    success: true,
    processed,
    failed: errors.length,
    errors,
  };
}

/**
 * Batch insert pixel event receipts.
 * Uses upsert to handle duplicates gracefully.
 */
export async function batchInsertReceipts(
  receipts: PixelReceiptData[]
): Promise<BatchResult> {
  if (receipts.length === 0) {
    return { success: true, processed: 0, failed: 0, errors: [] };
  }

  const errors: Array<{ id: string; error: string }> = [];
  let processed = 0;
  const now = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      for (const receipt of receipts) {
        try {
          await tx.pixelEventReceipt.upsert({
            where: {
              shopId_orderId_eventType: {
                shopId: receipt.shopId,
                orderId: receipt.orderId,
                eventType: receipt.eventType,
              },
            },
            create: {
              shopId: receipt.shopId,
              orderId: receipt.orderId,
              eventType: receipt.eventType,
              checkoutToken: receipt.checkoutToken,
              consentState: toInputJsonValue(receipt.consentState),
              originHost: receipt.originHost,
              signatureStatus: receipt.signatureStatus,
              trustLevel: receipt.trustLevel,
              pixelTimestamp: receipt.pixelTimestamp ?? now,
              isTrusted: receipt.trustLevel === 'trusted',
              metadata: toInputJsonValue(receipt.capiInput),
            },
            update: {
              // Update if newer data arrives
              consentState: toInputJsonValue(receipt.consentState),
              trustLevel: receipt.trustLevel,
              signatureStatus: receipt.signatureStatus,
            },
          });
          processed++;
        } catch (receiptError) {
          const errMsg = receiptError instanceof Error ? receiptError.message : String(receiptError);
          errors.push({ id: `${receipt.shopId}:${receipt.orderId}`, error: errMsg });
        }
      }
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Batch insert receipts failed', { error: errorMsg, count: receipts.length });
    
    return {
      success: false,
      processed: 0,
      failed: receipts.length,
      errors: [{ id: 'transaction', error: errorMsg }],
    };
  }

  return {
    success: errors.length === 0,
    processed,
    failed: errors.length,
    errors,
  };
}

/**
 * Batch update shop configurations.
 * Useful for bulk settings changes.
 */
export async function batchUpdateShops(
  updates: Array<{
    shopId: string;
    data: Partial<{
      consentStrategy: string;
      piiEnabled: boolean;
      isActive: boolean;
    }>;
  }>
): Promise<BatchResult> {
  if (updates.length === 0) {
    return { success: true, processed: 0, failed: 0, errors: [] };
  }

  const errors: Array<{ id: string; error: string }> = [];
  let processed = 0;

  try {
    await prisma.$transaction(async (tx) => {
      for (const { shopId, data } of updates) {
        await tx.shop.update({
          where: { id: shopId },
          data,
        });
        processed++;
      }
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Batch update shops failed', { error: errorMsg, count: updates.length });
    
    return {
      success: false,
      processed: 0,
      failed: updates.length,
      errors: [{ id: 'transaction', error: errorMsg }],
    };
  }

  return {
    success: true,
    processed,
    failed: 0,
    errors,
  };
}

/**
 * Batch create audit log entries.
 */
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

  try {
    const result = await prisma.auditLog.createMany({
      data: entries.map(entry => ({
        shopId: entry.shopId,
        action: entry.action,
        actorType: 'system',
        actorId: entry.actor || 'system',
        resourceType: 'conversion_job',
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

/**
 * Execute multiple operations in a single transaction.
 * Provides flexibility for complex batch operations.
 */
export async function executeInTransaction<T>(
  operations: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<{ success: true; result: T } | { success: false; error: string }> {
  try {
    const result = await prisma.$transaction(operations);
    return { success: true, result };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Transaction execution failed', { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

/**
 * Chunked batch processing for very large datasets.
 * Processes items in chunks to avoid memory issues and long-running transactions.
 */
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

    // Small delay between chunks to reduce database pressure
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

