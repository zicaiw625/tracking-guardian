/**
 * ORDERS_PAID Webhook Handler
 *
 * Processes order payment webhooks and queues conversions for platform sending.
 */

import prisma from "../../db.server";
import { normalizeOrderId, generateEventId } from "../../utils/crypto.server";
import { checkBillingGate, type PlanId } from "../../services/billing.server";
import { logger } from "../../utils/logger.server";
import { parseOrderWebhookPayload } from "../../utils/webhook-validation";
import { ConversionLogStatus, JobStatus } from "../../types";
import type { OrderWebhookPayload } from "../../types";
import type { WebhookContext, WebhookHandlerResult, ShopWithPixelConfigs } from "../types";
import type { Prisma } from "@prisma/client";

// =============================================================================
// CAPI Input Builder
// =============================================================================

/**
 * Build minimal CAPI input from order payload.
 * Only includes data needed for platform API calls, no raw PII.
 */
function buildCapiInput(
  orderPayload: OrderWebhookPayload,
  orderId: string
): Record<string, unknown> {
  const items =
    orderPayload.line_items?.map((item) => ({
      productId: item.product_id ? String(item.product_id) : undefined,
      variantId: item.variant_id ? String(item.variant_id) : undefined,
      sku: item.sku || undefined,
      name: item.title || item.name || "",
      quantity: item.quantity || 1,
      price: safeParseFloat(item.price),
    })) || [];

  const contentIds = items
    .map((item) => item.productId)
    .filter((id): id is string => !!id);

  return {
    orderId,
    value: safeParseFloat(orderPayload.total_price),
    currency: orderPayload.currency || "USD",
    orderNumber: orderPayload.order_number
      ? String(orderPayload.order_number)
      : null,
    items,
    contentIds,
    numItems: items.reduce((sum, item) => sum + item.quantity, 0),
    tax: safeParseFloat(orderPayload.total_tax),
    shipping: safeParseFloat(
      orderPayload.total_shipping_price_set?.shop_money?.amount
    ),
    processedAt: orderPayload.processed_at || new Date().toISOString(),
    webhookReceivedAt: new Date().toISOString(),
    checkoutToken: orderPayload.checkout_token || null,
    shopifyOrderId: orderPayload.id,
  };
}

/**
 * Safe float parsing with fallback
 */
function safeParseFloat(value: string | number | undefined | null): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === "number") return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

// =============================================================================
// Billing Gate Handler
// =============================================================================

/**
 * Handle order when billing limit is exceeded
 */
async function handleBillingLimitExceeded(
  shopRecord: ShopWithPixelConfigs,
  orderPayload: OrderWebhookPayload,
  orderId: string,
  billingCheck: { usage: { current: number; limit: number } }
): Promise<void> {
  const blockedEventId = generateEventId(orderId, "purchase", shopRecord.shopDomain);

  for (const pixelConfig of shopRecord.pixelConfigs) {
    await prisma.conversionLog.upsert({
      where: {
        shopId_orderId_platform_eventType: {
          shopId: shopRecord.id,
          orderId,
          platform: pixelConfig.platform,
          eventType: "purchase",
        },
      },
      create: {
        shopId: shopRecord.id,
        orderId,
        orderNumber: orderPayload.order_number
          ? String(orderPayload.order_number)
          : null,
        orderValue: safeParseFloat(orderPayload.total_price),
        currency: orderPayload.currency || "USD",
        platform: pixelConfig.platform,
        eventType: "purchase",
        eventId: blockedEventId,
        status: ConversionLogStatus.FAILED,
        errorMessage: `Monthly limit exceeded: ${billingCheck.usage.current}/${billingCheck.usage.limit}`,
      },
      update: {
        orderNumber: orderPayload.order_number
          ? String(orderPayload.order_number)
          : null,
        orderValue: safeParseFloat(orderPayload.total_price),
        currency: orderPayload.currency || "USD",
        eventId: blockedEventId,
        status: ConversionLogStatus.FAILED,
        errorMessage: `Monthly limit exceeded: ${billingCheck.usage.current}/${billingCheck.usage.limit}`,
      },
    });
  }
}

// =============================================================================
// Queue Order
// =============================================================================

/**
 * Queue an order for async processing
 */
async function queueOrderForProcessing(
  shopRecord: ShopWithPixelConfigs,
  orderPayload: OrderWebhookPayload
): Promise<void> {
  const orderId = normalizeOrderId(String(orderPayload.id));
  const capiInput = buildCapiInput(orderPayload, orderId) as Prisma.InputJsonValue;

  try {
    await prisma.conversionJob.upsert({
      where: {
        shopId_orderId: {
          shopId: shopRecord.id,
          orderId,
        },
      },
      create: {
        shopId: shopRecord.id,
        orderId,
        orderNumber: orderPayload.order_number
          ? String(orderPayload.order_number)
          : null,
        orderValue: safeParseFloat(orderPayload.total_price),
        currency: orderPayload.currency || "USD",
        capiInput,
        status: JobStatus.QUEUED,
      },
      update: {
        orderNumber: orderPayload.order_number
          ? String(orderPayload.order_number)
          : null,
        orderValue: safeParseFloat(orderPayload.total_price),
        currency: orderPayload.currency || "USD",
        capiInput,
      },
    });

    logger.info(`Order ${orderId} queued for async processing`);
  } catch (error) {
    logger.error(`Failed to queue order ${orderId}:`, error);
    throw error;
  }
}

// =============================================================================
// Main Handler
// =============================================================================

/**
 * Handle ORDERS_PAID webhook
 */
export async function handleOrdersPaid(
  context: WebhookContext,
  shopRecord: ShopWithPixelConfigs | null
): Promise<WebhookHandlerResult> {
  if (!shopRecord) {
    logger.warn(`Skipping ORDERS_PAID: shopRecord not found for ${context.shop}`);
    return {
      success: true,
      status: 200,
      message: "Shop not found",
    };
  }

  if (!context.payload) {
    logger.warn(`Invalid ORDERS_PAID payload from ${context.shop}, skipping`);
    return {
      success: false,
      status: 400,
      message: "Invalid payload",
    };
  }

  // Parse and validate payload
  const orderPayload = parseOrderWebhookPayload(context.payload, context.shop);
  if (!orderPayload) {
    logger.warn(`Invalid ORDERS_PAID payload from ${context.shop}, skipping`);
    return {
      success: false,
      status: 400,
      message: "Invalid payload",
    };
  }

  const orderId = normalizeOrderId(String(orderPayload.id));
  logger.info(
    `Processing ORDERS_PAID webhook for shop ${context.shop}, order ${orderId}`
  );

  // Check billing gate
  const billingCheck = await checkBillingGate(
    shopRecord.id,
    (shopRecord.plan || "free") as PlanId
  );

  if (!billingCheck.allowed) {
    logger.info(
      `Billing gate blocked order ${orderId}: ${billingCheck.reason}, ` +
        `usage=${billingCheck.usage.current}/${billingCheck.usage.limit}`
    );

    await handleBillingLimitExceeded(
      shopRecord,
      orderPayload,
      orderId,
      billingCheck
    );

    return {
      success: true,
      status: 200,
      message: "Billing limit exceeded",
      orderId,
    };
  }

  // Queue for processing
  await queueOrderForProcessing(shopRecord, orderPayload);

  logger.info(`Order ${orderId} queued for processing`);

  return {
    success: true,
    status: 200,
    message: "Order queued",
    orderId,
  };
}

