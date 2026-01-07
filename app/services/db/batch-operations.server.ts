

import { randomUUID } from "crypto";
import { getDb } from "../../container";
import { Prisma } from "@prisma/client";
import { JobStatus } from "../../types";
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

export interface BatchResult<T = unknown> {
  success: boolean;
  processed: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
  results?: T[];
}

export async function batchCompleteJobs(
  completions: JobCompletionData[]
): Promise<BatchResult> {
  if (completions.length === 0) {
    return { success: true, processed: 0, failed: 0, errors: [] };
  }

  const now = new Date();
  const errors: Array<{ id: string; error: string }> = [];
  let processed = 0;

  const completed = completions.filter(c => c.status === 'completed');
  const failed = completions.filter(c => c.status === 'failed');
  const limitExceeded = completions.filter(c => c.status === 'limit_exceeded');
  const deadLetter = completions.filter(c => c.status === 'dead_letter');

  const db = getDb();

  try {
    await db.$transaction(async (tx) => {

      if (completed.length > 0) {
        const completedIds = completed.map((j) => j.jobId);

        await tx.conversionJob.updateMany({
          where: { id: { in: completedIds } },
          data: {
            status: JobStatus.COMPLETED,
            processedAt: now,
            completedAt: now,
            lastAttemptAt: now,
            errorMessage: null,
          },
        });

        const updateResults = await Promise.allSettled(
          completed.map((job) =>
            tx.conversionJob.update({
              where: { id: job.jobId },
              data: {
                platformResults: toInputJsonValue(job.platformResults),
                trustMetadata: toInputJsonValue(job.trustMetadata),
                consentEvidence: toInputJsonValue(job.consentEvidence),
              },
            })
          )
        );

        updateResults.forEach((result, index) => {
          if (result.status === 'rejected') {
            const job = completed[index];
            const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
            logger.warn('Failed to update job details', { jobId: job.jobId, error: errorMsg });
            errors.push({ id: job.jobId, error: `Failed to update details: ${errorMsg}` });
          }
        });

        processed += completed.length;
      }

      if (failed.length > 0) {

        const updateResults = await Promise.allSettled(
          failed.map((job) =>
            tx.conversionJob.update({
              where: { id: job.jobId },
              data: {
                status: JobStatus.FAILED,
                lastAttemptAt: now,
                nextRetryAt: job.nextRetryAt,
                platformResults: toInputJsonValue(job.platformResults),
                errorMessage: job.errorMessage,
              },
            })
          )
        );

        updateResults.forEach((result, index) => {
          if (result.status === 'rejected') {
            const job = failed[index];
            const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
            logger.warn('Failed to update failed job', { jobId: job.jobId, error: errorMsg });
            errors.push({ id: job.jobId, error: `Failed to update: ${errorMsg}` });
          }
        });

        processed += failed.length;
      }

      if (limitExceeded.length > 0) {
        const limitExceededIds = limitExceeded.map((j) => j.jobId);
        await tx.conversionJob.updateMany({
          where: { id: { in: limitExceededIds } },
          data: {
            status: JobStatus.LIMIT_EXCEEDED,
            lastAttemptAt: now,
          },
        });

        const limitExceededWithErrors = limitExceeded.filter((j) => j.errorMessage);
        if (limitExceededWithErrors.length > 0) {

          const updateResults = await Promise.allSettled(
            limitExceededWithErrors.map((job) =>
              tx.conversionJob.update({
                where: { id: job.jobId },
                data: { errorMessage: job.errorMessage },
              })
            )
          );

          updateResults.forEach((result, index) => {
            if (result.status === 'rejected') {
              const job = limitExceededWithErrors[index];
              const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
              logger.warn('Failed to update limit exceeded job error message', { jobId: job.jobId, error: errorMsg });
              errors.push({ id: job.jobId, error: `Failed to update error message: ${errorMsg}` });
            }
          });
        }
        processed += limitExceeded.length;
      }

      if (deadLetter.length > 0) {
        const deadLetterIds = deadLetter.map((j) => j.jobId);
        await tx.conversionJob.updateMany({
          where: { id: { in: deadLetterIds } },
          data: {
            status: JobStatus.DEAD_LETTER,
            lastAttemptAt: now,
          },
        });

        const updateResults = await Promise.allSettled(
          deadLetter.map((job) =>
            tx.conversionJob.update({
              where: { id: job.jobId },
              data: {
                platformResults: toInputJsonValue(job.platformResults),
                errorMessage: job.errorMessage,
              },
            })
          )
        );

        updateResults.forEach((result, index) => {
          if (result.status === 'rejected') {
            const job = deadLetter[index];
            const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
            logger.warn('Failed to update dead letter job', { jobId: job.jobId, error: errorMsg });
            errors.push({ id: job.jobId, error: `Failed to update: ${errorMsg}` });
          }
        });
        processed += deadLetter.length;
      }
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Batch complete jobs failed', { error: errorMsg, count: completions.length });

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
              id: randomUUID(),
              shopId: receipt.shopId,
              orderId: receipt.orderId,
              eventType: receipt.eventType,
              checkoutToken: receipt.checkoutToken,
              consentState: toInputJsonValue(receipt.consentState),
              originHost: receipt.originHost,
              signatureStatus: receipt.signatureStatus,
              trustLevel: receipt.trustLevel,
              pixelTimestamp: receipt.pixelTimestamp ?? now,
              isTrusted: receipt.trustLevel === "trusted",
              metadata: toInputJsonValue(receipt.capiInput),
            },
            update: {

              consentState: toInputJsonValue(receipt.consentState),
              trustLevel: receipt.trustLevel,
              signatureStatus: receipt.signatureStatus,
            },
          });
          processed++;
        } catch (receiptError) {
          const errMsg =
            receiptError instanceof Error ? receiptError.message : String(receiptError);
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

