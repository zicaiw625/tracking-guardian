

import prisma from "../../db.server";
import { normalizeOrderId } from "../../utils/crypto.server";
import { logger } from "../../utils/logger.server";
import { parseOrderWebhookPayload } from "../../utils/webhook-validation";
import type { OrderWebhookPayload } from "../../types";
import type { WebhookContext, WebhookHandlerResult, ShopWithPixelConfigs } from "../types";
import type { Prisma } from "@prisma/client";

export async function handleOrdersCancelled(
  context: WebhookContext,
  shopRecord: ShopWithPixelConfigs | null
): Promise<WebhookHandlerResult> {
  if (!shopRecord) {
    logger.warn(`Skipping ORDERS_CANCELLED: shopRecord not found for ${context.shop}`);
    return {
      success: true,
      status: 200,
      message: "Shop not found",
    };
  }

  if (!context.payload) {
    logger.warn(`Invalid ORDERS_CANCELLED payload from ${context.shop}, skipping`);
    return {
      success: false,
      status: 400,
      message: "Invalid payload",
    };
  }

  const orderPayload = parseOrderWebhookPayload(context.payload, context.shop);
  if (!orderPayload) {
    logger.warn(`Invalid ORDERS_CANCELLED payload from ${context.shop}, skipping`);
    return {
      success: false,
      status: 400,
      message: "Invalid payload",
    };
  }

  const orderId = normalizeOrderId(String(orderPayload.id));
  logger.info(
    `Processing ORDERS_CANCELLED webhook for shop ${context.shop}, order ${orderId}`
  );

  try {
    await prisma.eventLog.create({
      data: {
        shopId: shopRecord.id,
        eventName: "order_cancelled",
        eventId: `cancel_${orderId}_${Date.now()}`,
        // orderPayload 已经是可序列化的对象，可以安全地转换为 Prisma.InputJsonValue
        payloadJson: orderPayload as Prisma.InputJsonValue,
        destinationType: "verification",
        status: "ok",
        eventTimestamp: new Date(),
      },
    });

    logger.info(`Order cancellation logged for order ${orderId}`);
  } catch (error) {
    logger.error(`Failed to log order cancellation for ${orderId}:`, error);
  }

  return {
    success: true,
    status: 200,
    message: "Order cancellation logged",
    orderId,
  };
}

export async function handleOrdersUpdated(
  context: WebhookContext,
  shopRecord: ShopWithPixelConfigs | null
): Promise<WebhookHandlerResult> {
  if (!shopRecord) {
    logger.warn(`Skipping ORDERS_UPDATED: shopRecord not found for ${context.shop}`);
    return {
      success: true,
      status: 200,
      message: "Shop not found",
    };
  }

  if (!context.payload) {
    logger.warn(`Invalid ORDERS_UPDATED payload from ${context.shop}, skipping`);
    return {
      success: false,
      status: 400,
      message: "Invalid payload",
    };
  }

  const orderPayload = parseOrderWebhookPayload(context.payload, context.shop);
  if (!orderPayload) {
    logger.warn(`Invalid ORDERS_UPDATED payload from ${context.shop}, skipping`);
    return {
      success: false,
      status: 400,
      message: "Invalid payload",
    };
  }

  const orderId = normalizeOrderId(String(orderPayload.id));
  logger.info(
    `Processing ORDERS_UPDATED webhook for shop ${context.shop}, order ${orderId}`
  );

  try {
    await prisma.eventLog.create({
      data: {
        shopId: shopRecord.id,
        eventName: "order_updated",
        eventId: `update_${orderId}_${Date.now()}`,
        // orderPayload 已经是可序列化的对象，可以安全地转换为 Prisma.InputJsonValue
        payloadJson: orderPayload as Prisma.InputJsonValue,
        destinationType: "verification",
        status: "ok",
        eventTimestamp: new Date(),
      },
    });

    logger.info(`Order update logged for order ${orderId}`);
  } catch (error) {
    logger.error(`Failed to log order update for ${orderId}:`, error);
  }

  return {
    success: true,
    status: 200,
    message: "Order update logged",
    orderId,
  };
}

export async function handleRefundsCreate(
  context: WebhookContext,
  shopRecord: ShopWithPixelConfigs | null
): Promise<WebhookHandlerResult> {
  if (!shopRecord) {
    logger.warn(`Skipping REFUNDS_CREATE: shopRecord not found for ${context.shop}`);
    return {
      success: true,
      status: 200,
      message: "Shop not found",
    };
  }

  if (!context.payload) {
    logger.warn(`Invalid REFUNDS_CREATE payload from ${context.shop}, skipping`);
    return {
      success: false,
      status: 400,
      message: "Invalid payload",
    };
  }

  const refundPayload = context.payload as {
    id?: number | string;
    order_id?: number | string;
    amount?: string;
    currency?: string;
    created_at?: string;
    [key: string]: unknown;
  };

  const orderId = refundPayload.order_id
    ? normalizeOrderId(String(refundPayload.order_id))
    : null;

  if (!orderId) {
    logger.warn(`Invalid REFUNDS_CREATE payload: missing order_id from ${context.shop}`);
    return {
      success: false,
      status: 400,
      message: "Invalid payload: missing order_id",
    };
  }

  logger.info(
    `Processing REFUNDS_CREATE webhook for shop ${context.shop}, order ${orderId}`
  );

  try {
    await prisma.eventLog.create({
      data: {
        shopId: shopRecord.id,
        eventName: "refund_created",
        eventId: `refund_${orderId}_${Date.now()}`,
        // refundPayload 已经是可序列化的对象，可以安全地转换为 Prisma.InputJsonValue
        payloadJson: refundPayload as Prisma.InputJsonValue,
        destinationType: "verification",
        status: "ok",
        eventTimestamp: new Date(),
      },
    });

    logger.info(`Refund logged for order ${orderId}`);
  } catch (error) {
    logger.error(`Failed to log refund for ${orderId}:`, error);
  }

  return {
    success: true,
    status: 200,
    message: "Refund logged",
    orderId,
  };
}

