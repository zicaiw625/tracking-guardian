import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { dispatchWebhook, type WebhookContext, type ShopWithPixelConfigs } from "../webhooks";
import { tryAcquireWebhookLock } from "../webhooks/middleware/idempotency";

function getWebhookId(authResult: Awaited<ReturnType<typeof authenticate.webhook>>, request: Request): string | null {
  if (authResult && typeof authResult === "object" && "webhookId" in authResult && typeof authResult.webhookId === "string") {
    return authResult.webhookId;
  }
  return request.headers.get("X-Shopify-Event-Id") ?? request.headers.get("X-Shopify-Webhook-Id") ?? null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  let context: WebhookContext;
  try {
    const authResult = await authenticate.webhook(request);
    const webhookId = getWebhookId(authResult, request);
    context = {
      topic: authResult.topic,
      shop: authResult.shop,
      webhookId,
      payload: authResult.payload,
      admin: authResult.admin as WebhookContext["admin"],
      session: authResult.session,
    };
  } catch (error) {
    if (error instanceof Response) {
      const errorStatus = error.status;
      const topic = request.headers.get("X-Shopify-Topic") || "unknown";
      const isGDPRTopic = topic === "customers/data_request" || topic === "customers/redact" || topic === "shop/redact";
      if (errorStatus === 401) {
        return error;
      }
      const statusCode = isGDPRTopic ? 401 : 401;
      logger.warn(`[Webhook] HMAC validation failed - returning ${statusCode}`, {
        topic,
        shop: request.headers.get("X-Shopify-Shop-Domain") || "unknown",
        originalStatus: errorStatus,
        isGDPRTopic,
      });
      return new Response("Unauthorized: Invalid HMAC", { status: statusCode });
    }
    if (error instanceof SyntaxError) {
      logger.warn("[Webhook] Payload JSON parse error - returning 400");
      return new Response("Bad Request: Invalid JSON", { status: 400 });
    }
    logger.error("[Webhook] Authentication error:", error);
    return new Response("Bad Request: Webhook authentication failed", { status: 400 });
  }
  let shopRecord: ShopWithPixelConfigs | null = null;
  try {
    if (context.webhookId) {
      const lock = await tryAcquireWebhookLock(context.shop, context.webhookId, context.topic);
      if (!lock.acquired) {
        if (lock.existing) {
          logger.info(`[Webhook Idempotency] Skipping duplicate (early check): ${context.topic} for ${context.shop}`);
          return new Response("OK (duplicate)", { status: 200 });
        }
        logger.error(`[Webhook Idempotency] Failed to acquire lock (system error): ${context.topic} for ${context.shop}`);
        return new Response("Temporary error", { status: 500 });
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
