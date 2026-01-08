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
  eventLogsDeleted: number;
  deliveryAttemptsDeleted: number;
  gdprJobsDeleted: number;
  eventNoncesDeleted: number;
  migrationDraftsDeleted: number;
}

export interface ShopStatusRefreshResult {
  shopsProcessed: number;
  tierUpdates: number;
  typOspUpdates: number;
  typOspUnknown: number;
  typOspUnknownReasons: Record<string, number>;
  errors: number;
}

export interface DeliveryHealthCheckItem {
  shopDomain: string;
  success: boolean;
  error?: string;
}

export interface DeliveryHealthResult {
  successful: number;
  failed: number;
  results: DeliveryHealthCheckItem[];
}

export interface ReconciliationTaskResult {
  processed: number;
  succeeded: number;
  failed: number;
  reportsGenerated: number;
}

export interface GDPRProcessingResult {
  processed: number;
  succeeded: number;
  failed: number;
}

export interface GDPRComplianceCheckResult {
  isCompliant: boolean;
  pendingCount: number;
  overdueCount: number;
  oldestPendingAge: number | null;
  warnings: string[];
  criticals: string[];
}

export interface ConsentReconciliationResult {
  processed: number;
  matched: number;
  unmatched: number;
}

export interface ConversionJobResult {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  limitExceeded: number;
}

export interface PendingConversionResult {
  processed: number;
  succeeded: number;
  failed: number;
  limitExceeded: number;
}

export interface RetryProcessingResult {
  processed: number;
  succeeded: number;
  failed: number;
  limitExceeded: number;
}

export interface AlertCheckResult {
  shopsChecked: number;
  triggered: number;
  sent: number;
}

export interface WebhookMonitorResult {
  checked: number;
  stuckFound: number;
  recovered: number;
  failed: number;
  oldestStuckAge: number | null;
}

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
  alerts?: AlertCheckResult;
  webhookMonitor?: WebhookMonitorResult;
  noncesCleanedUp?: number;
}

interface CronResponseBase {
  requestId: string;
  durationMs: number;
}

export interface CronSuccessResponse extends CronResponseBase, CronResult {
  success: true;
  message: string;
}

export interface CronSkippedResponse extends CronResponseBase {
  success: true;
  skipped: true;
  message: string;
  reason?: string;
}

export interface CronErrorResponse extends CronResponseBase {
  success: false;
  error: string;
}

export type CronResponse = CronSuccessResponse | CronSkippedResponse | CronErrorResponse;

export interface ReplayProtectionResult {
  valid: boolean;
  error?: string;
}

export type CronHttpMethod = "POST" | "GET";

export interface DeletableRecord {
  id: string;
}

export interface BatchDeleteResult {
  count: number;
}

export interface CleanupShopData {
  id: string;
  shopDomain: string;
  dataRetentionDays: number | null;
}

export interface ShopRetentionGroup {
  id: string;
  shopDomain: string;
}

export interface CronLogger {
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, error?: unknown, metadata?: Record<string, unknown>): void;
  debug(message: string, metadata?: Record<string, unknown>): void;
}

export function isCronSuccess(response: CronResponse): response is CronSuccessResponse {
  return response.success === true && !("skipped" in response);
}

export function isCronSkipped(response: CronResponse): response is CronSkippedResponse {
  return response.success === true && "skipped" in response && response.skipped === true;
}

export function isCronError(response: CronResponse): response is CronErrorResponse {
  return response.success === false;
}
