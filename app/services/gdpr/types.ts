

import { z } from "zod";

export const GDPRJobTypeValues = ["data_request", "customer_redact", "shop_redact"] as const;
export type GDPRJobType = (typeof GDPRJobTypeValues)[number];

export const GDPRJobStatusValues = ["queued", "processing", "completed", "failed"] as const;
export type GDPRJobStatus = (typeof GDPRJobStatusValues)[number];

export const DataRequestPayloadSchema = z.object({
  shop_id: z.number().optional(),
  shop_domain: z.string().optional(),
  orders_requested: z.array(z.number()).optional().default([]),
  customer_id: z.number().optional(),
  data_request_id: z.number().optional(),
});

export type DataRequestPayload = z.infer<typeof DataRequestPayloadSchema>;

export const CustomerRedactPayloadSchema = z.object({
  shop_id: z.number().optional(),
  shop_domain: z.string().optional(),
  customer_id: z.number().optional(),
  orders_to_redact: z.array(z.number()).optional().default([]),
});

export type CustomerRedactPayload = z.infer<typeof CustomerRedactPayloadSchema>;

export const ShopRedactPayloadSchema = z.object({
  shop_id: z.number().optional(),
  shop_domain: z.string().optional(),
});

export type ShopRedactPayload = z.infer<typeof ShopRedactPayloadSchema>;

export type GDPRPayload = DataRequestPayload | CustomerRedactPayload | ShopRedactPayload;

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

export interface ExportedSurveyResponse {
  orderId: string;
  orderNumber: string | null;
  rating: number | null;
  source: string | null;
  feedback: string | null;
  createdAt: string;
}

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

export interface CustomerRedactDeletionCounts {
  conversionLogs: number;
  conversionJobs: number;
  pixelEventReceipts: number;
  surveyResponses: number;
}

export interface CustomerRedactResult {
  customerId?: number;
  ordersRedacted: number[];
  deletedCounts: CustomerRedactDeletionCounts;
}

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

export interface ShopRedactResult {
  shopDomain: string;
  deletedCounts: ShopRedactDeletionCounts;
}

export type GDPRJobResult = DataRequestResult | CustomerRedactResult | ShopRedactResult;

export interface ProcessGDPRJobResult {
  success: boolean;
  result?: GDPRJobResult;
  error?: string;
}

export interface ProcessGDPRJobsResult {
  processed: number;
  succeeded: number;
  failed: number;
}

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

export interface GDPRComplianceResult {
  isCompliant: boolean;
  pendingCount: number;
  overdueCount: number;
  oldestPendingAge: number | null;
  warnings: string[];
  criticals: string[];
}

export interface GDPRDeletionSummary {
  totalJobsCompleted: number;
  byJobType: Record<string, number>;
  totalRecordsDeleted: number;
  deletionsByTable: Record<string, number>;
}

export function isDataRequestResult(result: GDPRJobResult): result is DataRequestResult {
  return "ordersIncluded" in result && "exportedData" in result;
}

export function isCustomerRedactResult(result: GDPRJobResult): result is CustomerRedactResult {
  return "ordersRedacted" in result && !("shopDomain" in result);
}

export function isShopRedactResult(result: GDPRJobResult): result is ShopRedactResult {
  return "shopDomain" in result && "deletedCounts" in result && "sessions" in (result as ShopRedactResult).deletedCounts;
}

export function parseDataRequestPayload(payload: unknown): DataRequestPayload {
  return DataRequestPayloadSchema.parse(payload);
}

export function parseCustomerRedactPayload(payload: unknown): CustomerRedactPayload {
  return CustomerRedactPayloadSchema.parse(payload);
}

export function parseShopRedactPayload(payload: unknown): ShopRedactPayload {
  return ShopRedactPayloadSchema.parse(payload);
}

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

