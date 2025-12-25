/**
 * Webhooks Route
 *
 * Entry point for Shopify webhooks. All processing logic is delegated
 * to the modular webhook handlers in app/webhooks/.
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { dispatchWebhook, type WebhookContext, type ShopWithPixelConfigs } from "../webhooks";

// =============================================================================
// Action Handler
// =============================================================================

export const action = async ({ request }: ActionFunctionArgs) => {
  // Authenticate the webhook
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
    // Handle authentication errors
    if (error instanceof Response) {
      logger.warn("[Webhook] HMAC validation failed - returning 401");
      return new Response("Unauthorized: Invalid HMAC", { status: 401 });
    }
    if (error instanceof SyntaxError) {
      logger.warn("[Webhook] Payload JSON parse error - returning 400");
      return new Response("Bad Request: Invalid JSON", { status: 400 });
    }
    logger.error("[Webhook] Authentication error:", error);
    return new Response("Webhook authentication failed", { status: 500 });
  }

  // Fetch shop record with pixel configs
  let shopRecord: ShopWithPixelConfigs | null = null;
  try {
    // P0-6: Early idempotency check to avoid unnecessary DB queries
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
    // Continue processing - some webhooks don't need shop record
  }

  // Dispatch to appropriate handler
  return dispatchWebhook(context, shopRecord, true);
};
