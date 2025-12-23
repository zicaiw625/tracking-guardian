/**
 * Conversion Job Repository Interface
 *
 * Defines the contract for conversion job data access.
 */

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

// =============================================================================
// Query Options
// =============================================================================

/**
 * Options for querying pending jobs
 */
export interface QueryPendingJobsOptions {
  /** Maximum number of jobs to return */
  limit?: number;
  /** Include jobs in retry state */
  includeRetrying?: boolean;
  /** Filter by shop ID */
  shopId?: string;
}

/**
 * Options for querying jobs by status
 */
export interface QueryByStatusOptions {
  status: JobStatus | JobStatus[];
  limit?: number;
  offset?: number;
  shopId?: string;
  orderBy?: "createdAt" | "nextRetryAt";
  orderDirection?: "asc" | "desc";
}

// =============================================================================
// Update Data Types
// =============================================================================

/**
 * Data for updating job status
 */
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

/**
 * Data for creating a conversion job
 */
export interface CreateJobData {
  shopId: string;
  orderId: string;
  orderNumber?: string | null;
  orderValue: number;
  currency?: string;
  capiInput?: CapiInput | null;
}

/**
 * Result of batch job update
 */
export interface BatchUpdateResult {
  updated: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
}

// =============================================================================
// Repository Interface
// =============================================================================

/**
 * Conversion job repository interface
 */
export interface IConversionJobRepository {
  // =========================================================================
  // Basic CRUD
  // =========================================================================

  /**
   * Find a job by ID
   */
  findById(id: string): AsyncResult<ConversionJob | null, AppError>;

  /**
   * Find a job by shop and order
   */
  findByShopAndOrder(shopId: string, orderId: string): AsyncResult<ConversionJob | null, AppError>;

  /**
   * Create a new job
   */
  create(data: CreateJobData): AsyncResult<ConversionJob, AppError>;

  /**
   * Update a job
   */
  update(id: string, data: JobStatusUpdate): AsyncResult<ConversionJob, AppError>;

  /**
   * Check if job exists
   */
  exists(shopId: string, orderId: string): AsyncResult<boolean, AppError>;

  // =========================================================================
  // Job Claiming (for worker processing)
  // =========================================================================

  /**
   * Claim jobs for processing atomically
   *
   * Uses SELECT FOR UPDATE SKIP LOCKED to ensure safe concurrent access.
   * Returns IDs of claimed jobs.
   */
  claimForProcessing(limit: number): AsyncResult<string[], AppError>;

  /**
   * Fetch jobs with relations for processing
   */
  fetchForProcessing(ids: string[]): AsyncResult<ConversionJob[], AppError>;

  // =========================================================================
  // Queries
  // =========================================================================

  /**
   * Get pending jobs (queued or retryable)
   */
  getPending(options?: QueryPendingJobsOptions): AsyncResult<ConversionJob[], AppError>;

  /**
   * Get jobs by status
   */
  getByStatus(options: QueryByStatusOptions): AsyncResult<ConversionJob[], AppError>;

  /**
   * Get dead letter jobs
   */
  getDeadLetter(shopId?: string, limit?: number): AsyncResult<ConversionJob[], AppError>;

  /**
   * Count jobs by status
   */
  countByStatus(shopId?: string): AsyncResult<Record<JobStatus, number>, AppError>;

  // =========================================================================
  // Batch Operations
  // =========================================================================

  /**
   * Batch update job statuses
   */
  batchUpdate(updates: Array<{ id: string; data: JobStatusUpdate }>): AsyncResult<BatchUpdateResult, AppError>;

  /**
   * Requeue dead letter jobs
   */
  requeueDeadLetter(jobIds: string[]): AsyncResult<number, AppError>;

  /**
   * Clean up old completed jobs
   */
  cleanupOld(olderThan: Date): AsyncResult<number, AppError>;
}

// =============================================================================
// Events
// =============================================================================

/**
 * Base job event
 */
export interface JobEvent {
  readonly jobId: string;
  readonly shopId: string;
  readonly orderId: string;
  readonly occurredAt: Date;
}

/**
 * Job created event
 */
export interface JobCreatedEvent extends JobEvent {
  readonly type: "job_created";
  readonly orderValue: number;
  readonly currency: string;
}

/**
 * Job completed event
 */
export interface JobCompletedEvent extends JobEvent {
  readonly type: "job_completed";
  readonly platformResults: Record<string, PlatformResultStatus>;
  readonly duration: number;
}

/**
 * Job failed event
 */
export interface JobFailedEvent extends JobEvent {
  readonly type: "job_failed";
  readonly error: string;
  readonly attempt: number;
  readonly willRetry: boolean;
}

/**
 * Job dead lettered event
 */
export interface JobDeadLetteredEvent extends JobEvent {
  readonly type: "job_dead_lettered";
  readonly finalError: string;
  readonly totalAttempts: number;
}

/**
 * All job events
 */
export type ConversionJobEvent =
  | JobCreatedEvent
  | JobCompletedEvent
  | JobFailedEvent
  | JobDeadLetteredEvent;

