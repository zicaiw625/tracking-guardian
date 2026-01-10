import { logger } from "../../utils/logger.server";
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
  logger.debug(`getPendingJobs called but conversionJob table no longer exists`, { options });
  return [];
}

export async function claimJobsForProcessing(
  jobIds: string[],
  processedBy?: string
): Promise<number> {
  logger.debug(`claimJobsForProcessing called but conversionJob table no longer exists`, { jobIds, processedBy });
  return 0;
}

export async function updateJobStatus(
  jobId: string,
  update: JobStatusUpdate
): Promise<void> {
  logger.debug(`updateJobStatus called but conversionJob table no longer exists`, { jobId, update });
}

export async function batchUpdateJobStatus(
  jobIds: string[],
  update: JobStatusUpdate
): Promise<number> {
  logger.debug(`batchUpdateJobStatus called but conversionJob table no longer exists`, { jobIds, update });
  return 0;
}

export async function createConversionJob(data: {
  shopId: string;
  orderId: string;
  orderNumber?: string | null;
  orderValue: number;
  currency: string;
  capiInput?: Prisma.JsonValue;
}): Promise<ConversionJob> {
  logger.debug(`createConversionJob called but conversionJob table no longer exists`, { data });
  throw new Error("conversionJob table no longer exists");
}

export async function jobExistsForOrder(
  shopId: string,
  orderId: string
): Promise<boolean> {
  logger.debug(`jobExistsForOrder called but conversionJob table no longer exists`, { shopId, orderId });
  return false;
}

export async function getJobCountsByStatus(
  shopId?: string,
  sinceDate?: Date
): Promise<Record<string, number>> {
  logger.debug(`getJobCountsByStatus called but conversionJob table no longer exists`, { shopId, sinceDate });
  return {};
}

export async function getDeadLetterJobs(
  options: {
    limit?: number;
    offset?: number;
    shopId?: string;
  } = {}
): Promise<ConversionJob[]> {
  logger.debug(`getDeadLetterJobs called but conversionJob table no longer exists`, { options });
  return [];
}

export async function requeueDeadLetterJobs(
  jobIds: string[]
): Promise<number> {
  logger.debug(`requeueDeadLetterJobs called but conversionJob table no longer exists`, { jobIds });
  return 0;
}

export async function cleanupOldJobs(
  retentionDays: number = 90
): Promise<number> {
  logger.debug(`cleanupOldJobs called but conversionJob table no longer exists`, { retentionDays });
  return 0;
}
