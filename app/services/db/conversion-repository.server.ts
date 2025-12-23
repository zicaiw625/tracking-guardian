/**
 * Conversion Job Repository
 * 
 * Centralized data access layer for ConversionJob entities.
 * Provides query optimization, batch operations, and transaction support.
 */

import prisma from "../../db.server";
import { Prisma } from "@prisma/client";
import type { ConversionJob } from "@prisma/client";
import { JobStatus } from "../../types";
import { toInputJsonValue } from "../../utils/prisma-json";

// =============================================================================
// Types
// =============================================================================

/**
 * Fields needed for job processing.
 */
export interface JobForProcessing {
  id: string;
  shopId: string;
  orderId: string;
  orderNumber: string | null;
  orderValue: Prisma.Decimal;
  currency: string;
  capiInput: Prisma.JsonValue;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
}

/**
 * Options for querying pending jobs.
 */
export interface QueryPendingJobsOptions {
  /** Maximum number of jobs to fetch */
  limit?: number;
  /** Maximum age of jobs to consider */
  maxAgeMs?: number;
  /** Include failed jobs ready for retry */
  includeRetries?: boolean;
}

/**
 * Job status update data.
 */
export interface JobStatusUpdate {
  status: string;
  attempts?: number;
  lastAttemptAt?: Date;
  nextRetryAt?: Date;
  processedAt?: Date;
  completedAt?: Date;
  errorMessage?: string | null;
  platformResults?: Prisma.JsonValue;
  trustMetadata?: Prisma.JsonValue;
  consentEvidence?: Prisma.JsonValue;
}

// =============================================================================
// Select Fields
// =============================================================================

const JOB_FOR_PROCESSING_SELECT = {
  id: true,
  shopId: true,
  orderId: true,
  orderNumber: true,
  orderValue: true,
  currency: true,
  capiInput: true,
  attempts: true,
  maxAttempts: true,
  createdAt: true,
} as const;

const JOB_WITH_SHOP_SELECT = {
  ...JOB_FOR_PROCESSING_SELECT,
  shop: {
    select: {
      id: true,
      shopDomain: true,
      plan: true,
      consentStrategy: true,
      piiEnabled: true,
      isActive: true,
      primaryDomain: true,
      storefrontDomains: true,
      pixelConfigs: {
        where: { isActive: true },
      },
    },
  },
} as const;

// =============================================================================
// Repository Functions
// =============================================================================

