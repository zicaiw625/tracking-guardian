

export type JobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "limit_exceeded"
  | "dead_letter";

export type PlatformResultStatus =
  | "sent"
  | "failed"
  | "skipped"
  | "pending";

export interface ConsentState {
  marketing: boolean;
  analytics: boolean;
}

export interface TrustResult {
  level: "trusted" | "partial" | "untrusted" | "unknown";
  reason?: string;
  verifiedAt?: Date;
}

export interface ConsentEvidence {
  strategy: string;
  usedConsent: ConsentState | null;
  hasReceipt: boolean;
  receiptTrusted: boolean;
  reason?: string;
}

export interface TrustMetadata {
  trustLevel: string;
  reason?: string;
  verifiedAt?: string;
}

export interface LineItem {
  productId: string;
  variantId?: string;
  name: string;
  quantity: number;
  price: number;
}

export interface ConversionJob {
  readonly id: string;
  readonly shopId: string;

  readonly orderId: string;
  readonly orderNumber: string | null;
  readonly orderValue: number;
  readonly currency: string;

  readonly capiInput: CapiInput | null;

  readonly consentEvidence: ConsentEvidence | null;
  readonly trustMetadata: TrustMetadata | null;

  readonly status: JobStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly lastAttemptAt: Date | null;
  readonly nextRetryAt: Date | null;
  readonly errorMessage: string | null;

  readonly platformResults: Record<string, PlatformResultStatus> | null;

  readonly createdAt: Date;
  readonly processedAt: Date | null;
  readonly completedAt: Date | null;
}

export interface CapiInput {
  value: number;
  currency: string;
  orderId: string;
  checkoutToken?: string;
  items?: LineItem[];

}

export interface JobWithShop extends ConversionJob {
  readonly shop: {
    shopDomain: string;
    plan: string;

    consentStrategy: string;
  };
}

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

export function canRetry(job: ConversionJob): boolean {
  if (job.status === "completed" || job.status === "dead_letter" || job.status === "limit_exceeded") {
    return false;
  }
  return job.attempts < job.maxAttempts;
}

export function isExhausted(job: ConversionJob): boolean {
  return job.attempts >= job.maxAttempts;
}

export function isTerminal(job: ConversionJob): boolean {
  return (
    job.status === "completed" ||
    job.status === "dead_letter" ||
    job.status === "limit_exceeded"
  );
}

export function isReady(job: ConversionJob): boolean {
  if (job.status !== "queued" && job.status !== "failed") {
    return false;
  }
  if (job.status === "failed" && job.nextRetryAt) {
    return new Date() >= job.nextRetryAt;
  }
  return true;
}

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

export function getJobAge(job: ConversionJob): number {
  return Date.now() - job.createdAt.getTime();
}

export function allPlatformsSucceeded(job: ConversionJob): boolean {
  if (!job.platformResults) return false;
  return Object.values(job.platformResults).every(
    (status) => status === "sent" || status === "skipped"
  );
}

export function anyPlatformSucceeded(job: ConversionJob): boolean {
  if (!job.platformResults) return false;
  return Object.values(job.platformResults).some((status) => status === "sent");
}

export function getFailedPlatforms(job: ConversionJob): string[] {
  if (!job.platformResults) return [];
  return Object.entries(job.platformResults)
    .filter(([, status]) => status === "failed")
    .map(([platform]) => platform);
}

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

export function isValidPlatformResultStatus(value: unknown): value is PlatformResultStatus {
  return (
    value === "sent" ||
    value === "failed" ||
    value === "skipped" ||
    value === "pending"
  );
}

