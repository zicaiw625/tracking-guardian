/**
 * GDPR Service Type Definitions
 *
 * Strict types for GDPR webhook payloads and processing results.
 * These replace the inline interface definitions and provide better type safety.
 */

import { z } from "zod";

// =============================================================================
// GDPR Job Types
// =============================================================================

/**
 * GDPR job types as defined by Shopify
 */
export const GDPRJobTypeValues = ["data_request", "customer_redact", "shop_redact"] as const;
export type GDPRJobType = (typeof GDPRJobTypeValues)[number];

/**
 * GDPR job status
 */
export const GDPRJobStatusValues = ["queued", "processing", "completed", "failed"] as const;
export type GDPRJobStatus = (typeof GDPRJobStatusValues)[number];

// =============================================================================
// Webhook Payload Schemas
// =============================================================================

/**
 * Data request payload from Shopify GDPR webhook
 */
export const DataRequestPayloadSchema = z.object({
  shop_id: z.number().optional(),
  shop_domain: z.string().optional(),
  orders_requested: z.array(z.number()).optional().default([]),
  customer_id: z.number().optional(),
  data_request_id: z.number().optional(),
});

export type DataRequestPayload = z.infer<typeof DataRequestPayloadSchema>;

/**
 * Customer redact payload from Shopify GDPR webhook
 */
export const CustomerRedactPayloadSchema = z.object({
  shop_id: z.number().optional(),
  shop_domain: z.string().optional(),
  customer_id: z.number().optional(),
  orders_to_redact: z.array(z.number()).optional().default([]),
});

export type CustomerRedactPayload = z.infer<typeof CustomerRedactPayloadSchema>;

/**
 * Shop redact payload from Shopify GDPR webhook
 */
export const ShopRedactPayloadSchema = z.object({
  shop_id: z.number().optional(),
  shop_domain: z.string().optional(),
});

export type ShopRedactPayload = z.infer<typeof ShopRedactPayloadSchema>;

/**
 * Union of all GDPR payload types
 */
export type GDPRPayload = DataRequestPayload | CustomerRedactPayload | ShopRedactPayload;

// =============================================================================
// Result Types
// =============================================================================

/**
 * Exported conversion log for data request responses
 */
export interface ExportedConversionLog {
  orderId: string;
  orderNumber: string | null;
  orderValue: number;
  currency: string;
  platform: string;
  eventType: string;
  status: string;
  clientSideSent: boolean;
  serverSideSent: boolean;
  createdAt: string;
  sentAt: string | null;
}

/**
 * Exported survey response for data request responses
 */
export interface ExportedSurveyResponse {
  orderId: string;
  orderNumber: string | null;
  rating: number | null;
  source: string | null;
  feedback: string | null;
  createdAt: string;
}

/**
 * Exported pixel event receipt for data request responses
 */
export interface ExportedPixelEventReceipt {
  orderId: string;
  eventType: string;
  eventId: string | null;
  consentState: {
    marketing?: boolean;
    analytics?: boolean;
  } | null;
  isTrusted: boolean;
  pixelTimestamp: string | null;
  createdAt: string;
}

/**
 * Data located summary for data request results
 */
export interface DataLocatedSummary {
  conversionLogs: {
    count: number;
    recordIds: string[];
  };
  surveyResponses: {
    count: number;
    recordIds: string[];
  };
  pixelEventReceipts: {
    count: number;
    recordIds: string[];
  };
}

/**
 * Data request result
 */
export interface DataRequestResult {
  dataRequestId?: number;
  customerId?: number;
  ordersIncluded: number[];
  dataLocated: DataLocatedSummary;
  exportedData: {
    conversionLogs: ExportedConversionLog[];
    surveyResponses: ExportedSurveyResponse[];
    pixelEventReceipts: ExportedPixelEventReceipt[];
  };
  exportedAt: string;
  exportFormat: "json";
  exportVersion: "1.0";
}

/**
 * Customer redact deletion counts
 */
export interface CustomerRedactDeletionCounts {
  conversionLogs: number;
  conversionJobs: number;
  pixelEventReceipts: number;
  surveyResponses: number;
}

/**
 * Customer redact result
 */
export interface CustomerRedactResult {
  customerId?: number;
  ordersRedacted: number[];
  deletedCounts: CustomerRedactDeletionCounts;
}

/**
 * Shop redact deletion counts
 */
export interface ShopRedactDeletionCounts {
  sessions: number;
  conversionLogs: number;
  conversionJobs: number;
  pixelEventReceipts: number;
  surveyResponses: number;
  auditLogs: number;
  webhookLogs: number;
  scanReports: number;
  reconciliationReports: number;
  alertConfigs: number;
  pixelConfigs: number;
  monthlyUsages: number;
  shop: number;
}

/**
 * Shop redact result
 */
