/**
 * GDPR Shop Redact Handler
 *
 * Handles complete shop data deletion for GDPR compliance.
 * Deletes ALL data associated with a shop when they uninstall.
 */

import prisma from "../../../db.server";
import { logger } from "../../../utils/logger.server";
import type { ShopRedactPayload, ShopRedactResult } from "../types";
import { createEmptyShopRedactDeletionCounts } from "../types";

// =============================================================================
// Shop Redact Processing
// =============================================================================

/**
 * Process a GDPR shop redact request.
 * Deletes ALL data associated with the shop.
 * This is a complete data erasure operation.
 *
 * @param shopDomain - The shop domain to redact
 * @param _payload - Shop redact payload (currently unused but kept for consistency)
 * @returns Deletion result with counts by table
 */
export async function processShopRedact(
  shopDomain: string,
  _payload: ShopRedactPayload
): Promise<ShopRedactResult> {
  logger.info(`[GDPR] Processing shop redact for ${shopDomain} - DELETING ALL DATA`);

  // Find the shop
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  // Initialize deletion counts
  const deletedCounts = createEmptyShopRedactDeletionCounts();

  // Delete sessions (by shop domain, not shop ID)
  const sessionResult = await prisma.session.deleteMany({
    where: { shop: shopDomain },
  });
  deletedCounts.sessions = sessionResult.count;

  // Delete webhook logs (by shop domain, not shop ID)
  const webhookLogResult = await prisma.webhookLog.deleteMany({
    where: { shopDomain },
  });
  deletedCounts.webhookLogs = webhookLogResult.count;

  // If shop exists, delete all related records
  if (shop) {
    // Delete in order to respect foreign key constraints
    // (most specific to most general)

    // Conversion logs
    const conversionLogResult = await prisma.conversionLog.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.conversionLogs = conversionLogResult.count;

    // Conversion jobs
    const conversionJobResult = await prisma.conversionJob.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.conversionJobs = conversionJobResult.count;

    // Pixel event receipts
    const pixelReceiptResult = await prisma.pixelEventReceipt.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.pixelEventReceipts = pixelReceiptResult.count;

    // Survey responses
    const surveyResult = await prisma.surveyResponse.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.surveyResponses = surveyResult.count;

    // Audit logs
    const auditLogResult = await prisma.auditLog.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.auditLogs = auditLogResult.count;

    // Scan reports
    const scanReportResult = await prisma.scanReport.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.scanReports = scanReportResult.count;

    // Reconciliation reports
    const reconciliationResult = await prisma.reconciliationReport.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.reconciliationReports = reconciliationResult.count;

    // Alert configs
    const alertConfigResult = await prisma.alertConfig.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.alertConfigs = alertConfigResult.count;

    // Pixel configs
    const pixelConfigResult = await prisma.pixelConfig.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.pixelConfigs = pixelConfigResult.count;

    // Monthly usages
    const monthlyUsageResult = await prisma.monthlyUsage.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.monthlyUsages = monthlyUsageResult.count;

    // Finally, delete the shop itself
    await prisma.shop.delete({
      where: { id: shop.id },
    });
    deletedCounts.shop = 1;
  }

  const result: ShopRedactResult = {
    shopDomain,
    deletedCounts,
  };

  logger.info(`[GDPR] Shop redact completed for ${shopDomain}`, { ...deletedCounts });

  return result;
}

