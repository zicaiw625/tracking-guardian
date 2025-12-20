/**
 * GDPR Job Processing Service
 * 
 * P0-01: Handles GDPR compliance webhooks from Shopify:
 * - CUSTOMERS_DATA_REQUEST: Export customer data within 30 days
 * - CUSTOMERS_REDACT: Delete customer data from specific orders
 * - SHOP_REDACT: Delete all shop data (48h after uninstall)
 * 
 * This service processes GDPRJob records created by webhooks.tsx
 * and performs the required data operations with:
 * - Idempotency (safe to re-run)
 * - Audit logging
 * - Complete data deletion for redact requests
 */

import prisma from "../db.server";
import { logger } from "../utils/logger";
import { createAuditLog } from "./audit.server";

// ==========================================
// Types
// ==========================================

/** GDPR job types matching webhook topics */
export type GDPRJobType = "data_request" | "customer_redact" | "shop_redact";

/** Data request payload from Shopify */
interface DataRequestPayload {
  shop_id?: number;
  shop_domain?: string;
  orders_requested?: number[];
  customer?: {
    id?: number;
    email?: string;
    phone?: string;
  };
  data_request?: {
    id?: number;
  };
}

/** Customer redact payload from Shopify */
interface CustomerRedactPayload {
  shop_id?: number;
  shop_domain?: string;
  customer?: {
    id?: number;
    email?: string;
    phone?: string;
  };
  orders_to_redact?: number[];
}

/** Shop redact payload from Shopify */
interface ShopRedactPayload {
  shop_id?: number;
  shop_domain?: string;
}

/** Result of processing a data request */
interface DataRequestResult {
  dataRequestId?: number;
  customerId?: number;
  ordersIncluded: number[];
  dataExported: {
    conversionLogs: number;
    surveyResponses: number;
    pixelEventReceipts: number;
  };
  exportedAt: string;
}

/** Result of processing a customer redact */
interface CustomerRedactResult {
  customerId?: number;
  ordersRedacted: number[];
  deletedCounts: {
    conversionLogs: number;
    conversionJobs: number;
    pixelEventReceipts: number;
    surveyResponses: number;
  };
}

/** Result of processing a shop redact */
interface ShopRedactResult {
  shopDomain: string;
  deletedCounts: {
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
  };
}

// ==========================================
// Data Request Processing
// ==========================================

/**
 * P0-01: Process a customer data request
 * 
 * Shopify sends this when a customer requests their data export.
 * We must respond within 30 days with what data we have.
 * 
 * Note: We store minimal customer data (mostly order IDs and conversion status).
 * Email/phone are NOT stored in our database (processed transiently or hashed).
 */
async function processDataRequest(
  shopDomain: string,
  payload: DataRequestPayload
): Promise<DataRequestResult> {
  const customerId = payload.customer?.id;
  const ordersRequested = payload.orders_requested || [];
  const dataRequestId = payload.data_request?.id;
  
  logger.info(`[GDPR] Processing data request for ${shopDomain}`, {
    dataRequestId,
    customerId,
    ordersCount: ordersRequested.length,
  });
  
  // Find the shop
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  
  if (!shop) {
    logger.warn(`[GDPR] Shop not found for data request: ${shopDomain}`);
    return {
      dataRequestId,
      customerId,
      ordersIncluded: [],
      dataExported: {
        conversionLogs: 0,
        surveyResponses: 0,
        pixelEventReceipts: 0,
      },
      exportedAt: new Date().toISOString(),
    };
  }
  
  // Convert order IDs to string format for matching
  const orderIdStrings = ordersRequested.map(id => String(id));
  
  // Find related conversion logs
  const conversionLogs = await prisma.conversionLog.findMany({
    where: {
      shopId: shop.id,
      orderId: { in: orderIdStrings },
    },
    select: {
      id: true,
      orderId: true,
      orderNumber: true,
      platform: true,
      eventType: true,
      status: true,
      createdAt: true,
      sentAt: true,
    },
  });
  
  // Find related survey responses
  const surveyResponses = await prisma.surveyResponse.findMany({
    where: {
      shopId: shop.id,
      orderId: { in: orderIdStrings },
    },
    select: {
      id: true,
      orderId: true,
      orderNumber: true,
      rating: true,
      source: true,
      createdAt: true,
      // Note: feedback may contain PII, include but consider privacy
    },
  });
  
  // Find related pixel event receipts
  const pixelReceipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId: shop.id,
      orderId: { in: orderIdStrings },
    },
    select: {
      id: true,
      orderId: true,
      eventType: true,
      consentState: true,
      createdAt: true,
    },
  });
  
  const result: DataRequestResult = {
    dataRequestId,
    customerId,
    ordersIncluded: ordersRequested,
    dataExported: {
      conversionLogs: conversionLogs.length,
      surveyResponses: surveyResponses.length,
      pixelEventReceipts: pixelReceipts.length,
    },
    exportedAt: new Date().toISOString(),
  };
  
  logger.info(`[GDPR] Data request completed for ${shopDomain}`, {
    dataRequestId,
    ...result.dataExported,
  });
  
  return result;
}

