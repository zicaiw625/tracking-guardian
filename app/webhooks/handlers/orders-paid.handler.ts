

import prisma from "../../db.server";
import { normalizeOrderId, hashValue, normalizeEmail, normalizePhone } from "../../utils/crypto.server";
import { generateCanonicalEventId } from "../../services/event-normalizer.server";
import { checkBillingGate, type PlanId } from "../../services/billing.server";
import { logger } from "../../utils/logger.server";
import { parseOrderWebhookPayload } from "../../utils/webhook-validation";
import { ConversionLogStatus, JobStatus } from "../../types";
import type { OrderWebhookPayload } from "../../types";
import type { WebhookContext, WebhookHandlerResult, ShopWithPixelConfigs } from "../types";
import type { Prisma } from "@prisma/client";
import { extractPIISafely, logPIIStatus, type ExtractedPII } from "../../utils/pii";
import { PCD_CONFIG } from "../../utils/config";

export interface HashedUserData {
  em?: string;
  ph?: string;
  fn?: string;
  ln?: string;
  ct?: string;
  st?: string;
  country?: string;
  zp?: string;
}

async function hashPII(pii: ExtractedPII): Promise<HashedUserData> {
  const hashed: HashedUserData = {};

  if (pii.email) {
    hashed.em = await hashValue(normalizeEmail(pii.email));
  }

  if (pii.phone) {
    hashed.ph = await hashValue(normalizePhone(pii.phone));
  }

  if (pii.firstName) {
    const normalized = pii.firstName.toLowerCase().trim();
    if (normalized) {
      hashed.fn = await hashValue(normalized);
    }
  }

  if (pii.lastName) {
    const normalized = pii.lastName.toLowerCase().trim();
    if (normalized) {
      hashed.ln = await hashValue(normalized);
    }
  }

  if (pii.city) {
    const normalized = pii.city.toLowerCase().replace(/\s/g, "");
    if (normalized) {
      hashed.ct = await hashValue(normalized);
    }
  }

  if (pii.state) {
    const normalized = pii.state.toLowerCase().trim();
    if (normalized) {
      hashed.st = await hashValue(normalized);
    }
  }

  if (pii.country) {
    const normalized = pii.country.toLowerCase().trim();
    if (normalized) {
      hashed.country = await hashValue(normalized);
    }
  }

  if (pii.zip) {
    const normalized = pii.zip.replace(/\s/g, "");
    if (normalized) {
      hashed.zp = await hashValue(normalized);
    }
  }

  return hashed;
}

async function buildCapiInput(
  orderPayload: OrderWebhookPayload,
  orderId: string,
  shopConfig: { piiEnabled: boolean; pcdAcknowledged: boolean }
): Promise<Record<string, unknown>> {
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

  let hashedUserData: HashedUserData | null = null;
  const pcdApproved = PCD_CONFIG.APPROVED;
  const shouldExtractPii = shopConfig.piiEnabled && shopConfig.pcdAcknowledged && pcdApproved;

  if (shopConfig.piiEnabled && !pcdApproved) {
    logger.info(`[P1-2] Skipping PII extraction for order ${orderId}: PCD approval not granted`);
  }

  if (shouldExtractPii) {
    const pii = extractPIISafely(orderPayload, true);
    logPIIStatus(orderId, pii, true);

    if (Object.keys(pii).length > 0) {
      hashedUserData = await hashPII(pii);
      logger.debug(`[P1-2] PII hashed for order ${orderId}`, {
        fieldsHashed: Object.keys(hashedUserData).length,
      });
    }
  }

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

    hashedUserData,
  };
}

function safeParseFloat(value: string | number | undefined | null): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === "number") return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

async function handleBillingLimitExceeded(
  shopRecord: ShopWithPixelConfigs,
  orderPayload: OrderWebhookPayload,
  orderId: string,
  billingCheck: { usage: { current: number; limit: number } }
): Promise<void> {
  // 使用与 pixel 端相同的 event_id 生成逻辑，确保 client/server 去重一致
  // 对于 purchase 事件，需要包含 items 信息以生成一致的 event_id
  // 注意：pixel 端优先使用 variantId（因为 checkout.lineItems 的 id 字段通常是 variant_id），
  // 所以这里也要优先使用 variant_id，以保持一致性
  const items = orderPayload.line_items?.map((item) => ({
    id: String(item.variant_id || item.product_id || ""),
    quantity: item.quantity || 1,
  })).filter(item => item.id) || [];
  
  const blockedEventId = generateCanonicalEventId(
    orderId,
    orderPayload.checkout_token || null,
    "purchase",
    shopRecord.shopDomain,
    items
  );

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

async function queueOrderForProcessing(
  shopRecord: ShopWithPixelConfigs,
  orderPayload: OrderWebhookPayload
): Promise<void> {
  const orderId = normalizeOrderId(String(orderPayload.id));

  const capiInput = await buildCapiInput(orderPayload, orderId, {
    piiEnabled: shopRecord.piiEnabled ?? false,
    pcdAcknowledged: shopRecord.pcdAcknowledged ?? false,
  }) as Prisma.InputJsonValue;

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

  await queueOrderForProcessing(shopRecord, orderPayload);

  logger.info(`Order ${orderId} queued for processing`);

  return {
    success: true,
    status: 200,
    message: "Order queued",
    orderId,
  };
}
