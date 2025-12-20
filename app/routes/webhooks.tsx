/**
 * Webhook Handler for Shopify Events
 * 
 * P0-1: Billing gate - checks usage limits before processing
 * P0-2: Fast ACK + async queue - immediately returns 200, processes via worker
 * P0-3: Uses PixelEventReceipt for consent decisions
 * P0-5: Implements consent strategy (strict/balanced/weak)
 * P0-5: Webhook idempotency via WebhookLog fingerprinting
 * P0-6: PII null-safety handling
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { generateEventId, normalizeOrderId } from "../utils/crypto";
import { 
  checkBillingGate, 
  incrementMonthlyUsage,
  type PlanId 
} from "../services/billing.server";
// P1-05: Use logger instead of console for proper sanitization
import { logger } from "../utils/logger";
import type {
  OrderWebhookPayload,
  PixelConfigData,
} from "../types";
import type { Shop, PixelConfig } from "@prisma/client";
// P0-07: Consent evaluation moved to worker (api.cron.tsx / retry.server.ts)
// import { evaluatePlatformConsentWithStrategy, type ConsentState } from "../utils/platform-consent";

/**
 * P0-06: Atomic webhook lock acquisition
 * 
 * FIXED: Uses "insert-first" strategy to prevent race conditions.
 * Instead of "check then insert", we "insert then catch conflict".
 * 
 * This ensures that concurrent requests for the same webhook will:
 * 1. Both try to INSERT the lock record
 * 2. Only one succeeds (due to unique constraint)
 * 3. The other gets a P2002 error and knows it's a duplicate
 * 
 * @returns { acquired: true } if lock was acquired (proceed with processing)
 * @returns { acquired: false, existing: true } if webhook already processed
 */
async function tryAcquireWebhookLock(
  shopDomain: string,
  webhookId: string | null,
  topic: string,
  orderId?: string
): Promise<{ acquired: boolean; existing?: boolean }> {
  if (!webhookId) {
    // No webhook ID means we can't deduplicate - allow processing
    // This shouldn't happen with valid Shopify webhooks
    logger.warn(`[Webhook] Missing X-Shopify-Webhook-Id for topic ${topic} from ${shopDomain}`);
    return { acquired: true };
  }
  
  try {
    // P0-06: Attempt to insert lock record first (atomic operation)
    await prisma.webhookLog.create({
      data: {
        shopDomain,
        webhookId,
        topic,
        orderId,
        status: "processing",
        receivedAt: new Date(),
      },
    });
    return { acquired: true };
  } catch (error) {
    // P2002 is Prisma's unique constraint violation error
    if ((error as { code?: string })?.code === "P2002") {
      logger.info(
        `[Webhook Idempotency] Duplicate webhook detected: ${topic} for ${shopDomain}, ` +
        `webhookId=${webhookId}`
      );
      return { acquired: false, existing: true };
    }
    // For other errors, log and allow processing (fail-open)
    logger.error(`[Webhook] Failed to acquire lock: ${error}`);
    return { acquired: true };
  }
}

/**
 * P0-06: Update webhook status after processing
 */
async function updateWebhookStatus(
  shopDomain: string,
  webhookId: string,
  topic: string,
  status: "processed" | "failed",
  orderId?: string
): Promise<void> {
  try {
    await prisma.webhookLog.update({
      where: {
        shopDomain_webhookId_topic: {
          shopDomain,
          webhookId,
          topic,
        },
      },
      data: {
        status,
        orderId,
        processedAt: new Date(),
      },
    });
  } catch (error) {
    // Log but don't throw - webhook was already processed
    logger.error(`[Webhook] Failed to update status: ${error}`);
  }
}

interface ShopWithPixelConfigs extends Shop {
  pixelConfigs: PixelConfig[];
}

