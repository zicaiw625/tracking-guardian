/**
 * Webhook Dispatcher
 *
 * Routes incoming webhooks to appropriate handlers based on topic.
 */

import { logger } from "../utils/logger.server";
import { WebhookStatus } from "../types";
import {
  handleOrdersPaid,
  handleAppUninstalled,
  handleCustomersDataRequest,
  handleCustomersRedact,
  handleShopRedact,
} from "./handlers";
import { tryAcquireWebhookLock, updateWebhookStatus } from "./middleware";
import type { WebhookContext, WebhookHandlerResult, ShopWithPixelConfigs } from "./types";

// =============================================================================
// Topic to Handler Mapping
// =============================================================================

/**
 * Map of webhook topics to their handlers
 */
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
};

/**
 * Topics that don't require shop record to be active
 */
const GDPR_TOPICS = new Set([
  "CUSTOMERS_DATA_REQUEST",
  "CUSTOMERS_REDACT",
  "SHOP_REDACT",
]);

// =============================================================================
// Dispatcher
// =============================================================================

/**
 * Dispatch a webhook to the appropriate handler
 */
export async function dispatchWebhook(
  context: WebhookContext,
  shopRecord: ShopWithPixelConfigs | null,
  lockAcquired: boolean = false
): Promise<Response> {
  const { topic, shop, webhookId } = context;

  // Check for idempotency
  if (webhookId && !lockAcquired) {
    const lock = await tryAcquireWebhookLock(shop, webhookId, topic);
    if (!lock.acquired) {
      logger.info(`[Webhook Idempotency] Skipping duplicate: ${topic} for ${shop}`);
      return new Response("OK (duplicate)", { status: 200 });
    }
  }

  // Skip processing for uninstalled shops (except GDPR webhooks)
  if (!context.admin && !GDPR_TOPICS.has(topic)) {
    logger.info(`Webhook ${topic} received for uninstalled shop ${shop}`);
    return new Response("OK", { status: 200 });
  }

  // Find handler for this topic
  const handler = WEBHOOK_HANDLERS[topic];

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

  // Execute handler
  try {
    const result = await handler(context, shopRecord);

    // Update webhook status
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

