import { logger } from "../../utils/logger.server";
import { Prisma } from "@prisma/client";
import type { ConversionJob } from "@prisma/client";
import { JobStatus } from "../../types";
import { toInputJsonValue } from "../../utils/prisma-json";
import prisma from "../../db.server";
import { generateSimpleId } from "../../utils/helpers";

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
  const limit = options.limit || 10;
  const where: Prisma.ConversionJobWhereInput = {
    status: {
      in: [JobStatus.QUEUED, JobStatus.PROCESSING],
    },
  };
  if (options.maxAgeMs) {
    const maxAge = new Date(Date.now() - options.maxAgeMs);
    where.createdAt = { gte: maxAge };
  }
  const jobs = await prisma.conversionJob.findMany({
    where,
    take: limit,
    orderBy: { createdAt: "asc" },
    include: {
      Shop: {
        select: {
          id: true,
          shopDomain: true,
          plan: true,
          consentStrategy: true,
          isActive: true,
          primaryDomain: true,
          storefrontDomains: true,
          pixelConfigs: {
            select: {
              id: true,
              platform: true,
              platformId: true,
              credentials_legacy: true,
              credentialsEncrypted: true,
              clientConfig: true,
              isActive: true,
              clientSideEnabled: true,
              serverSideEnabled: true,
              eventMappings: true,
              migrationStatus: true,
              migratedAt: true,
              shopId: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      },
    },
  });
  return jobs.map(job => ({
    id: job.id,
    shopId: job.shopId,
    orderId: job.orderId,
    orderNumber: job.orderNumber,
    orderValue: job.orderValue,
    currency: job.currency,
    capiInput: job.capiInput,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    createdAt: job.createdAt,
    shop: {
      id: job.Shop.id,
      shopDomain: job.Shop.shopDomain,
      plan: job.Shop.plan,
      consentStrategy: job.Shop.consentStrategy,
      isActive: job.Shop.isActive,
      primaryDomain: job.Shop.primaryDomain,
      storefrontDomains: job.Shop.storefrontDomains,
      pixelConfigs: job.Shop.pixelConfigs,
    },
  }));
}

export async function claimJobsForProcessing(
  jobIds: string[],
  processedBy?: string
): Promise<number> {
  if (jobIds.length === 0) return 0;
  const result = await prisma.conversionJob.updateMany({
    where: {
      id: { in: jobIds },
      status: JobStatus.QUEUED,
    },
    data: {
      status: JobStatus.PROCESSING,
      processedAt: new Date(),
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
      platformResults: update.platformResults ? toInputJsonValue(update.platformResults) : undefined,
      trustMetadata: update.trustMetadata ? toInputJsonValue(update.trustMetadata) : undefined,
      consentEvidence: update.consentEvidence ? toInputJsonValue(update.consentEvidence) : undefined,
    },
  });
}

export async function batchUpdateJobStatus(
  jobIds: string[],
  update: JobStatusUpdate
): Promise<number> {
  if (jobIds.length === 0) return 0;
  const data: Prisma.ConversionJobUpdateInput = {
    status: update.status,
  };
  if (update.attempts !== undefined) data.attempts = update.attempts;
  if (update.lastAttemptAt !== undefined) data.lastAttemptAt = update.lastAttemptAt;
  if (update.nextRetryAt !== undefined) data.nextRetryAt = update.nextRetryAt;
  if (update.processedAt !== undefined) data.processedAt = update.processedAt;
  if (update.completedAt !== undefined) data.completedAt = update.completedAt;
  if (update.errorMessage !== undefined) data.errorMessage = update.errorMessage;
  if (update.platformResults !== undefined) data.platformResults = toInputJsonValue(update.platformResults);
  if (update.trustMetadata !== undefined) data.trustMetadata = toInputJsonValue(update.trustMetadata);
  if (update.consentEvidence !== undefined) data.consentEvidence = toInputJsonValue(update.consentEvidence);
  const result = await prisma.conversionJob.updateMany({
    where: { id: { in: jobIds } },
    data,
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
  return await prisma.conversionJob.upsert({
    where: {
      shopId_orderId: {
        shopId: data.shopId,
        orderId: data.orderId,
      },
    },
    create: {
      id: generateSimpleId("job"),
      shopId: data.shopId,
      orderId: data.orderId,
      orderNumber: data.orderNumber,
      orderValue: data.orderValue,
      currency: data.currency,
      capiInput: data.capiInput ? toInputJsonValue(data.capiInput) : null,
      status: JobStatus.QUEUED,
    },
    update: {
      orderValue: data.orderValue,
      currency: data.currency,
      capiInput: data.capiInput ? toInputJsonValue(data.capiInput) : undefined,
    },
  });
}

export async function jobExistsForOrder(
  shopId: string,
  orderId: string
): Promise<boolean> {
  const job = await prisma.conversionJob.findUnique({
    where: {
      shopId_orderId: {
        shopId,
        orderId,
      },
    },
    select: { id: true },
  });
  return !!job;
}

export async function getJobCountsByStatus(
  shopId?: string,
  sinceDate?: Date
): Promise<Record<string, number>> {
  const where: Prisma.ConversionJobWhereInput = {};
  if (shopId) where.shopId = shopId;
  if (sinceDate) where.createdAt = { gte: sinceDate };
  const jobs = await prisma.conversionJob.groupBy({
    by: ["status"],
    where,
    _count: true,
  });
  const counts: Record<string, number> = {};
  for (const group of jobs) {
    counts[group.status] = group._count;
  }
  return counts;
}

export async function getDeadLetterJobs(
  options: {
    limit?: number;
    offset?: number;
    shopId?: string;
  } = {}
): Promise<ConversionJob[]> {
  const where: Prisma.ConversionJobWhereInput = {
    status: JobStatus.FAILED,
  };
  if (options.shopId) where.shopId = options.shopId;
  const jobs = await prisma.conversionJob.findMany({
    where,
    take: options.limit || 50,
    skip: options.offset || 0,
    orderBy: { createdAt: "desc" },
  });
  return jobs.filter(job => job.attempts >= job.maxAttempts);
}

export async function requeueDeadLetterJobs(
  jobIds: string[]
): Promise<number> {
  if (jobIds.length === 0) return 0;
  const result = await prisma.conversionJob.updateMany({
    where: {
      id: { in: jobIds },
      status: JobStatus.FAILED,
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
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  const result = await prisma.conversionJob.deleteMany({
    where: {
      createdAt: { lt: cutoffDate },
      status: {
        in: [JobStatus.COMPLETED, JobStatus.FAILED],
      },
    },
  });
  return result.count;
}
