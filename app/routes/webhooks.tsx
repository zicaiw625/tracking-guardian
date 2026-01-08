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

    if (error instanceof Response) {
      const errorStatus = error.status;
      const topic = request.headers.get("X-Shopify-Topic") || "unknown";
      logger.warn(`[Webhook] HMAC validation failed - returning ${errorStatus}`, {
        topic,
        shop: request.headers.get("X-Shopify-Shop-Domain") || "unknown",
      });

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