// ==========================================
// Customer Redact Processing
// ==========================================

/**
 * P0-01: Process a customer redact request
 * 
 * Shopify sends this when a store owner deletes a customer's data,
 * or a customer requests deletion under GDPR.
 * We must delete all data related to the specified orders.
 */
async function processCustomerRedact(
  shopDomain: string,
  payload: CustomerRedactPayload
): Promise<CustomerRedactResult> {
  const customerId = payload.customer?.id;
  const ordersToRedact = payload.orders_to_redact || [];
  
  logger.info(`[GDPR] Processing customer redact for ${shopDomain}`, {
    customerId,
    ordersCount: ordersToRedact.length,
  });
  
  // Find the shop
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  
  if (!shop) {
    logger.warn(`[GDPR] Shop not found for customer redact: ${shopDomain}`);
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
  
  // Convert order IDs to string format
  const orderIdStrings = ordersToRedact.map(id => String(id));
  
  // Delete conversion logs for these orders
  const conversionLogResult = await prisma.conversionLog.deleteMany({
    where: {
      shopId: shop.id,
      orderId: { in: orderIdStrings },
    },
  });
  
  // Delete conversion jobs for these orders
  const conversionJobResult = await prisma.conversionJob.deleteMany({
    where: {
      shopId: shop.id,
      orderId: { in: orderIdStrings },
    },
  });
  
  // Delete pixel event receipts for these orders
  const pixelReceiptResult = await prisma.pixelEventReceipt.deleteMany({
    where: {
      shopId: shop.id,
      orderId: { in: orderIdStrings },
    },
  });
  
  // Delete survey responses for these orders
  const surveyResult = await prisma.surveyResponse.deleteMany({
    where: {
      shopId: shop.id,
      orderId: { in: orderIdStrings },
    },
  });
  
  const result: CustomerRedactResult = {
    customerId,
    ordersRedacted: ordersToRedact,
    deletedCounts: {
      conversionLogs: conversionLogResult.count,
      conversionJobs: conversionJobResult.count,
      pixelEventReceipts: pixelReceiptResult.count,
      surveyResponses: surveyResult.count,
    },
  };
  
  logger.info(`[GDPR] Customer redact completed for ${shopDomain}`, {
    customerId,
    ...result.deletedCounts,
  });
  
  // Create audit log (will be deleted if shop_redact comes later)
  if (shop) {
    await createAuditLog({
      shopId: shop.id,
      actorType: "webhook",
      actorId: "gdpr_customer_redact",
      action: "gdpr_customer_redact",
      resourceType: "customer",
      resourceId: customerId ? String(customerId) : undefined,
      metadata: {
        ordersRedacted: ordersToRedact,
        deletedCounts: result.deletedCounts,
      },
    });
  }
  
  return result;
}

// ==========================================
// Shop Redact Processing
// ==========================================

/**
 * P0-01: Process a shop redact request
 * 
 * Shopify sends this 48 hours after app uninstall.
 * We MUST delete ALL data for this shop - this is mandatory.
 * 
 * This is independent of isActive status - we delete everything.
 */
async function processShopRedact(
  shopDomain: string,
  _payload: ShopRedactPayload
): Promise<ShopRedactResult> {
  logger.info(`[GDPR] Processing shop redact for ${shopDomain} - DELETING ALL DATA`);
  
  // Find the shop (may or may not exist)
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  
  const deletedCounts: ShopRedactResult["deletedCounts"] = {
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
  
  // Delete sessions (uses shop domain, not shopId)
  const sessionResult = await prisma.session.deleteMany({
    where: { shop: shopDomain },
  });
  deletedCounts.sessions = sessionResult.count;
  
  // Delete webhook logs (uses shopDomain)
  const webhookLogResult = await prisma.webhookLog.deleteMany({
    where: { shopDomain },
  });
  deletedCounts.webhookLogs = webhookLogResult.count;
  
  if (shop) {
    // Delete all shop-related data (order matters for foreign keys)
    
    // Delete conversion logs
    const conversionLogResult = await prisma.conversionLog.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.conversionLogs = conversionLogResult.count;
    
    // Delete conversion jobs
    const conversionJobResult = await prisma.conversionJob.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.conversionJobs = conversionJobResult.count;
    
    // Delete pixel event receipts
    const pixelReceiptResult = await prisma.pixelEventReceipt.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.pixelEventReceipts = pixelReceiptResult.count;
    
    // Delete survey responses
    const surveyResult = await prisma.surveyResponse.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.surveyResponses = surveyResult.count;
    
    // Delete audit logs
    const auditLogResult = await prisma.auditLog.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.auditLogs = auditLogResult.count;
    
    // Delete scan reports
    const scanReportResult = await prisma.scanReport.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.scanReports = scanReportResult.count;
    
    // Delete reconciliation reports
    const reconciliationResult = await prisma.reconciliationReport.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.reconciliationReports = reconciliationResult.count;
    
    // Delete alert configs
    const alertConfigResult = await prisma.alertConfig.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.alertConfigs = alertConfigResult.count;
    
    // Delete pixel configs
    const pixelConfigResult = await prisma.pixelConfig.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.pixelConfigs = pixelConfigResult.count;
    
    // Delete monthly usages
    const monthlyUsageResult = await prisma.monthlyUsage.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.monthlyUsages = monthlyUsageResult.count;
    
    // Finally, delete the shop record itself
    await prisma.shop.delete({
      where: { id: shop.id },
    });
    deletedCounts.shop = 1;
  }
  
  const result: ShopRedactResult = {
    shopDomain,
    deletedCounts,
  };
  
  logger.info(`[GDPR] Shop redact completed for ${shopDomain}`, deletedCounts);
  
  return result;
}

// ==========================================
// Job Processing
// ==========================================

/**
 * P0-01: Process a single GDPR job
 * 
 * This is called by the cron job to process queued GDPR jobs.
 * Jobs are idempotent - running the same job multiple times
 * will not cause issues (deletes are idempotent).
 */
export async function processGDPRJob(jobId: string): Promise<{
  success: boolean;
  result?: DataRequestResult | CustomerRedactResult | ShopRedactResult;
  error?: string;
}> {
  const job = await prisma.gDPRJob.findUnique({
    where: { id: jobId },
  });
  
  if (!job) {
    return { success: false, error: "Job not found" };
  }
  
  // Skip if already processed
  if (job.status === "completed") {
    logger.debug(`[GDPR] Job ${jobId} already completed, skipping`);
    return { success: true, result: job.result as DataRequestResult | CustomerRedactResult | ShopRedactResult };
  }
  
  // Mark as processing
  await prisma.gDPRJob.update({
    where: { id: jobId },
    data: { status: "processing" },
  });
  
  try {
    let result: DataRequestResult | CustomerRedactResult | ShopRedactResult;
    
    switch (job.jobType) {
      case "data_request":
        result = await processDataRequest(
          job.shopDomain,
          job.payload as DataRequestPayload
        );
        break;
        
      case "customer_redact":
        result = await processCustomerRedact(
          job.shopDomain,
          job.payload as CustomerRedactPayload
        );
        break;
        
      case "shop_redact":
        result = await processShopRedact(
          job.shopDomain,
          job.payload as ShopRedactPayload
        );
        break;
        
      default:
        throw new Error(`Unknown GDPR job type: ${job.jobType}`);
    }
    
    // Mark as completed
    await prisma.gDPRJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        result: result as object,
        processedAt: new Date(),
        completedAt: new Date(),
      },
    });
    
    logger.info(`[GDPR] Job ${jobId} completed successfully`, {
      jobType: job.jobType,
      shopDomain: job.shopDomain,
    });
    
    return { success: true, result };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    // Mark as failed
    await prisma.gDPRJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        errorMessage,
        processedAt: new Date(),
      },
    });
    
    logger.error(`[GDPR] Job ${jobId} failed: ${errorMessage}`, error);
    
    return { success: false, error: errorMessage };
  }
}

