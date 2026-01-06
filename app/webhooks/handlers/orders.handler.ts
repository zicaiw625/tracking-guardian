/**
 * P0-2: 订单 webhook handlers
 * 
 * 处理订单相关 webhooks（orders/create, orders/updated, orders/cancelled, orders/edited）
 * 仅存储订单摘要信息（orderId, orderNumber, totalValue, currency, financialStatus）
 * 不存储任何 PII（邮箱/地址/电话），符合 v1.0 隐私最小化原则
 */

import { randomUUID } from "crypto";
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import type { WebhookContext, WebhookHandlerResult } from "../types";

interface OrderWebhookPayload {
  id: string | number;
  name?: string; // order number (e.g., "#1001")
  total_price?: string;
  currency?: string;
  financial_status?: string;
  cancelled_at?: string | null;
  updated_at?: string;
  created_at?: string;
}

/**
 * 从订单 payload 中提取订单摘要信息（不包含 PII）
 */
function extractOrderSnapshot(payload: OrderWebhookPayload): {
  orderId: string;
  orderNumber: string | null;
  totalValue: number;
  currency: string;
  financialStatus: string | null;
  cancelledAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
} {
  const orderId = String(payload.id);
  const orderNumber = payload.name || null;
  const totalValue = payload.total_price ? parseFloat(payload.total_price) : 0;
  const currency = payload.currency || "USD";
  const financialStatus = payload.financial_status || null;
  const cancelledAt = payload.cancelled_at ? new Date(payload.cancelled_at) : null;
  const updatedAt = payload.updated_at ? new Date(payload.updated_at) : new Date();
  const createdAt = payload.created_at ? new Date(payload.created_at) : new Date();

  return {
    orderId,
    orderNumber,
    totalValue,
    currency,
    financialStatus,
    cancelledAt,
    updatedAt,
    createdAt,
  };
}

/**
 * 处理 orders/create webhook
 */
export async function handleOrdersCreate(
  context: WebhookContext
): Promise<WebhookHandlerResult> {
  const { shop, payload } = context;

  try {
    const orderPayload = payload as OrderWebhookPayload;
    const snapshot = extractOrderSnapshot(orderPayload);

    // 查找 shop
    const shopRecord = await prisma.shop.findUnique({
      where: { shopDomain: shop },
      select: { id: true },
    });

    if (!shopRecord) {
      logger.warn(`Shop not found for orders/create webhook: ${shop}`);
      return {
        success: true,
        message: "OK (shop not found)",
        status: 200,
      };
    }

    // 创建或更新订单快照
    const snapshotId = randomUUID();

    await prisma.shopifyOrderSnapshot.upsert({
      where: {
        shopId_orderId: {
          shopId: shopRecord.id,
          orderId: snapshot.orderId,
        },
      },
      create: {
        id: snapshotId,
        shopId: shopRecord.id,
        orderId: snapshot.orderId,
        orderNumber: snapshot.orderNumber,
        totalValue: snapshot.totalValue,
        currency: snapshot.currency,
        financialStatus: snapshot.financialStatus,
        cancelledAt: snapshot.cancelledAt,
        updatedAt: snapshot.updatedAt,
        createdAt: snapshot.createdAt,
      },
      update: {
        orderNumber: snapshot.orderNumber,
        totalValue: snapshot.totalValue,
        currency: snapshot.currency,
        financialStatus: snapshot.financialStatus,
        cancelledAt: snapshot.cancelledAt,
        updatedAt: snapshot.updatedAt,
      },
    });

    logger.info(`Order snapshot created/updated: ${snapshot.orderId} for ${shop}`);

    return {
      success: true,
      message: "OK",
      status: 200,
      orderId: snapshot.orderId,
    };
  } catch (error) {
    logger.error(`Failed to process orders/create webhook for ${shop}:`, {
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: "Internal server error",
      status: 500,
    };
  }
}

/**
 * 处理 orders/updated webhook
 */
export async function handleOrdersUpdated(
  context: WebhookContext
): Promise<WebhookHandlerResult> {
  // orders/updated 与 orders/create 处理逻辑相同（都是 upsert）
  return handleOrdersCreate(context);
}

/**
 * 处理 orders/cancelled webhook
 */
export async function handleOrdersCancelled(
  context: WebhookContext
): Promise<WebhookHandlerResult> {
  const { shop, payload } = context;

  try {
    const orderPayload = payload as OrderWebhookPayload;
    const snapshot = extractOrderSnapshot(orderPayload);

    // 查找 shop
    const shopRecord = await prisma.shop.findUnique({
      where: { shopDomain: shop },
      select: { id: true },
    });

    if (!shopRecord) {
      logger.warn(`Shop not found for orders/cancelled webhook: ${shop}`);
      return {
        success: true,
        message: "OK (shop not found)",
        status: 200,
      };
    }

    // 更新订单快照，标记为已取消
    const snapshotId = randomUUID();

    await prisma.shopifyOrderSnapshot.upsert({
      where: {
        shopId_orderId: {
          shopId: shopRecord.id,
          orderId: snapshot.orderId,
        },
      },
      create: {
        id: snapshotId,
        shopId: shopRecord.id,
        orderId: snapshot.orderId,
        orderNumber: snapshot.orderNumber,
        totalValue: snapshot.totalValue,
        currency: snapshot.currency,
        financialStatus: snapshot.financialStatus,
        cancelledAt: snapshot.cancelledAt || new Date(),
        updatedAt: snapshot.updatedAt,
        createdAt: snapshot.createdAt,
      },
      update: {
        cancelledAt: snapshot.cancelledAt || new Date(),
        financialStatus: snapshot.financialStatus,
        updatedAt: snapshot.updatedAt,
      },
    });

    logger.info(`Order cancelled: ${snapshot.orderId} for ${shop}`);

    return {
      success: true,
      message: "OK",
      status: 200,
      orderId: snapshot.orderId,
    };
  } catch (error) {
    logger.error(`Failed to process orders/cancelled webhook for ${shop}:`, {
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: "Internal server error",
      status: 500,
    };
  }
}

/**
 * 处理 orders/edited webhook
 */
export async function handleOrdersEdited(
  context: WebhookContext
): Promise<WebhookHandlerResult> {
  // orders/edited 与 orders/updated 处理逻辑相同
  return handleOrdersUpdated(context);
}