export const action = async ({ request }: ActionFunctionArgs) => {
  // P0-02: Variables to hold authenticated data
  let topic: string;
  let shop: string;
  let session: unknown;
  let admin: unknown;
  let payload: unknown;
  
  // P0-02: Enhanced error handling for HMAC validation and JSON parsing
  try {
    const authResult = await authenticate.webhook(request);
    topic = authResult.topic;
    shop = authResult.shop;
    session = authResult.session;
    admin = authResult.admin;
    payload = authResult.payload;
  } catch (error) {
    // P0-02: Handle HMAC validation failure - return 401
    if (error instanceof Response) {
      // Shopify's authenticate.webhook throws Response on auth failure
      logger.warn("[Webhook] HMAC validation failed - returning 401");
      return new Response("Unauthorized", { status: 401 });
    }
    // P0-02: Handle JSON parsing errors - return 400
    if (error instanceof SyntaxError) {
      logger.warn("[Webhook] Payload JSON parse error - returning 400");
      return new Response("Bad Request: Invalid JSON", { status: 400 });
    }
    // P0-02: For other errors, log and return 500
    logger.error("[Webhook] Authentication error:", error);
    return new Response("Webhook authentication failed", { status: 500 });
  }

  try {
    // P0-06: Get webhook ID from headers for idempotency
    const webhookId = request.headers.get("X-Shopify-Webhook-Id");
    
    // P0-06: Try to acquire lock FIRST (atomic operation to prevent race conditions)
    // This replaces the previous "check then insert" pattern
    if (webhookId) {
      const lock = await tryAcquireWebhookLock(shop, webhookId, topic);
      if (!lock.acquired) {
        // Already processed - return 200 to acknowledge receipt
        logger.info(`[Webhook Idempotency] Skipping duplicate: ${topic} for ${shop}`);
        return new Response("OK (duplicate)", { status: 200 });
      }
    }

    if (!admin && topic !== "SHOP_REDACT" && topic !== "CUSTOMERS_DATA_REQUEST" && topic !== "CUSTOMERS_REDACT") {
      // The admin context isn't returned if the webhook fired after a shop uninstalled
      logger.info(`Webhook ${topic} received for uninstalled shop ${shop}`);
      return new Response("OK", { status: 200 });
    }

    // Get shop from our database with billing info
    const shopRecord = await prisma.shop.findUnique({
      where: { shopDomain: shop },
      include: {
        pixelConfigs: {
          where: { isActive: true, serverSideEnabled: true },
        },
      },
    });

    switch (topic) {
      case "APP_UNINSTALLED":
        logger.info(`Processing APP_UNINSTALLED for shop ${shop}`);
        if (session) {
          await prisma.session.deleteMany({ where: { shop } });
        }
        // Mark shop as uninstalled
        if (shopRecord) {
          await prisma.shop.update({
            where: { id: shopRecord.id },
            data: {
              isActive: false,
              uninstalledAt: new Date(),
            },
          });
        }
        // P0-5: Record webhook as processed
        if (webhookId) {
          await updateWebhookStatus(shop, webhookId, topic, "processed");
        }
        logger.info(`Successfully processed APP_UNINSTALLED for shop ${shop}`);
        break;

      case "ORDERS_PAID":
        // P0-2: Fast ACK + async queue pattern
        // This handler quickly validates and queues the order, then returns 200
        // Actual CAPI sending is done by the worker (api.cron.tsx)
        if (shopRecord && payload) {
          const orderPayload = payload as OrderWebhookPayload;
          const orderId = normalizeOrderId(String(orderPayload.id));
          logger.info(`Processing ${topic} webhook for shop ${shop}, order ${orderId}`);
          
          // P0-1: Check billing gate BEFORE processing
          const billingCheck = await checkBillingGate(
            shopRecord.id,
            (shopRecord.plan || "free") as PlanId
          );
          
          if (!billingCheck.allowed) {
            logger.info(
              `Billing gate blocked order ${orderId}: ${billingCheck.reason}, ` +
              `usage=${billingCheck.usage.current}/${billingCheck.usage.limit}`
            );
            
            // Log the blocked order for tracking (using ConversionLog as fallback until migration)
            // P0-1: Generate eventId for consistency
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
                  orderNumber: orderPayload.order_number ? String(orderPayload.order_number) : null,
                  orderValue: parseFloat(orderPayload.total_price || "0"),
                  currency: orderPayload.currency || "USD",
                  platform: pixelConfig.platform,
                  eventType: "purchase",
                  eventId: blockedEventId,
                  status: "failed",
                  errorMessage: `Monthly limit exceeded: ${billingCheck.usage.current}/${billingCheck.usage.limit}`,
                },
                update: {
                  // P0-3: Update all key fields
                  orderNumber: orderPayload.order_number ? String(orderPayload.order_number) : null,
                  orderValue: parseFloat(orderPayload.total_price || "0"),
                  currency: orderPayload.currency || "USD",
                  eventId: blockedEventId,
                  status: "failed",
                  errorMessage: `Monthly limit exceeded: ${billingCheck.usage.current}/${billingCheck.usage.limit}`,
                },
              });
            }
            
            // P0-5: Record webhook as processed (even if blocked by billing)
            if (webhookId) {
              await updateWebhookStatus(shop, webhookId, topic, "processed", orderId);
            }
            
            // Still return 200 to acknowledge receipt
            break;
          }
          
          // P0-2: Queue the order for async processing
          await queueOrderForProcessing(
            shopRecord as ShopWithPixelConfigs,
            orderPayload
          );
          
          // P0-5: Record webhook as processed
          if (webhookId) {
            await updateWebhookStatus(shop, webhookId, topic, "processed", orderId);
          }
          
          logger.info(`Order ${orderId} queued for processing`);
        } else {
          logger.warn(`Skipping ${topic}: shopRecord=${!!shopRecord}, payload=${!!payload}`);
        }
        break;
      
      case "ORDERS_CREATE":
        // NOTE: ORDERS_CREATE is intentionally not processed for conversion tracking
        // We use ORDERS_PAID instead to ensure payment is confirmed
        logger.info(`ORDERS_CREATE received for shop ${shop}, order ${(payload as { id?: number })?.id} - skipping (using ORDERS_PAID instead)`);
        break;

      case "ORDERS_UPDATED":
        // Handle order updates if needed (e.g., refunds)
        logger.info(`Order updated for shop ${shop}: order_id=${(payload as { id?: number })?.id}`);
        break;

      case "CUSTOMERS_DATA_REQUEST":
        // P0-08: Customer data request - Queue for async processing
        // Shopify requires quick acknowledgment, actual processing done by cron
        logger.info(`GDPR data request received for shop ${shop}`);
        try {
          await prisma.gDPRJob.create({
            data: {
              shopDomain: shop,
              jobType: "data_request",
              payload: payload as object,
              status: "queued",
            },
          });
          logger.info(`GDPR data request queued for ${shop}`);
        } catch (queueError) {
          logger.error("Failed to queue GDPR data request:", queueError);
          // Still return 200 - Shopify expects acknowledgment
        }
        break;

      case "CUSTOMERS_REDACT":
        // P0-08: Customer data deletion request - Queue for async processing
        // This is a mandatory webhook for GDPR compliance
        logger.info(`GDPR customer redact request for shop ${shop}`);
        try {
          await prisma.gDPRJob.create({
            data: {
              shopDomain: shop,
              jobType: "customer_redact",
              payload: payload as object,
              status: "queued",
            },
          });
          logger.info(`GDPR customer redact queued for ${shop}`);
        } catch (queueError) {
          logger.error("Failed to queue GDPR customer redact:", queueError);
          // Still return 200 - Shopify expects acknowledgment
        }
        break;

      case "SHOP_REDACT":
        // P0-08: Shop data deletion - Queue for async processing
        // This is a mandatory webhook - happens 48 hours after uninstall
        logger.info(`GDPR shop redact request for shop ${shop}`);
        try {
          await prisma.gDPRJob.create({
            data: {
              shopDomain: shop,
              jobType: "shop_redact",
              payload: payload as object,
              status: "queued",
            },
          });
          logger.info(`GDPR shop redact queued for ${shop}`);
        } catch (queueError) {
          logger.error("Failed to queue GDPR shop redact:", queueError);
          // Still return 200 - Shopify expects acknowledgment
        }
        break;

      default:
        logger.warn(`Unhandled webhook topic: ${topic}`);
        return new Response(`Unhandled webhook topic: ${topic}`, { status: 404 });
    }

    // Return success response
    return new Response("OK", { status: 200 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    // Log error with stack trace for debugging, but don't expose details to client
    logger.error("Webhook processing error:", {
      message: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    // Return 500 to signal Shopify to retry
    // Don't expose internal error details in response
    return new Response("Webhook processing failed", { status: 500 });
  }
};

/**
 * P0-05: Build minimal CAPI input from order payload
 * P0-03: Now includes checkoutToken for PixelEventReceipt matching
 * P1-01: Enhanced for audit trail and reproducibility
 * Only includes fields necessary for platform API calls - NO raw PII
 */
function buildCapiInput(orderPayload: OrderWebhookPayload, orderId: string): object {
  // Extract line items summary (no PII)
  // Shopify uses 'title' for product name, but some versions use 'name'
  const items = orderPayload.line_items?.map((item) => ({
    productId: item.product_id ? String(item.product_id) : undefined,
    variantId: item.variant_id ? String(item.variant_id) : undefined,
    sku: item.sku || undefined,
    name: item.title || item.name || "",
    quantity: item.quantity || 1,
    price: parseFloat(item.price || "0"),
  })) || [];

  // P1-01: Calculate content_ids for platform API (product IDs)
  const contentIds = items
    .map(item => item.productId)
    .filter((id): id is string => !!id);

  return {
    // Core order data
    orderId,
    value: parseFloat(orderPayload.total_price || "0"),
    currency: orderPayload.currency || "USD",
    orderNumber: orderPayload.order_number ? String(orderPayload.order_number) : null,
    
    // Line items for product-level attribution
    items,
    // P1-01: Content IDs for Meta/TikTok content parameters
    contentIds,
    numItems: items.reduce((sum, item) => sum + item.quantity, 0),
    
    // P0-05: Store tax and shipping for accurate conversion value
    tax: parseFloat(orderPayload.total_tax || "0"),
    shipping: parseFloat(orderPayload.total_shipping_price_set?.shop_money?.amount || "0"),
    
    // P1-01: Timestamps for audit trail
    processedAt: orderPayload.processed_at || new Date().toISOString(),
    webhookReceivedAt: new Date().toISOString(),
    
    // P0-03: Include checkout_token for PixelEventReceipt fallback matching
    checkoutToken: orderPayload.checkout_token || null,
    
    // P1-01: Shopify order ID (numeric) for reference
    shopifyOrderId: orderPayload.id,
    
    // P0-05: Do NOT include raw email/phone/address - only hashed if piiEnabled
  };
}

/**
 * P0-07: Queue order for async processing with O(1) response time
 * 
 * CRITICAL: This function must return as fast as possible to avoid webhook timeouts.
 * Shopify webhooks have a 5-second timeout and will retry on slow responses.
 * 
 * Strategy:
 * 1. Single ConversionJob upsert (not per-platform)
 * 2. Defer all platform-specific logic to the cron worker
 * 3. Minimal DB queries - just the essential upsert
 * 
 * P0-05: Now stores capiInput (minimal fields) instead of full orderPayload
 * 
 * The cron worker (api.cron.tsx) will:
 * - Query PixelEventReceipt for consent
 * - Evaluate consent per platform
 * - Create/update ConversionLog entries
 * - Send to CAPI endpoints
 */
async function queueOrderForProcessing(
  shopRecord: ShopWithPixelConfigs,
  orderPayload: OrderWebhookPayload
): Promise<void> {
  const orderId = normalizeOrderId(String(orderPayload.id));
  
  // P0-05: Build minimal CAPI input - no raw PII stored
  const capiInput = buildCapiInput(orderPayload, orderId);
  
  // P0-07: Single upsert to ConversionJob - minimal I/O
  // All consent checking and platform logic deferred to worker
  try {
    // P0-05: Build create/update data with capiInput
    // Note: After running `prisma migrate`, capiInput will be a proper field
    // For now, we include it in the data object for forward compatibility
    const createData = {
      shopId: shopRecord.id,
      orderId,
      orderNumber: orderPayload.order_number ? String(orderPayload.order_number) : null,
      orderValue: parseFloat(orderPayload.total_price || "0"),
      currency: orderPayload.currency || "USD",
      // P0-05: Store minimal CAPI input instead of full payload
      capiInput: capiInput as object,
      // P0-05: orderPayload is deprecated - use empty object for new records
      orderPayload: {},
      status: "queued",
    };
    
    const updateData = {
      orderNumber: orderPayload.order_number ? String(orderPayload.order_number) : null,
      orderValue: parseFloat(orderPayload.total_price || "0"),
      currency: orderPayload.currency || "USD",
      // P0-05: Update capiInput
      capiInput: capiInput as object,
    };
    
    await prisma.conversionJob.upsert({
      where: {
        shopId_orderId: {
          shopId: shopRecord.id,
          orderId,
        },
      },
      // Use type assertion to include capiInput field (requires prisma migrate)
      create: createData as Parameters<typeof prisma.conversionJob.upsert>[0]["create"],
      update: updateData as Parameters<typeof prisma.conversionJob.upsert>[0]["update"],
    });
    
    logger.info(`[P0-07] Order ${orderId} queued for async processing`);
  } catch (error) {
    // Log but don't throw - we still want to return 200 to Shopify
    logger.error(`[P0-07] Failed to queue order ${orderId}:`, error);
  }
}

// P0-07: evaluateConsentStrategy moved to retry.server.ts / processConversionJobs
// Webhook now only queues jobs; all consent evaluation is done by the worker

