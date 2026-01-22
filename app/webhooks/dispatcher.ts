import { logger } from "../utils/logger.server";
import { WebhookStatus } from "../types";
import {
  handleAppUninstalled,
  handleCustomersDataRequest,
  handleCustomersRedact,
  handleShopRedact,
  handleOrdersCreate,
  handleOrdersUpdated,
  handleOrdersCancelled,
  handleOrdersEdited,
  handleRefundsCreate,
} from "./handlers";
import { tryAcquireWebhookLock, updateWebhookStatus } from "./middleware";
import type { WebhookContext, WebhookHandlerResult, ShopWithPixelConfigs } from "./types";

function normalizeTopic(topic: string): string {
  return topic
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const WEBHOOK_HANDLERS: Record<
  string,
  (
    context: WebhookContext,
    shopRecord: ShopWithPixelConfigs | null
  ) => Promise<WebhookHandlerResult>
> = {
  APP_UNINSTALLED: handleAppUninstalled,
  CUSTOMERS_DATA_REQUEST: (ctx) => handleCustomersDataRequest(ctx),
  CUSTOMERS_REDACT: (ctx) => handleCustomersRedact(ctx),
  SHOP_REDACT: (ctx) => handleShopRedact(ctx),
  ORDERS_CREATE: (ctx) => handleOrdersCreate(ctx),
  ORDERS_UPDATED: (ctx) => handleOrdersUpdated(ctx),
  ORDERS_CANCELLED: (ctx) => handleOrdersCancelled(ctx),
  ORDERS_EDITED: (ctx) => handleOrdersEdited(ctx),
  REFUNDS_CREATE: (ctx) => handleRefundsCreate(ctx),
};

const GDPR_TOPICS = new Set([
  "CUSTOMERS_DATA_REQUEST",
  "CUSTOMERS_REDACT",
  "SHOP_REDACT",
]);

const ORDERS_REFUNDS_TOPICS = new Set([
  "ORDERS_CREATE",
  "ORDERS_UPDATED",
  "ORDERS_CANCELLED",
  "ORDERS_EDITED",
  "REFUNDS_CREATE",
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
  if (GDPR_TOPICS.has(normalizeTopic(topic)) && !shopRecord) {
    logger.info(`GDPR webhook ${topic} received for non-existent shop ${shop} - acknowledging`);
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
    const isGDPR = GDPR_TOPICS.has(normalizedTopic);
    if (webhookId) {
      const status = result.success
        ? WebhookStatus.PROCESSED
        : WebhookStatus.FAILED;
      await updateWebhookStatus(shop, webhookId, topic, status, result.orderId);
    }
    if (isGDPR && !result.success) {
      logger.error(`GDPR webhook ${topic} processing failed for ${shop}, returning 500 to allow Shopify retry`, {
        message: result.message,
        status: result.status,
        webhookId,
      });
      return new Response(result.message || "GDPR webhook processing failed", { status: 500 });
    }
    if (!result.success && !isGDPR) {
      logger.error(`Webhook ${topic} processing failed for ${shop}`, {
        message: result.message,
        status: result.status,
        webhookId,
      });
      return new Response(result.message || "Webhook processing failed", { status: result.status || 500 });
    }
    return new Response(result.message, { status: result.status });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const isGDPR = GDPR_TOPICS.has(normalizedTopic);
    if (isGDPR) {
      logger.error(`GDPR webhook ${topic} handler threw error for ${shop}, returning 500 to allow Shopify retry:`, {
        message: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        webhookId,
      });
      if (webhookId) {
        await updateWebhookStatus(shop, webhookId, topic, WebhookStatus.FAILED);
      }
      return new Response("GDPR webhook processing failed", { status: 500 });
    }
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
