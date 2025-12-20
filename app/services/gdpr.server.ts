

import prisma from "../db.server";
import { logger } from "../utils/logger";
import { createAuditLog } from "./audit.server";

export type GDPRJobType = "data_request" | "customer_redact" | "shop_redact";

// P0-2: Minimal payload interfaces - NO PII (email/phone) stored
// These match the minimal payloads created in webhooks.tsx
interface DataRequestPayload {
  shop_id?: number;
  shop_domain?: string;
  orders_requested?: number[];
  customer_id?: number;  // P0-2: Only ID, not email/phone
  data_request_id?: number;
}

interface CustomerRedactPayload {
  shop_id?: number;
  shop_domain?: string;
  customer_id?: number;  // P0-2: Only ID, not email/phone
  orders_to_redact?: number[];
}

interface ShopRedactPayload {
  shop_id?: number;
  shop_domain?: string;
}

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

async function processDataRequest(
  shopDomain: string,
  payload: DataRequestPayload
): Promise<DataRequestResult> {
  // P0-2: Use minimal payload fields (no email/phone stored)
  const customerId = payload.customer_id;
  const ordersRequested = payload.orders_requested || [];
  const dataRequestId = payload.data_request_id;
  
  logger.info(`[GDPR] Processing data request for ${shopDomain}`, {
    dataRequestId,
    customerId,
    ordersCount: ordersRequested.length,
  });

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

  const orderIdStrings = ordersRequested.map(id => String(id));

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
      
    },
  });

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

async function processCustomerRedact(
  shopDomain: string,
  payload: CustomerRedactPayload
): Promise<CustomerRedactResult> {
  // P0-2: Use minimal payload fields (no email/phone stored)
  const customerId = payload.customer_id;
  const ordersToRedact = payload.orders_to_redact || [];
  
  logger.info(`[GDPR] Processing customer redact for ${shopDomain}`, {
    customerId,
    ordersCount: ordersToRedact.length,
  });

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

  const orderIdStrings = ordersToRedact.map(id => String(id));

  const conversionLogResult = await prisma.conversionLog.deleteMany({
    where: {
      shopId: shop.id,
      orderId: { in: orderIdStrings },
    },
  });

  const conversionJobResult = await prisma.conversionJob.deleteMany({
    where: {
      shopId: shop.id,
      orderId: { in: orderIdStrings },
    },
  });

  const pixelReceiptResult = await prisma.pixelEventReceipt.deleteMany({
    where: {
      shopId: shop.id,
      orderId: { in: orderIdStrings },
    },
  });

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

async function processShopRedact(
  shopDomain: string,
  _payload: ShopRedactPayload
): Promise<ShopRedactResult> {
  logger.info(`[GDPR] Processing shop redact for ${shopDomain} - DELETING ALL DATA`);

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

  const sessionResult = await prisma.session.deleteMany({
    where: { shop: shopDomain },
  });
  deletedCounts.sessions = sessionResult.count;

  const webhookLogResult = await prisma.webhookLog.deleteMany({
    where: { shopDomain },
  });
  deletedCounts.webhookLogs = webhookLogResult.count;
  
  if (shop) {

    const conversionLogResult = await prisma.conversionLog.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.conversionLogs = conversionLogResult.count;

    const conversionJobResult = await prisma.conversionJob.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.conversionJobs = conversionJobResult.count;

    const pixelReceiptResult = await prisma.pixelEventReceipt.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.pixelEventReceipts = pixelReceiptResult.count;

    const surveyResult = await prisma.surveyResponse.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.surveyResponses = surveyResult.count;

    const auditLogResult = await prisma.auditLog.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.auditLogs = auditLogResult.count;

    const scanReportResult = await prisma.scanReport.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.scanReports = scanReportResult.count;

    const reconciliationResult = await prisma.reconciliationReport.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.reconciliationReports = reconciliationResult.count;

    const alertConfigResult = await prisma.alertConfig.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.alertConfigs = alertConfigResult.count;

    const pixelConfigResult = await prisma.pixelConfig.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.pixelConfigs = pixelConfigResult.count;

    const monthlyUsageResult = await prisma.monthlyUsage.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.monthlyUsages = monthlyUsageResult.count;

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

  if (job.status === "completed") {
    logger.debug(`[GDPR] Job ${jobId} already completed, skipping`);
    return { success: true, result: job.result as DataRequestResult | CustomerRedactResult | ShopRedactResult };
  }

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

    // P0-2: Clear payload after processing to minimize data retention
    await prisma.gDPRJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        result: result as object,
        payload: {}, // P0-2: Clear payload after successful processing
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

export async function processGDPRJobs(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  
  const pendingJobs = await prisma.gDPRJob.findMany({
    where: {
      status: { in: ["queued", "failed"] }, 
    },
    orderBy: { createdAt: "asc" },
    take: 10, 
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
