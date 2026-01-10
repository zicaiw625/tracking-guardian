import prisma from "../../../db.server";
import { logger } from "../../../utils/logger.server";
import { createAuditLog } from "../../audit.server";
import type { CustomerRedactPayload, CustomerRedactResult } from "../types";
import { createEmptyCustomerRedactResult } from "../types";

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
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  if (!shop) {
    logger.warn(`[GDPR] Shop not found for customer redact: ${shopDomain}`);
    return createEmptyCustomerRedactResult(customerId);
  }
  const orderIdStrings = ordersToRedact.map((id: number | string) => String(id));
  const orderNumberPatterns = ordersToRedact.map((id: number | string) => `order_num:${id}`);
  const receiptsWithTokens = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId: shop.id,
      orderId: { in: orderIdStrings },
      checkoutToken: { not: null },
    },
    select: { checkoutToken: true },
  });
  const linkedCheckoutTokens: string[] = receiptsWithTokens
    .map((r: { checkoutToken: string | null }) => r.checkoutToken)
    .filter((t: string | null): t is string => t !== null);
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
  const surveyByOrderId = await prisma.surveyResponse.deleteMany({
    where: {
      shopId: shop.id,
      orderId: { in: orderIdStrings },
    },
  });
  const surveyByOrderNumberPattern = await prisma.surveyResponse.deleteMany({
    where: {
      shopId: shop.id,
      orderId: { in: orderNumberPatterns },
    },
  });
  let pixelReceiptByCheckoutToken = 0;
  let surveyByCheckoutTokenPattern = 0;
  let conversionLogByCheckoutToken = 0;
  if (linkedCheckoutTokens.length > 0) {
    const additionalPixelReceipts = await prisma.pixelEventReceipt.deleteMany({
      where: {
        shopId: shop.id,
        orderId: { in: linkedCheckoutTokens },
      },
    });
    pixelReceiptByCheckoutToken = additionalPixelReceipts.count;
    const checkoutPatterns = linkedCheckoutTokens.map((t) => `checkout:${t}`);
    const additionalSurveys = await prisma.surveyResponse.deleteMany({
      where: {
        shopId: shop.id,
        orderId: { in: checkoutPatterns },
      },
    });
    surveyByCheckoutTokenPattern = additionalSurveys.count;
    const additionalConversionLogs = await prisma.conversionLog.deleteMany({
      where: {
        shopId: shop.id,
        orderId: { in: linkedCheckoutTokens },
      },
    });
    conversionLogByCheckoutToken = additionalConversionLogs.count;
  }
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
