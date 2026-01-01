

import { logger } from "../utils/logger.server";
import { WebhookStatus } from "../types";
import {
  handleOrdersPaid,
  handleAppUninstalled,
  handleCustomersDataRequest,
  handleCustomersRedact,
  handleShopRedact,
  handleOrdersCancelled,
  handleOrdersUpdated,
  handleRefundsCreate,
} from "./handlers";
import { tryAcquireWebhookLock, updateWebhookStatus } from "./middleware";
import type { WebhookContext, WebhookHandlerResult, ShopWithPixelConfigs } from "./types";

// Convert Shopify webhook topic format (e.g., "orders/paid") to handler key (e.g., "ORDERS_PAID")
function normalizeTopic(topic: string): string {
  return topic.toUpperCase().replace(/\//g, "_");
}

const WEBHOOK_HANDLERS: Record<
  string,
  (
    context: WebhookContext,
    shopRecord: ShopWithPixelConfigs | null
  ) => Promise<WebhookHandlerResult>
> = {
  ORDERS_PAID: handleOrdersPaid,
  APP_UNINSTALLED: handleAppUninstalled,
  CUSTOMERS_DATA_REQUEST: (ctx) => handleCustomersDataRequest(ctx),
  CUSTOMERS_REDACT: (ctx) => handleCustomersRedact(ctx),
  SHOP_REDACT: (ctx) => handleShopRedact(ctx),
  // P1-02: Order lifecycle webhooks for verification
  ORDERS_CANCELLED: handleOrdersCancelled,
  ORDERS_UPDATED: handleOrdersUpdated,
  REFUNDS_CREATE: handleRefundsCreate,
};

const GDPR_TOPICS = new Set([
  "CUSTOMERS_DATA_REQUEST",
  "CUSTOMERS_REDACT",
  "SHOP_REDACT",
]);

export async function dispatchWebhook(
  context: WebhookContext,
  shopRecord: ShopWithPixelConfigs | null,
  lockAcquired: boolean = false
): Promise<Response> {
  const { topic, shop, webhookId } = context;

  if (webhookId && !lockAcquired) {
    const lock = await tryAcquireWebhookLock(shop, webhookId, topic);
    if (!lock.acquired) {
      logger.info(`[Webhook Idempotency] Skipping duplicate: ${topic} for ${shop}`);
      return new Response("OK (duplicate)", { status: 200 });
    }
  }

  if (!context.admin && !GDPR_TOPICS.has(normalizeTopic(topic))) {
    logger.info(`Webhook ${topic} received for uninstalled shop ${shop}`);
    return new Response("OK", { status: 200 });
  }

  const normalizedTopic = normalizeTopic(topic);
  const handler = WEBHOOK_HANDLERS[normalizedTopic];

  if (!handler) {
    logger.warn(
      `Unexpected webhook topic received: ${topic} from ${shop}. ` +
        `This may indicate a configuration mismatch or a legacy subscription. ` +
        `Responding 200 to prevent Shopify retries.`
    );

    if (webhookId) {
      await updateWebhookStatus(shop, webhookId, topic, WebhookStatus.PROCESSED);
    }

    return new Response("OK", { status: 200 });
  }

  try {
    const result = await handler(context, shopRecord);

    if (webhookId) {
      const status = result.success
        ? WebhookStatus.PROCESSED
        : WebhookStatus.FAILED;
      await updateWebhookStatus(shop, webhookId, topic, status, result.orderId);
    }

    return new Response(result.message, { status: result.status });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error(`Webhook ${topic} handler error for ${shop}:`, {
      message: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });

    if (webhookId) {
      await updateWebhookStatus(shop, webhookId, topic, WebhookStatus.FAILED);
    }

    return new Response("Webhook processing failed", { status: 500 });
  }
}

