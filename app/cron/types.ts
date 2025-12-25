/**
 * Cron Service Type Definitions
 *
 * Types for cron job execution, results, and cleanup operations.
 */

// =============================================================================
// Cron Task Results
// =============================================================================

/**
 * Result of cleanup operations for a shop
 */
export interface CleanupResult {
  shopsProcessed: number;
  conversionLogsDeleted: number;
  surveyResponsesDeleted: number;
  auditLogsDeleted: number;
  conversionJobsDeleted: number;
  pixelEventReceiptsDeleted: number;
  webhookLogsDeleted: number;
  scanReportsDeleted: number;
  reconciliationReportsDeleted: number;
  gdprJobsDeleted: number;
  eventNoncesDeleted: number;
}

/**
 * Result of shop status refresh operation
 */
export interface ShopStatusRefreshResult {
  shopsProcessed: number;
  tierUpdates: number;
  typOspUpdates: number;
  typOspUnknown: number;
  typOspUnknownReasons: Record<string, number>;
  errors: number;
}

/**
 * Individual delivery health check result
 */
export interface DeliveryHealthCheckItem {
  shopDomain: string;
  success: boolean;
  error?: string;
}

/**
 * Result of delivery health check
 */
export interface DeliveryHealthResult {
  successful: number;
  failed: number;
  results: DeliveryHealthCheckItem[];
}

/**
 * Result of reconciliation task
 */
export interface ReconciliationTaskResult {
  processed: number;
  succeeded: number;
  failed: number;
  reportsGenerated: number;
}

/**
 * GDPR job processing result
 */
export interface GDPRProcessingResult {
  processed: number;
  succeeded: number;
  failed: number;
}

/**
 * GDPR compliance check result
 */
export interface GDPRComplianceCheckResult {
  isCompliant: boolean;
  pendingCount: number;
  overdueCount: number;
  oldestPendingAge: number | null;
  warnings: string[];
  criticals: string[];
}

/**
 * Consent reconciliation result
 */
export interface ConsentReconciliationResult {
  processed: number;
  matched: number;
  unmatched: number;
}

/**
 * Conversion job processing result
 */
export interface ConversionJobResult {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  limitExceeded: number;
}

/**
 * Pending conversion processing result
 */
export interface PendingConversionResult {
  processed: number;
  succeeded: number;
  failed: number;
  limitExceeded: number;
}

/**
 * Retry processing result
 */
export interface RetryProcessingResult {
  processed: number;
  succeeded: number;
  failed: number;
  limitExceeded: number;
}

/**
 * Combined result of all cron tasks
 */
export interface CronResult {
  gdpr: GDPRProcessingResult;
  gdprCompliance: GDPRComplianceCheckResult;
  consent: ConsentReconciliationResult;
  jobs: ConversionJobResult;
  pending: PendingConversionResult;
  retries: RetryProcessingResult;
  deliveryHealth: DeliveryHealthResult;
  reconciliation: ReconciliationTaskResult;
  cleanup: CleanupResult;
  shopStatusRefresh?: ShopStatusRefreshResult;
}

// =============================================================================
// Cron Response Types
// =============================================================================

/**
 * Base cron response fields
 */
interface CronResponseBase {
  requestId: string;
  durationMs: number;
}

/**
 * Successful cron execution response
 */
export interface CronSuccessResponse extends CronResponseBase, CronResult {
  success: true;
  message: string;
}

/**
 * Skipped cron execution response (lock held by another instance)
 */
export interface CronSkippedResponse extends CronResponseBase {
  success: true;
  skipped: true;
  message: string;
  reason?: string;
}

/**
 * Failed cron execution response
 */
export interface CronErrorResponse extends CronResponseBase {
  success: false;
  error: string;
}

/**
 * Union of all cron response types
 */
export type CronResponse = CronSuccessResponse | CronSkippedResponse | CronErrorResponse;

// =============================================================================
// Cron Authentication Types
// =============================================================================

/**
 * Result of cron replay protection verification
 */
export interface ReplayProtectionResult {
  valid: boolean;
  error?: string;
}

/**
 * HTTP methods supported for cron endpoint
 */
export type CronHttpMethod = "POST" | "GET";

// =============================================================================
// Batch Delete Types
// =============================================================================

/**
 * Record with ID for batch delete operations
 */
export interface DeletableRecord {
  id: string;
}

/**
 * Result of a batch delete operation
 */
export interface BatchDeleteResult {
  count: number;
}

/**
 * Shop data for cleanup operations
 */
export interface CleanupShopData {
  id: string;
  shopDomain: string;
  dataRetentionDays: number | null;
}

/**
 * Shop group organized by retention days
 */
export interface ShopRetentionGroup {
  id: string;
  shopDomain: string;
}

// =============================================================================
// Logger Types
// =============================================================================

/**
 * Cron logger interface (subset of RequestLogger)
 */
export interface CronLogger {
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, error?: unknown, metadata?: Record<string, unknown>): void;
  debug(message: string, metadata?: Record<string, unknown>): void;
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a cron response is a success response
 */
export function isCronSuccess(response: CronResponse): response is CronSuccessResponse {
  return response.success === true && !("skipped" in response);
}

/**
 * Check if a cron response is a skipped response
 */
export function isCronSkipped(response: CronResponse): response is CronSkippedResponse {
  return response.success === true && "skipped" in response && response.skipped === true;
}

/**
 * Check if a cron response is an error response
 */
export function isCronError(response: CronResponse): response is CronErrorResponse {
  return response.success === false;
}

