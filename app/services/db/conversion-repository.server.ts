import { randomUUID } from "crypto";
import prisma from "../../db.server";
import { Prisma } from "@prisma/client";
import type { ConversionJob } from "@prisma/client";
import { JobStatus } from "../../types";
import { toInputJsonValue } from "../../utils/prisma-json";

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

export interface QueryPendingJobsOptions {
  limit?: number;
  maxAgeMs?: number;
  includeRetries?: boolean;
}

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
      isActive: true,
      primaryDomain: true,
      storefrontDomains: true,
      pixelConfigs: {
        where: { isActive: true },
      },
    },
  },
} as const;

interface JobShopData {
  id: string;
  shopDomain: string;
  plan: string | null;
  consentStrategy: string;
  isActive: boolean;
  primaryDomain: string | null;
  storefrontDomains: Prisma.JsonValue;
  pixelConfigs: Array<{
    id: string;
    platform: string;
    platformId: string | null;
    credentials_legacy: Prisma.JsonValue | null;
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

export async function getPendingJobs(
  options: QueryPendingJobsOptions = {}
): Promise<Array<JobForProcessing & { shop: JobShopData }>> {
  const {
    limit = 100,
    maxAgeMs = 24 * 60 * 60 * 1000,
    includeRetries = true,
  } = options;
  const now = new Date();
  const minCreatedAt = new Date(now.getTime() - maxAgeMs);
  const whereConditions: Prisma.ConversionJobWhereInput[] = [
    { status: JobStatus.QUEUED },
    { status: JobStatus.PROCESSING },
  ];
  if (includeRetries) {
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
      { attempts: 'asc' },
      { createdAt: 'asc' },
    ],
    take: limit,
  });
  return jobs as Array<JobForProcessing & { shop: JobShopData }>;
}

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
      id: randomUUID(),
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

export async function cleanupOldJobs(
  retentionDays: number = 90
): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - retentionDays);
  const result = await prisma.conversionJob.deleteMany({
    where: {
      status: { in: [JobStatus.COMPLETED, JobStatus.LIMIT_EXCEEDED] },
      completedAt: { lt: cutoffDate },
    },
  });
  return result.count;
}
