

import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { dispatchWebhook, type WebhookContext, type ShopWithPixelConfigs } from "../webhooks";
import { tryAcquireWebhookLock } from "../webhooks/middleware/idempotency";

export const action = async ({ request }: ActionFunctionArgs) => {

  let context: WebhookContext;
  try {
    const authResult = await authenticate.webhook(request);
    context = {
      topic: authResult.topic,
      shop: authResult.shop,
      webhookId: request.headers.get("X-Shopify-Webhook-Id"),
      payload: authResult.payload,
      admin: authResult.admin as WebhookContext["admin"],
      session: authResult.session,
    };
  } catch (error) {
    // P0-2: HMAC 校验失败必须返回 400/401（而不是 200），否则会被拒审
    // Shopify 审查/自动化检查会测试这个（社区里反复有人栽）
    // 注意：HMAC 校验失败是认证层面的问题，应该返回 401，即使是 GDPR webhooks 也不例外
    // GDPR webhooks 的业务逻辑失败才返回 200 避免重试风暴，但认证失败必须返回 401
    if (error instanceof Response) {
      const errorStatus = error.status;
      const topic = request.headers.get("X-Shopify-Topic") || "unknown";
      logger.warn(`[Webhook] HMAC validation failed - returning ${errorStatus}`, {
        topic,
        shop: request.headers.get("X-Shopify-Shop-Domain") || "unknown",
      });
      
      // P0-2: HMAC 校验失败必须返回 401（认证层面的问题）
      // 即使是 GDPR webhooks，HMAC 校验失败也应该返回 401
      // 只有业务逻辑失败时，GDPR webhooks 才返回 200 避免重试风暴
      if (errorStatus === 401 || errorStatus === 403) {
        return new Response("Unauthorized: Invalid HMAC", { status: 401 });
      }
      return error;
    }
    if (error instanceof SyntaxError) {
      logger.warn("[Webhook] Payload JSON parse error - returning 400");
      return new Response("Bad Request: Invalid JSON", { status: 400 });
    }
    logger.error("[Webhook] Authentication error:", error);
    return new Response("Webhook authentication failed", { status: 500 });
  }

  let shopRecord: ShopWithPixelConfigs | null = null;
  try {

    if (context.webhookId) {
      const lock = await tryAcquireWebhookLock(context.shop, context.webhookId, context.topic);
      if (!lock.acquired) {
        logger.info(`[Webhook Idempotency] Skipping duplicate (early check): ${context.topic} for ${context.shop}`);
        return new Response("OK (duplicate)", { status: 200 });
      }
    }

    shopRecord = await prisma.shop.findUnique({
      where: { shopDomain: context.shop },
      include: {
        pixelConfigs: {
          where: { isActive: true, serverSideEnabled: true },
        },
      },
    });
  } catch (error) {
    logger.error(`[Webhook] Failed to fetch shop record for ${context.shop}:`, error);

  }

  return dispatchWebhook(context, shopRecord, true);
};
