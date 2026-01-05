

import { logger } from "../utils/logger.server";
import { WebhookStatus } from "../types";
import {
  handleAppUninstalled,
  handleCustomersDataRequest,
  handleCustomersRedact,
  handleShopRedact,
} from "./handlers";
import { tryAcquireWebhookLock, updateWebhookStatus } from "./middleware";
import type { WebhookContext, WebhookHandlerResult, ShopWithPixelConfigs } from "./types";

function normalizeTopic(topic: string): string {
  return topic.toUpperCase().replace(/\//g, "_");
}

// P0-1: v1.0 版本不包含任何 PCD/PII 处理，因此移除所有订单相关 webhook handlers
// v1.0 仅依赖 Web Pixels 标准事件，不处理订单 webhooks
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

  // P0-2: GDPR webhooks 必须处理，即使 shop 不存在或已卸载
  // 对于 GDPR webhooks，即使 shop 不存在也要返回 200，避免 Shopify 重试
  if (!context.admin && !GDPR_TOPICS.has(normalizeTopic(topic))) {
    logger.info(`Webhook ${topic} received for uninstalled shop ${shop}`);
    return new Response("OK", { status: 200 });
  }

  // P0-2: 对于 GDPR webhooks，即使 shopRecord 为 null 也要处理
  // 这确保了对不存在的 shop 也能正确响应（返回 200）
  if (GDPR_TOPICS.has(normalizeTopic(topic)) && !shopRecord) {
    logger.info(`GDPR webhook ${topic} received for non-existent shop ${shop} - acknowledging`);
    // 仍然调用 handler，让 handler 决定如何处理（通常会返回 200）
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

    // P0-2: GDPR webhooks 的业务逻辑失败必须返回 200，避免重试风暴
    // 注意：HMAC 校验失败已在 webhooks.tsx 中返回 401（认证层面的问题），不会到达这里
    // 这里只处理业务逻辑失败的情况（如无效 payload、处理错误等），返回 200 避免重试
    // 但 HMAC 校验失败是认证问题，必须返回 401，不能转换为 200
    const isGDPR = GDPR_TOPICS.has(normalizedTopic);
    if (isGDPR && !result.success) {
      logger.warn(`GDPR webhook ${topic} processing failed for ${shop}, but returning 200 to prevent retries`, {
        message: result.message,
        status: result.status,
        // P0-2: 记录 request_id 和 topic，但不记录 PII
        webhookId,
      });
      return new Response("GDPR webhook acknowledged", { status: 200 });
    }

    return new Response(result.message, { status: result.status });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const isGDPR = GDPR_TOPICS.has(normalizedTopic);
    
    // P0-2: GDPR webhooks 的业务逻辑异常也要返回 200，避免 Shopify 重试风暴
    // 注意：HMAC 校验失败是认证问题，已在 webhooks.tsx 中返回 401，不会到达这里
    // 这里只处理 handler 内部抛出的业务逻辑异常
    if (isGDPR) {
      logger.error(`GDPR webhook ${topic} handler threw error for ${shop}, but returning 200 to prevent retries:`, {
        message: errorMessage,
        webhookId,
        // P0-2: 不记录 stack trace 中的敏感信息（PII）
        // 但记录 webhookId 和 topic 用于审计
      });

      if (webhookId) {
        await updateWebhookStatus(shop, webhookId, topic, WebhookStatus.PROCESSED);
      }

      return new Response("GDPR webhook acknowledged", { status: 200 });
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