// Type for the shop data included with jobs
// This matches what Prisma returns from JOB_WITH_SHOP_SELECT
interface JobShopData {
  id: string;
  shopDomain: string;
  plan: string | null;
  consentStrategy: string;
  piiEnabled: boolean;
  isActive: boolean;
  primaryDomain: string | null;
  storefrontDomains: Prisma.JsonValue;
  pixelConfigs: Array<{
    id: string;
    platform: string;
    platformId: string | null;
    credentials: Prisma.JsonValue;
    credentialsEncrypted: string | null;
    clientConfig: Prisma.JsonValue;
    isActive: boolean;
    clientSideEnabled: boolean;
    serverSideEnabled: boolean;
    eventMappings: Prisma.JsonValue;
    migrationStatus: string;
    migratedAt: Date | null;
    shopId: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

/**
 * Get pending jobs ready for processing.
 * Includes both new jobs and failed jobs ready for retry.
 */
export async function getPendingJobs(
  options: QueryPendingJobsOptions = {}
): Promise<Array<JobForProcessing & { shop: JobShopData }>> {
  const {
    limit = 100,
    maxAgeMs = 24 * 60 * 60 * 1000, // 24 hours
    includeRetries = true,
  } = options;

  const now = new Date();
  const minCreatedAt = new Date(now.getTime() - maxAgeMs);

  const whereConditions: Prisma.ConversionJobWhereInput[] = [
    // New jobs waiting to be processed
    { status: JobStatus.QUEUED },
    { status: JobStatus.PROCESSING }, // Stuck processing
  ];

  if (includeRetries) {
    // Failed jobs ready for retry
    whereConditions.push({
      status: JobStatus.FAILED,
      nextRetryAt: { lte: now },
    });
  }

  const jobs = await prisma.conversionJob.findMany({
    where: {
      createdAt: { gte: minCreatedAt },
      OR: whereConditions,
    },
    select: JOB_WITH_SHOP_SELECT,
    orderBy: [
      { attempts: 'asc' }, // Prioritize fresh jobs
      { createdAt: 'asc' }, // Then by age
    ],
    take: limit,
  });

  return jobs as Array<JobForProcessing & { shop: JobShopData }>;
}

/**
 * Claim jobs for processing (atomic update to prevent double processing).
 */
export async function claimJobsForProcessing(
  jobIds: string[],
  processedBy?: string
): Promise<number> {
  if (jobIds.length === 0) return 0;

  const result = await prisma.conversionJob.updateMany({
    where: {
      id: { in: jobIds },
      status: { in: [JobStatus.QUEUED, JobStatus.FAILED] },
    },
    data: {
      status: JobStatus.PROCESSING,
      lastAttemptAt: new Date(),
      ...(processedBy && { processedBy }),
    },
  });

  return result.count;
}

/**
 * Update job status with all related fields.
 */
export async function updateJobStatus(
  jobId: string,
  update: JobStatusUpdate
): Promise<void> {
  await prisma.conversionJob.update({
    where: { id: jobId },
    data: {
      status: update.status,
      attempts: update.attempts,
      lastAttemptAt: update.lastAttemptAt,
      nextRetryAt: update.nextRetryAt,
      processedAt: update.processedAt,
      completedAt: update.completedAt,
      errorMessage: update.errorMessage,
      platformResults: toInputJsonValue(update.platformResults),
      trustMetadata: toInputJsonValue(update.trustMetadata),
      consentEvidence: toInputJsonValue(update.consentEvidence),
    },
  });
}

/**
 * Batch update multiple jobs with the same status.
 */
export async function batchUpdateJobStatus(
  jobIds: string[],
  update: JobStatusUpdate
): Promise<number> {
  if (jobIds.length === 0) return 0;

  const result = await prisma.conversionJob.updateMany({
    where: { id: { in: jobIds } },
    data: {
      status: update.status,
      attempts: update.attempts,
      lastAttemptAt: update.lastAttemptAt,
      nextRetryAt: update.nextRetryAt,
      processedAt: update.processedAt,
      completedAt: update.completedAt,
      errorMessage: update.errorMessage,
      platformResults: toInputJsonValue(update.platformResults),
      trustMetadata: toInputJsonValue(update.trustMetadata),
      consentEvidence: toInputJsonValue(update.consentEvidence),
    },
  });

  return result.count;
}

/**
 * Create a new conversion job.
 */
export async function createConversionJob(data: {
  shopId: string;
  orderId: string;
  orderNumber?: string | null;
  orderValue: number;
  currency: string;
  capiInput?: Prisma.JsonValue;
}): Promise<ConversionJob> {
  return prisma.conversionJob.create({
    data: {
      shopId: data.shopId,
      orderId: data.orderId,
      orderNumber: data.orderNumber,
      orderValue: data.orderValue,
      currency: data.currency,
      capiInput: toInputJsonValue(data.capiInput) ?? {},
      status: JobStatus.QUEUED,
      attempts: 0,
      maxAttempts: 3,
    },
  });
}

/**
 * Check if a job already exists (for idempotency).
 */
export async function jobExistsForOrder(
  shopId: string,
  orderId: string
): Promise<boolean> {
  const existing = await prisma.conversionJob.findFirst({
    where: {
      shopId,
      orderId,
    },
    select: { id: true },
  });

  return existing !== null;
}

/**
 * Get job counts by status for monitoring.
 */
export async function getJobCountsByStatus(
  shopId?: string,
  sinceDate?: Date
): Promise<Record<string, number>> {
  const where: Prisma.ConversionJobWhereInput = {};
  
  if (shopId) {
    where.shopId = shopId;
  }
  
  if (sinceDate) {
    where.createdAt = { gte: sinceDate };
  }

  const results = await prisma.conversionJob.groupBy({
    by: ['status'],
    where,
    _count: { status: true },
  });

  return Object.fromEntries(
    results.map(r => [r.status, r._count.status])
  );
}

/**
 * Get dead letter jobs for review.
 */
export async function getDeadLetterJobs(
  options: {
    limit?: number;
    offset?: number;
    shopId?: string;
  } = {}
): Promise<ConversionJob[]> {
  const { limit = 50, offset = 0, shopId } = options;

  return prisma.conversionJob.findMany({
    where: {
      status: JobStatus.DEAD_LETTER,
      ...(shopId && { shopId }),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });
}

/**
 * Requeue dead letter jobs for retry.
 */
export async function requeueDeadLetterJobs(
  jobIds: string[]
): Promise<number> {
  if (jobIds.length === 0) return 0;

  const result = await prisma.conversionJob.updateMany({
    where: {
      id: { in: jobIds },
      status: JobStatus.DEAD_LETTER,
    },
    data: {
      status: JobStatus.QUEUED,
      attempts: 0,
      nextRetryAt: null,
      errorMessage: null,
    },
  });

  return result.count;
}

/**
 * Clean up old completed jobs (data retention).
 */
export async function cleanupOldJobs(
  retentionDays: number = 90
): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const result = await prisma.conversionJob.deleteMany({
    where: {
      status: { in: [JobStatus.COMPLETED, JobStatus.LIMIT_EXCEEDED] },
      completedAt: { lt: cutoffDate },
    },
  });

  return result.count;
}

