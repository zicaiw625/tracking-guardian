/**
 * GDPR Customer Redact Handler
 *
 * Handles customer data deletion for GDPR compliance.
 * Deletes all data associated with specific orders/customers.
 */

import prisma from "../../../db.server";
import { logger } from "../../../utils/logger.server";
import { createAuditLog } from "../../audit.server";
import type { CustomerRedactPayload, CustomerRedactResult } from "../types";
import { createEmptyCustomerRedactResult } from "../types";

// =============================================================================
// Customer Redact Processing
// =============================================================================

/**
 * Process a GDPR customer redact request.
 * Deletes all data associated with the specified orders.
 *
 * @param shopDomain - The shop domain making the request
 * @param payload - Customer redact payload with order info
 * @returns Deletion result with counts
 */
export async function processCustomerRedact(
  shopDomain: string,
  payload: CustomerRedactPayload
): Promise<CustomerRedactResult> {
  const customerId = payload.customer_id;
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
    return createEmptyCustomerRedactResult(customerId);
  }

  // Convert order IDs to strings and patterns
  const orderIdStrings = ordersToRedact.map((id) => String(id));
  const orderNumberPatterns = ordersToRedact.map((id) => `order_num:${id}`);

  // Delete conversion logs
  const conversionLogResult = await prisma.conversionLog.deleteMany({
    where: {
      shopId: shop.id,
      orderId: { in: orderIdStrings },
    },
  });

  // Delete conversion jobs
  const conversionJobResult = await prisma.conversionJob.deleteMany({
    where: {
      shopId: shop.id,
      orderId: { in: orderIdStrings },
    },
  });

  // Delete pixel event receipts
  const pixelReceiptResult = await prisma.pixelEventReceipt.deleteMany({
    where: {
      shopId: shop.id,
      orderId: { in: orderIdStrings },
    },
  });

  // Delete survey responses by order ID
  const surveyByOrderId = await prisma.surveyResponse.deleteMany({
    where: {
      shopId: shop.id,
      orderId: { in: orderIdStrings },
    },
  });

  // Delete survey responses by order number pattern
  const surveyByOrderNumberPattern = await prisma.surveyResponse.deleteMany({
    where: {
      shopId: shop.id,
      orderId: { in: orderNumberPatterns },
    },
  });

  // Find related checkout tokens for cascade deletion
  const receiptsWithCheckoutTokens = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId: shop.id,
      orderId: { in: orderIdStrings },
      checkoutToken: { not: null },
    },
    select: { checkoutToken: true },
  });

  const linkedCheckoutTokens = Array.from(
    new Set(
      receiptsWithCheckoutTokens
        .map((r) => r.checkoutToken)
        .filter((t): t is string => t !== null)
    )
  );

  let pixelReceiptByCheckoutToken = 0;
  let surveyByCheckoutTokenPattern = 0;
  let conversionLogByCheckoutToken = 0;

  if (linkedCheckoutTokens.length > 0) {
    // Delete additional pixel receipts by checkout token
    const additionalPixelReceipts = await prisma.pixelEventReceipt.deleteMany({
      where: {
        shopId: shop.id,
        orderId: { in: linkedCheckoutTokens },
      },
    });
    pixelReceiptByCheckoutToken = additionalPixelReceipts.count;

    // Delete surveys by checkout token pattern
    const checkoutPatterns = linkedCheckoutTokens.map((t) => `checkout:${t}`);
    const additionalSurveys = await prisma.surveyResponse.deleteMany({
      where: {
        shopId: shop.id,
        orderId: { in: checkoutPatterns },
      },
    });
    surveyByCheckoutTokenPattern = additionalSurveys.count;

    // Delete conversion logs by checkout token
    const additionalConversionLogs = await prisma.conversionLog.deleteMany({
      where: {
        shopId: shop.id,
        orderId: { in: linkedCheckoutTokens },
      },
    });
    conversionLogByCheckoutToken = additionalConversionLogs.count;
  }

  // Build result
  const result: CustomerRedactResult = {
    customerId,
    ordersRedacted: ordersToRedact,
    deletedCounts: {
      conversionLogs: conversionLogResult.count + conversionLogByCheckoutToken,
      conversionJobs: conversionJobResult.count,
      pixelEventReceipts: pixelReceiptResult.count + pixelReceiptByCheckoutToken,
      surveyResponses:
        surveyByOrderId.count + surveyByOrderNumberPattern.count + surveyByCheckoutTokenPattern,
    },
  };

  logger.info(`[GDPR] Customer redact completed for ${shopDomain}`, {
    customerId,
    ...result.deletedCounts,
    fallbackDeletions: {
      byOrderNumberPattern: surveyByOrderNumberPattern.count,
      byCheckoutTokenPattern: surveyByCheckoutTokenPattern,
      pixelReceiptsByCheckoutToken: pixelReceiptByCheckoutToken,
      conversionLogsByCheckoutToken: conversionLogByCheckoutToken,
    },
  });

  // Create audit log
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
      fallbackDeletions: {
        orderNumberPatterns: orderNumberPatterns.length,
        checkoutTokensFound: linkedCheckoutTokens.length,
      },
    },
  });

  return result;
}

