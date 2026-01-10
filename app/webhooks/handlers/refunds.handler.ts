import { randomUUID } from "crypto";
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import type { WebhookContext, WebhookHandlerResult } from "../types";

interface RefundWebhookPayload {
  id: string | number;
  order_id: string | number;
  amount?: string;
  currency?: string;
  created_at?: string;
}

function extractRefundSnapshot(payload: RefundWebhookPayload): {
  refundId: string;
  orderId: string;
  amount: number;
  currency: string;
  createdAt: Date;
} {
  const refundId = String(payload.id);
  const orderId = String(payload.order_id);
  const amount = payload.amount ? parseFloat(payload.amount) : 0;
  const currency = payload.currency || "USD";
  const createdAt = payload.created_at ? new Date(payload.created_at) : new Date();
  return {
    refundId,
    orderId,
    amount,
    currency,
    createdAt,
  };
}

export async function handleRefundsCreate(
  context: WebhookContext
): Promise<WebhookHandlerResult> {
  const { shop, payload } = context;
  try {
    const refundPayload = payload as RefundWebhookPayload;
    const snapshot = extractRefundSnapshot(refundPayload);
    const shopRecord = await prisma.shop.findUnique({
      where: { shopDomain: shop },
      select: { id: true },
    });
    if (!shopRecord) {
      logger.warn(`Shop not found for refunds/create webhook: ${shop}`);
      return {
        success: true,
        message: "OK (shop not found)",
        status: 200,
      };
    }
    const snapshotId = randomUUID();
    await prisma.refundSnapshot.create({
      data: {
        id: snapshotId,
        shopId: shopRecord.id,
        refundId: snapshot.refundId,
        orderId: snapshot.orderId,
        amount: snapshot.amount,
        currency: snapshot.currency,
        createdAt: snapshot.createdAt,
      },
    });
    logger.info(`Refund snapshot created: ${snapshot.refundId} for order ${snapshot.orderId} in ${shop}`);
    return {
      success: true,
      message: "OK",
      status: 200,
      orderId: snapshot.orderId,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      logger.debug(`Refund snapshot already exists: ${(payload as RefundWebhookPayload).id} for ${shop}`);
      return {
        success: true,
        message: "OK (already processed)",
        status: 200,
        orderId: String((payload as RefundWebhookPayload).order_id),
      };
    }
    logger.error(`Failed to process refunds/create webhook for ${shop}:`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      message: "Internal server error",
      status: 500,
    };
  }
}