export interface ShopRedactResult {
  shopDomain: string;
  deletedCounts: ShopRedactDeletionCounts;
}

/**
 * Union of all GDPR result types
 */
export type GDPRJobResult = DataRequestResult | CustomerRedactResult | ShopRedactResult;

// =============================================================================
// Processing Types
// =============================================================================

/**
 * Result of processing a single GDPR job
 */
export interface ProcessGDPRJobResult {
  success: boolean;
  result?: GDPRJobResult;
  error?: string;
}

/**
 * Result of processing multiple GDPR jobs
 */
export interface ProcessGDPRJobsResult {
  processed: number;
  succeeded: number;
  failed: number;
}

/**
 * GDPR job status summary
 */
export interface GDPRJobStatusSummary {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  recentJobs: Array<{
    id: string;
    shopDomain: string;
    jobType: string;
    status: string;
    createdAt: Date;
    completedAt: Date | null;
  }>;
}

/**
 * GDPR compliance check result
 */
export interface GDPRComplianceResult {
  isCompliant: boolean;
  pendingCount: number;
  overdueCount: number;
  oldestPendingAge: number | null;
  warnings: string[];
  criticals: string[];
}

/**
 * GDPR deletion summary for reporting
 */
export interface GDPRDeletionSummary {
  totalJobsCompleted: number;
  byJobType: Record<string, number>;
  totalRecordsDeleted: number;
  deletionsByTable: Record<string, number>;
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a result is a DataRequestResult
 */
export function isDataRequestResult(result: GDPRJobResult): result is DataRequestResult {
  return "ordersIncluded" in result && "exportedData" in result;
}

/**
 * Check if a result is a CustomerRedactResult
 */
export function isCustomerRedactResult(result: GDPRJobResult): result is CustomerRedactResult {
  return "ordersRedacted" in result && !("shopDomain" in result);
}

/**
 * Check if a result is a ShopRedactResult
 */
export function isShopRedactResult(result: GDPRJobResult): result is ShopRedactResult {
  return "shopDomain" in result && "deletedCounts" in result && "sessions" in (result as ShopRedactResult).deletedCounts;
}

// =============================================================================
// Payload Parsing
// =============================================================================

/**
 * Parse and validate a data request payload
 */
export function parseDataRequestPayload(payload: unknown): DataRequestPayload {
  return DataRequestPayloadSchema.parse(payload);
}

/**
 * Parse and validate a customer redact payload
 */
export function parseCustomerRedactPayload(payload: unknown): CustomerRedactPayload {
  return CustomerRedactPayloadSchema.parse(payload);
}

/**
 * Parse and validate a shop redact payload
 */
export function parseShopRedactPayload(payload: unknown): ShopRedactPayload {
  return ShopRedactPayloadSchema.parse(payload);
}

/**
 * Safely parse a GDPR payload based on job type
 */
export function parseGDPRPayload(jobType: GDPRJobType, payload: unknown): GDPRPayload {
  switch (jobType) {
    case "data_request":
      return parseDataRequestPayload(payload);
    case "customer_redact":
      return parseCustomerRedactPayload(payload);
    case "shop_redact":
      return parseShopRedactPayload(payload);
  }
}

// =============================================================================
// Empty Results Factory
// =============================================================================

/**
 * Create an empty data request result for cases where no data exists
 */
export function createEmptyDataRequestResult(
  dataRequestId?: number,
  customerId?: number
): DataRequestResult {
  return {
    dataRequestId,
    customerId,
    ordersIncluded: [],
    dataLocated: {
      conversionLogs: { count: 0, recordIds: [] },
      surveyResponses: { count: 0, recordIds: [] },
      pixelEventReceipts: { count: 0, recordIds: [] },
    },
    exportedData: {
      conversionLogs: [],
      surveyResponses: [],
      pixelEventReceipts: [],
    },
    exportedAt: new Date().toISOString(),
    exportFormat: "json",
    exportVersion: "1.0",
  };
}

/**
 * Create an empty customer redact result
 */
export function createEmptyCustomerRedactResult(customerId?: number): CustomerRedactResult {
  return {
    customerId,
    ordersRedacted: [],
    deletedCounts: {
      conversionLogs: 0,
      conversionJobs: 0,
      pixelEventReceipts: 0,
      surveyResponses: 0,
    },
  };
}

/**
 * Create initial shop redact deletion counts
 */
export function createEmptyShopRedactDeletionCounts(): ShopRedactDeletionCounts {
  return {
    sessions: 0,
    conversionLogs: 0,
    conversionJobs: 0,
    pixelEventReceipts: 0,
    surveyResponses: 0,
    auditLogs: 0,
    webhookLogs: 0,
    scanReports: 0,
    reconciliationReports: 0,
    alertConfigs: 0,
    pixelConfigs: 0,
    monthlyUsages: 0,
    shop: 0,
  };
}

