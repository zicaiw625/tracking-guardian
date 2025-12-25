/**
 * ORDERS_PAID Webhook Handler
 *
 * Processes order payment webhooks and queues conversions for platform sending.
 * 
 * P1-2: 集成 PII 提取和预哈希逻辑
 * - 当 shop.piiEnabled && shop.pcdAcknowledged 时，从订单中提取 PII
 * - 使用 SHA256 哈希后存入 capiInput.hashedUserData
 * - 平台 service 直接使用预哈希数据，不需要再次哈希
 */

import prisma from "../../db.server";
import { normalizeOrderId, generateEventId, hashValue, normalizeEmail, normalizePhone } from "../../utils/crypto.server";
import { checkBillingGate, type PlanId } from "../../services/billing.server";
import { logger } from "../../utils/logger.server";
import { parseOrderWebhookPayload } from "../../utils/webhook-validation";
import { ConversionLogStatus, JobStatus } from "../../types";
import type { OrderWebhookPayload } from "../../types";
import type { WebhookContext, WebhookHandlerResult, ShopWithPixelConfigs } from "../types";
import type { Prisma } from "@prisma/client";
import { extractPIISafely, logPIIStatus, type ExtractedPII } from "../../utils/pii";
import { PCD_CONFIG } from "../../utils/config";

// =============================================================================
// PII Hashing
// =============================================================================

/**
 * P1-2: 预哈希 PII 数据结构
 * 
 * 这些字段已经是 SHA256 哈希值，平台 service 可以直接使用。
 * 命名遵循 Meta CAPI 的规范（em = email hashed, ph = phone hashed 等）
 */
export interface HashedUserData {
  em?: string;  // hashed email
  ph?: string;  // hashed phone
  fn?: string;  // hashed first name (lowercase)
  ln?: string;  // hashed last name (lowercase)
  ct?: string;  // hashed city (lowercase, no spaces)
  st?: string;  // hashed state (lowercase)
  country?: string;  // hashed country code (lowercase)
  zp?: string;  // hashed zip (no spaces)
}

/**
 * P1-2: 将提取的 PII 转换为预哈希数据
 * 
 * 这在 webhook handler 层面完成，这样：
 * 1. 原始 PII 永远不会被存储到数据库
 * 2. 平台 service 可以直接使用哈希值
 */
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

// =============================================================================
// CAPI Input Builder
// =============================================================================

/**
 * Build minimal CAPI input from order payload.
 * 
 * P1-2: 当 piiEnabled && pcdAcknowledged 时，提取 PII 并预哈希。
 * 原始 PII 永远不会存储，只有哈希值会被保存到 capiInput.hashedUserData。
 */
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

  // P1-2: 提取并哈希 PII（仅当 piiEnabled && pcdAcknowledged）
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
    // P1-2: 预哈希的 PII 数据（如果可用）
    hashedUserData,
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
 * 
 * P1-2: 现在会根据 shop.piiEnabled && shop.pcdAcknowledged 提取和哈希 PII
 */
async function queueOrderForProcessing(
  shopRecord: ShopWithPixelConfigs,
  orderPayload: OrderWebhookPayload
): Promise<void> {
  const orderId = normalizeOrderId(String(orderPayload.id));
  
  // P1-2: 传入 PII 配置，让 buildCapiInput 决定是否提取 PII
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
