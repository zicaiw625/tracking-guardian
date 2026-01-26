import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { RATE_LIMIT_CONFIG } from "../utils/config.server";
import { checkRateLimitAsync, ipKeyExtractor } from "../middleware/rate-limit.server";
import { hashValueSync } from "../utils/crypto.server";
import { dispatchWebhook, type WebhookContext, type ShopWithPixelConfigs } from "../webhooks";
import { tryAcquireWebhookLock } from "../webhooks/middleware/idempotency";

function getWebhookId(authResult: Awaited<ReturnType<typeof authenticate.webhook>>, request: Request): string | null {
  if (authResult && typeof authResult === "object" && "webhookId" in authResult && typeof authResult.webhookId === "string") {
    return authResult.webhookId;
  }
  return request.headers.get("X-Shopify-Event-Id") ?? request.headers.get("X-Shopify-Webhook-Id") ?? null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const isProduction = process.env.NODE_ENV === "production";
  const ipKey = ipKeyExtractor(request);
  const rateLimit = await checkRateLimitAsync(
    ipKey,
    RATE_LIMIT_CONFIG.WEBHOOKS.maxRequests,
    RATE_LIMIT_CONFIG.WEBHOOKS.windowMs,
    isProduction
  );
  if (isProduction && rateLimit.usingFallback) {
    logger.error("[Webhook] Redis unavailable for rate limiting in production, rejecting request");
    return new Response("Service Unavailable", {
      status: 503,
      headers: {
        "Retry-After": "60",
      },
    });
  }
  if (!rateLimit.allowed) {
    const ipHash = ipKey === "untrusted" || ipKey === "unknown" ? ipKey : hashValueSync(ipKey).slice(0, 12);
    logger.warn("[Webhook] Rate limit exceeded", {
      ipHash,
      retryAfter: rateLimit.retryAfter,
    });
    return new Response("Too Many Requests", {
      status: 429,
      headers: {
        "Retry-After": String(rateLimit.retryAfter || 60),
        "X-RateLimit-Limit": String(RATE_LIMIT_CONFIG.WEBHOOKS.maxRequests),
        "X-RateLimit-Remaining": String(rateLimit.remaining || 0),
        "X-RateLimit-Reset": String(Math.ceil((rateLimit.resetAt || Date.now()) / 1000)),
      },
    });
  }
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
    const shopTopicKey = `webhook:${context.shop}:${context.topic}`;
    const shopTopicRateLimit = await checkRateLimitAsync(
      shopTopicKey,
      RATE_LIMIT_CONFIG.WEBHOOKS.maxRequests,
      RATE_LIMIT_CONFIG.WEBHOOKS.windowMs,
      isProduction
    );
    if (isProduction && shopTopicRateLimit.usingFallback) {
      logger.error("[Webhook] Redis unavailable for rate limiting in production, rejecting request", {
        shop: context.shop,
        topic: context.topic,
      });
      return new Response("Service Unavailable", {
        status: 503,
        headers: {
          "Retry-After": "60",
        },
      });
    }
    if (!shopTopicRateLimit.allowed) {
      logger.warn("[Webhook] Rate limit exceeded (shop+topic)", {
        shop: context.shop,
        topic: context.topic,
        retryAfter: shopTopicRateLimit.retryAfter,
      });
      return new Response("Too Many Requests", {
        status: 429,
        headers: {
          "Retry-After": String(shopTopicRateLimit.retryAfter || 60),
          "X-RateLimit-Limit": String(RATE_LIMIT_CONFIG.WEBHOOKS.maxRequests),
          "X-RateLimit-Remaining": String(shopTopicRateLimit.remaining || 0),
          "X-RateLimit-Reset": String(Math.ceil((shopTopicRateLimit.resetAt || Date.now()) / 1000)),
        },
      });
    }
  } catch (error) {
    if (error instanceof Response) {
      const errorStatus = error.status;
      const topic = request.headers.get("X-Shopify-Topic") || "unknown";
      const shopHeader = request.headers.get("X-Shopify-Shop-Domain") || "unknown";
      const webhookIdHeader = request.headers.get("X-Shopify-Webhook-Id") || request.headers.get("X-Shopify-Event-Id") || "unknown";
      if (errorStatus === 401) {
        return error;
      }
      logger.warn("[Webhook] HMAC validation failed - returning 401", {
        topic,
        shop: shopHeader,
        originalStatus: errorStatus,
        webhookId: webhookIdHeader,
        hint: "If this spikes unexpectedly, ensure no middleware/adapter reads or parses the request body before authenticate.webhook(request). Shopify webhook HMAC verification requires the raw body.",
      });
      return new Response("Unauthorized: Invalid HMAC", { status: 401 });
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
      select: {
        id: true,
        shopDomain: true,
        isActive: true,
        plan: true,
        consentStrategy: true,
        primaryDomain: true,
        storefrontDomains: true,
        ingestionSecret: true,
        previousIngestionSecret: true,
        previousSecretExpiry: true,
        pixelConfigs: {
          where: { isActive: true, serverSideEnabled: true },
          select: {
            id: true,
            shopId: true,
            platform: true,
            platformId: true,
            clientSideEnabled: true,
            serverSideEnabled: true,
            eventMappings: true,
            migrationStatus: true,
            migratedAt: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
            clientConfig: true,
            credentialsEncrypted: true,
            credentials_legacy: true,
            configVersion: true,
            environment: true,
            rollbackAllowed: true,
            displayName: true,
            priority: true,
          },
        },
      },
    }) as ShopWithPixelConfigs | null;
  } catch (error) {
    logger.error(`[Webhook] Failed to fetch shop record for ${context.shop}:`, error);
  }
  return dispatchWebhook(context, shopRecord, true);
};