/**
 * P0-01: Process all pending GDPR jobs
 * 
 * Called by the cron job to process queued GDPR jobs.
 * Processes jobs in batches, oldest first.
 */
export async function processGDPRJobs(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  // Find pending jobs
  const pendingJobs = await prisma.gDPRJob.findMany({
    where: {
      status: { in: ["queued", "failed"] }, // Retry failed jobs too
    },
    orderBy: { createdAt: "asc" },
    take: 10, // Process in batches
  });
  
  if (pendingJobs.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }
  
  logger.info(`[GDPR] Processing ${pendingJobs.length} GDPR jobs`);
  
  let succeeded = 0;
  let failed = 0;
  
  for (const job of pendingJobs) {
    const result = await processGDPRJob(job.id);
    if (result.success) {
      succeeded++;
    } else {
      failed++;
    }
  }
  
  logger.info(`[GDPR] Processed ${pendingJobs.length} jobs: ${succeeded} succeeded, ${failed} failed`);
  
  return {
    processed: pendingJobs.length,
    succeeded,
    failed,
  };
}

/**
 * P0-01: Get GDPR job status for debugging/monitoring
 */
export async function getGDPRJobStatus(shopDomain?: string): Promise<{
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
}> {
  const where = shopDomain ? { shopDomain } : {};
  
  const [queued, processing, completed, failed, recentJobs] = await Promise.all([
    prisma.gDPRJob.count({ where: { ...where, status: "queued" } }),
    prisma.gDPRJob.count({ where: { ...where, status: "processing" } }),
    prisma.gDPRJob.count({ where: { ...where, status: "completed" } }),
    prisma.gDPRJob.count({ where: { ...where, status: "failed" } }),
    prisma.gDPRJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        shopDomain: true,
        jobType: true,
        status: true,
        createdAt: true,
        completedAt: true,
      },
    }),
  ]);
  
  return {
    queued,
    processing,
    completed,
    failed,
    recentJobs,
  };
}
