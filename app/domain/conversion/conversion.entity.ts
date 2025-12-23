/**
 * Conversion Domain Entity
 *
 * Represents conversion jobs and their lifecycle in the domain layer.
 */

// =============================================================================
// Value Objects
// =============================================================================

/**
 * Conversion job status
 */
export type JobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "limit_exceeded"
  | "dead_letter";

/**
 * Platform send result status
 */
export type PlatformResultStatus =
  | "sent"
  | "failed"
  | "skipped"
  | "pending";

/**
 * Consent state
 */
export interface ConsentState {
  marketing: boolean;
  analytics: boolean;
}

/**
 * Trust verification result
 */
export interface TrustResult {
  level: "trusted" | "partial" | "untrusted" | "unknown";
  reason?: string;
  verifiedAt?: Date;
}

/**
 * Consent evidence for audit trail
 */
export interface ConsentEvidence {
  strategy: string;
  usedConsent: ConsentState | null;
  hasReceipt: boolean;
  receiptTrusted: boolean;
  reason?: string;
}

/**
 * Trust metadata for audit trail
 */
export interface TrustMetadata {
  trustLevel: string;
  reason?: string;
  verifiedAt?: string;
}

/**
 * Line item in an order
 */
export interface LineItem {
  productId: string;
  variantId?: string;
  name: string;
  quantity: number;
  price: number;
}

// =============================================================================
// Conversion Job Entity
// =============================================================================

/**
 * Conversion job entity
 *
 * Represents an order that needs to be sent to ad platforms.
 */
export interface ConversionJob {
  readonly id: string;
  readonly shopId: string;
  
  // Order data
  readonly orderId: string;
  readonly orderNumber: string | null;
  readonly orderValue: number;
  readonly currency: string;
  
  // CAPI input
  readonly capiInput: CapiInput | null;
  
  // Consent and trust
  readonly consentEvidence: ConsentEvidence | null;
  readonly trustMetadata: TrustMetadata | null;
  
  // Job status
  readonly status: JobStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly lastAttemptAt: Date | null;
  readonly nextRetryAt: Date | null;
  readonly errorMessage: string | null;
  
  // Platform results
  readonly platformResults: Record<string, PlatformResultStatus> | null;
  
  // Timestamps
  readonly createdAt: Date;
  readonly processedAt: Date | null;
  readonly completedAt: Date | null;
}

/**
 * Minimal CAPI input data
 */
export interface CapiInput {
  value: number;
  currency: string;
  orderId: string;
  checkoutToken?: string;
  items?: LineItem[];
  hashedIdentifiers?: HashedIdentifiers;
}

/**
 * Hashed PII for ad platform matching
 */
export interface HashedIdentifiers {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  state?: string;
  country?: string;
  zip?: string;
}

/**
 * Job with shop context
 */
export interface JobWithShop extends ConversionJob {
  readonly shop: {
    shopDomain: string;
    plan: string;
    piiEnabled: boolean;
    consentStrategy: string;
  };
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new conversion job
 */
export function createConversionJob(params: {
  id: string;
  shopId: string;
  orderId: string;
  orderNumber?: string | null;
  orderValue: number;
  currency?: string;
  capiInput?: CapiInput | null;
}): ConversionJob {
  return {
    id: params.id,
    shopId: params.shopId,
    orderId: params.orderId,
    orderNumber: params.orderNumber ?? null,
    orderValue: params.orderValue,
    currency: params.currency ?? "USD",
    capiInput: params.capiInput ?? null,
    consentEvidence: null,
    trustMetadata: null,
    status: "queued",
    attempts: 0,
    maxAttempts: 5,
    lastAttemptAt: null,
    nextRetryAt: null,
    errorMessage: null,
    platformResults: null,
    createdAt: new Date(),
    processedAt: null,
    completedAt: null,
  };
}

// =============================================================================
// Domain Logic
// =============================================================================

/**
 * Check if job can be retried
 */
export function canRetry(job: ConversionJob): boolean {
  if (job.status === "completed" || job.status === "dead_letter" || job.status === "limit_exceeded") {
    return false;
  }
  return job.attempts < job.maxAttempts;
}

/**
 * Check if job has exhausted all retries
 */
export function isExhausted(job: ConversionJob): boolean {
  return job.attempts >= job.maxAttempts;
}

/**
 * Check if job is in a terminal state
 */
export function isTerminal(job: ConversionJob): boolean {
  return (
    job.status === "completed" ||
    job.status === "dead_letter" ||
    job.status === "limit_exceeded"
  );
}

/**
 * Check if job is ready for processing
 */
export function isReady(job: ConversionJob): boolean {
  if (job.status !== "queued" && job.status !== "failed") {
    return false;
  }
  if (job.status === "failed" && job.nextRetryAt) {
    return new Date() >= job.nextRetryAt;
  }
  return true;
}

/**
 * Calculate next retry time with exponential backoff
 */
export function calculateNextRetryTime(
  attempts: number,
  baseDelayMs: number = 60000,
  maxDelayMs: number = 7200000
): Date {
  const delayMs = Math.min(
    baseDelayMs * Math.pow(5, attempts - 1),
    maxDelayMs
  );
  const jitter = delayMs * 0.1 * Math.random();
  return new Date(Date.now() + delayMs + jitter);
}

/**
 * Get the duration since job creation
 */
export function getJobAge(job: ConversionJob): number {
  return Date.now() - job.createdAt.getTime();
}

/**
 * Check if all platforms succeeded
 */
export function allPlatformsSucceeded(job: ConversionJob): boolean {
  if (!job.platformResults) return false;
  return Object.values(job.platformResults).every(
    (status) => status === "sent" || status === "skipped"
  );
}

/**
 * Check if any platform succeeded
 */
export function anyPlatformSucceeded(job: ConversionJob): boolean {
  if (!job.platformResults) return false;
  return Object.values(job.platformResults).some((status) => status === "sent");
}

/**
 * Get failed platforms
 */
export function getFailedPlatforms(job: ConversionJob): string[] {
  if (!job.platformResults) return [];
  return Object.entries(job.platformResults)
    .filter(([, status]) => status === "failed")
    .map(([platform]) => platform);
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if value is a valid job status
 */
export function isValidJobStatus(value: unknown): value is JobStatus {
  return (
    value === "queued" ||
    value === "processing" ||
    value === "completed" ||
    value === "failed" ||
    value === "limit_exceeded" ||
    value === "dead_letter"
  );
}

/**
 * Check if value is a valid platform result status
 */
export function isValidPlatformResultStatus(value: unknown): value is PlatformResultStatus {
  return (
    value === "sent" ||
    value === "failed" ||
    value === "skipped" ||
    value === "pending"
  );
}

