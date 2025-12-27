

import type { AsyncResult } from "../../types/result";
import type { AppError } from "../../utils/errors";
import type {
  ConversionJob,
  JobStatus,
  ConsentEvidence,
  TrustMetadata,
  PlatformResultStatus,
  CapiInput,
} from "./conversion.entity";

export interface QueryPendingJobsOptions {

  limit?: number;

  includeRetrying?: boolean;

  shopId?: string;
}

export interface QueryByStatusOptions {
  status: JobStatus | JobStatus[];
  limit?: number;
  offset?: number;
  shopId?: string;
  orderBy?: "createdAt" | "nextRetryAt";
  orderDirection?: "asc" | "desc";
}

export interface JobStatusUpdate {
  status: JobStatus;
  attempts?: number;
  lastAttemptAt?: Date;
  nextRetryAt?: Date | null;
  errorMessage?: string | null;
  platformResults?: Record<string, PlatformResultStatus>;
  consentEvidence?: ConsentEvidence;
  trustMetadata?: TrustMetadata;
  processedAt?: Date;
  completedAt?: Date;
}

export interface CreateJobData {
  shopId: string;
  orderId: string;
  orderNumber?: string | null;
  orderValue: number;
  currency?: string;
  capiInput?: CapiInput | null;
}

export interface BatchUpdateResult {
  updated: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
}

export interface IConversionJobRepository {

  findById(id: string): AsyncResult<ConversionJob | null, AppError>;

  findByShopAndOrder(shopId: string, orderId: string): AsyncResult<ConversionJob | null, AppError>;

  create(data: CreateJobData): AsyncResult<ConversionJob, AppError>;

  update(id: string, data: JobStatusUpdate): AsyncResult<ConversionJob, AppError>;

  exists(shopId: string, orderId: string): AsyncResult<boolean, AppError>;

  claimForProcessing(limit: number): AsyncResult<string[], AppError>;

  fetchForProcessing(ids: string[]): AsyncResult<ConversionJob[], AppError>;

  getPending(options?: QueryPendingJobsOptions): AsyncResult<ConversionJob[], AppError>;

  getByStatus(options: QueryByStatusOptions): AsyncResult<ConversionJob[], AppError>;

  getDeadLetter(shopId?: string, limit?: number): AsyncResult<ConversionJob[], AppError>;

  countByStatus(shopId?: string): AsyncResult<Record<JobStatus, number>, AppError>;

  batchUpdate(updates: Array<{ id: string; data: JobStatusUpdate }>): AsyncResult<BatchUpdateResult, AppError>;

  requeueDeadLetter(jobIds: string[]): AsyncResult<number, AppError>;

  cleanupOld(olderThan: Date): AsyncResult<number, AppError>;
}

export interface JobEvent {
  readonly jobId: string;
  readonly shopId: string;
  readonly orderId: string;
  readonly occurredAt: Date;
}

export interface JobCreatedEvent extends JobEvent {
  readonly type: "job_created";
  readonly orderValue: number;
  readonly currency: string;
}

export interface JobCompletedEvent extends JobEvent {
  readonly type: "job_completed";
  readonly platformResults: Record<string, PlatformResultStatus>;
  readonly duration: number;
}

export interface JobFailedEvent extends JobEvent {
  readonly type: "job_failed";
  readonly error: string;
  readonly attempt: number;
  readonly willRetry: boolean;
}

export interface JobDeadLetteredEvent extends JobEvent {
  readonly type: "job_dead_lettered";
  readonly finalError: string;
  readonly totalAttempts: number;
}

export type ConversionJobEvent =
  | JobCreatedEvent
  | JobCompletedEvent
  | JobFailedEvent
  | JobDeadLetteredEvent;

