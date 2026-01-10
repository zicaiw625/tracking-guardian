import prisma from "../../../db.server";
import { logger } from "../../../utils/logger.server";
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
  const pixelReceiptResult = await prisma.pixelEventReceipt.deleteMany({
    where: {
      shopId: shop.id,
      orderKey: { in: orderIdStrings },
    },
  });
  const result: CustomerRedactResult = {
    customerId,
    ordersRedacted: ordersToRedact,
    deletedCounts: {
      conversionLogs: 0,
      conversionJobs: 0,
      pixelEventReceipts: pixelReceiptResult.count,
      surveyResponses: 0,
    },
  };
  logger.info(`[GDPR] Customer redact completed for ${shopDomain}`, {
    customerId,
    ...result.deletedCounts,
  });
  return result;
}
