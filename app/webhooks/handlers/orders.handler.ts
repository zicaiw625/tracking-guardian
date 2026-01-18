import { randomUUID } from "crypto";
import prisma from "../../db.server";
import { createConversionJob } from "../../services/db/conversion-repository.server";
import { makeOrderKey, normalizeOrderId } from "../../utils/crypto.server";
import { logger } from "../../utils/logger.server";
import type { WebhookContext, WebhookHandlerResult } from "../types";

interface OrderWebhookPayload {
  id: string | number;
  name?: string;
  total_price?: string;
  currency?: string;
  financial_status?: string;
  cancelled_at?: string | null;
  updated_at?: string;
  created_at?: string;
  checkout_token?: string | null;
}

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

export async function handleOrdersCreate(
  context: WebhookContext
): Promise<WebhookHandlerResult> {
  const { shop, payload } = context;
  try {
    const orderPayload = payload as OrderWebhookPayload;
    const snapshot = extractOrderSnapshot(orderPayload);
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
    const skipEnqueue =
      snapshot.financialStatus === "cancelled" ||
      snapshot.cancelledAt != null ||
      snapshot.totalValue <= 0;
    if (!skipEnqueue) {
      const orderKeyNorm = normalizeOrderId(snapshot.orderId);
      const checkoutKey =
        orderPayload.checkout_token != null && orderPayload.checkout_token !== ""
          ? makeOrderKey({ checkoutToken: orderPayload.checkout_token })
          : null;
      const orConditions: Array<{ orderKey?: string; altOrderKey?: string }> = [
        { orderKey: orderKeyNorm },
        { altOrderKey: orderKeyNorm },
      ];
      if (checkoutKey) {
        orConditions.push({ orderKey: checkoutKey }, { altOrderKey: checkoutKey });
      }
      const existingReceipt = await prisma.pixelEventReceipt.findFirst({
        where: {
          shopId: shopRecord.id,
          eventType: "purchase",
          OR: orConditions,
        },
        select: { id: true, orderKey: true },
      });
      if (existingReceipt) {
        if (
          checkoutKey != null &&
          existingReceipt.orderKey !== null &&
          existingReceipt.orderKey === checkoutKey
        ) {
          await prisma.pixelEventReceipt.update({
            where: { id: existingReceipt.id },
            data: { orderKey: orderKeyNorm, altOrderKey: checkoutKey },
          });
        }
      } else {
        await createConversionJob({
          shopId: shopRecord.id,
          orderId: snapshot.orderId,
          orderNumber: snapshot.orderNumber,
          orderValue: snapshot.totalValue,
          currency: snapshot.currency,
          capiInput: {
            value: snapshot.totalValue,
            currency: snapshot.currency,
            eventType: "purchase",
          },
        });
      }
    }
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

export async function handleOrdersUpdated(
  context: WebhookContext
): Promise<WebhookHandlerResult> {
  return handleOrdersCreate(context);
}

export async function handleOrdersCancelled(
  context: WebhookContext
): Promise<WebhookHandlerResult> {
  const { shop, payload } = context;
  try {
    const orderPayload = payload as OrderWebhookPayload;
    const snapshot = extractOrderSnapshot(orderPayload);
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

export async function handleOrdersEdited(
  context: WebhookContext
): Promise<WebhookHandlerResult> {
  return handleOrdersUpdated(context);
}
