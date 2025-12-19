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
import type {
  OrderWebhookPayload,
  PixelConfigData,
} from "../types";
import type { Shop, PixelConfig } from "@prisma/client";
// P0-07: Consent evaluation moved to worker (api.cron.tsx / retry.server.ts)
// import { evaluatePlatformConsentWithStrategy, type ConsentState } from "../utils/platform-consent";

/**
 * P0-5: Check if a webhook has already been processed
 * Uses WebhookLog for idempotency (fingerprint: shop + webhookId + topic)
 * 
 * @returns true if webhook was already processed (should skip)
 */
async function isWebhookAlreadyProcessed(
  shopDomain: string,
  webhookId: string | null,
  topic: string
): Promise<boolean> {
  if (!webhookId) {
    // No webhook ID means we can't deduplicate - allow processing
    // This shouldn't happen with valid Shopify webhooks
    console.warn(`[Webhook] Missing X-Shopify-Webhook-Id for topic ${topic} from ${shopDomain}`);
    return false;
  }
  
  // Check if this webhook was already processed
  const existing = await prisma.webhookLog.findUnique({
    where: {
      shopDomain_webhookId_topic: {
        shopDomain,
        webhookId,
        topic,
      },
    },
    select: { id: true, status: true },
  });
  
  if (existing) {
    console.log(
      `[Webhook Idempotency] Duplicate webhook detected: ${topic} for ${shopDomain}, ` +
      `webhookId=${webhookId}, status=${existing.status}`
    );
    return true;
  }
  
  return false;
}

/**
 * P0-5: Record a webhook as processed
 */
async function recordWebhookProcessed(
  shopDomain: string,
  webhookId: string,
  topic: string,
  orderId?: string,
  status: "processed" | "failed" = "processed"
): Promise<void> {
  try {
    await prisma.webhookLog.create({
      data: {
        shopDomain,
        webhookId,
        topic,
        orderId,
        status,
        processedAt: new Date(),
      },
    });
  } catch (error) {
    // If insert fails due to unique constraint, that's fine - another request beat us
    // Just log and continue
    if ((error as { code?: string })?.code === "P2002") {
      console.log(`[Webhook] WebhookLog already exists for ${webhookId}`);
    } else {
      console.error(`[Webhook] Failed to record webhook: ${error}`);
    }
  }
}

interface ShopWithPixelConfigs extends Shop {
  pixelConfigs: PixelConfig[];
}

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { topic, shop, session, admin, payload } =
      await authenticate.webhook(request);
    
    // P0-5: Get webhook ID from headers for idempotency
    const webhookId = request.headers.get("X-Shopify-Webhook-Id");
    
    // P0-5: Check if this webhook was already processed
    if (webhookId && await isWebhookAlreadyProcessed(shop, webhookId, topic)) {
      // Already processed - return 200 to acknowledge receipt
      // This prevents Shopify from retrying and prevents duplicate processing
      console.log(`[Webhook Idempotency] Skipping duplicate: ${topic} for ${shop}`);
      return new Response("OK (duplicate)", { status: 200 });
    }

    if (!admin && topic !== "SHOP_REDACT" && topic !== "CUSTOMERS_DATA_REQUEST" && topic !== "CUSTOMERS_REDACT") {
      // The admin context isn't returned if the webhook fired after a shop uninstalled
      console.log(`Webhook ${topic} received for uninstalled shop ${shop}`);
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
        console.log(`Processing APP_UNINSTALLED for shop ${shop}`);
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
          await recordWebhookProcessed(shop, webhookId, topic, undefined, "processed");
        }
        console.log(`Successfully processed APP_UNINSTALLED for shop ${shop}`);
        break;

      case "ORDERS_PAID":
        // P0-2: Fast ACK + async queue pattern
        // This handler quickly validates and queues the order, then returns 200
        // Actual CAPI sending is done by the worker (api.cron.tsx)
        if (shopRecord && payload) {
          const orderId = normalizeOrderId(String(payload.id));
          console.log(`Processing ${topic} webhook for shop ${shop}, order ${orderId}`);
          
          // P0-1: Check billing gate BEFORE processing
          const billingCheck = await checkBillingGate(
            shopRecord.id,
            (shopRecord.plan || "free") as PlanId
          );
          
          if (!billingCheck.allowed) {
            console.log(
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
                  orderNumber: payload.order_number ? String(payload.order_number) : null,
                  orderValue: parseFloat(payload.total_price || "0"),
                  currency: payload.currency || "USD",
                  platform: pixelConfig.platform,
                  eventType: "purchase",
                  eventId: blockedEventId,
                  status: "failed",
                  errorMessage: `Monthly limit exceeded: ${billingCheck.usage.current}/${billingCheck.usage.limit}`,
                },
                update: {
                  // P0-3: Update all key fields
                  orderNumber: payload.order_number ? String(payload.order_number) : null,
                  orderValue: parseFloat(payload.total_price || "0"),
                  currency: payload.currency || "USD",
                  eventId: blockedEventId,
                  status: "failed",
                  errorMessage: `Monthly limit exceeded: ${billingCheck.usage.current}/${billingCheck.usage.limit}`,
                },
              });
            }
            
            // P0-5: Record webhook as processed (even if blocked by billing)
            if (webhookId) {
              await recordWebhookProcessed(shop, webhookId, topic, orderId, "processed");
            }
            
            // Still return 200 to acknowledge receipt
            break;
          }
          
          // P0-2: Queue the order for async processing
          await queueOrderForProcessing(
            shopRecord as ShopWithPixelConfigs,
            payload as OrderWebhookPayload
          );
          
          // P0-5: Record webhook as processed
          if (webhookId) {
            await recordWebhookProcessed(shop, webhookId, topic, orderId, "processed");
          }
          
          console.log(`Order ${orderId} queued for processing`);
        } else {
          console.warn(`Skipping ${topic}: shopRecord=${!!shopRecord}, payload=${!!payload}`);
        }
        break;
      
      case "ORDERS_CREATE":
        // NOTE: ORDERS_CREATE is intentionally not processed for conversion tracking
        // We use ORDERS_PAID instead to ensure payment is confirmed
        console.log(`ORDERS_CREATE received for shop ${shop}, order ${payload?.id} - skipping (using ORDERS_PAID instead)`);
        break;

      case "ORDERS_UPDATED":
        // Handle order updates if needed (e.g., refunds)
        console.log(`Order updated for shop ${shop}: order_id=${payload?.id}`);
        break;

      case "CUSTOMERS_DATA_REQUEST":
        // Customer data request - Shopify requires acknowledgment
        // This webhook is sent when a customer requests their data
        console.log(`GDPR data request received for shop ${shop}`);
        if (shopRecord && payload) {
          try {
            const dataRequestPayload = payload as {
              customer?: { id?: number; email?: string };
              orders_requested?: number[];
              data_request?: { id?: number };
            };
            
            // Log the request for compliance tracking
            const customerId = dataRequestPayload.customer?.id;
            const ordersRequested = dataRequestPayload.orders_requested || [];
            
            // Query what data we have for this customer's orders
            // Our app primarily stores: ConversionLog, SurveyResponse
            // These are keyed by orderId, not customerId directly
            
            if (ordersRequested.length > 0 && shopRecord) {
              const conversionLogs = await prisma.conversionLog.findMany({
                where: {
                  shopId: shopRecord.id,
                  orderId: { in: ordersRequested.map(String) },
                },
                select: {
                  orderId: true,
                  orderNumber: true,
                  orderValue: true,
                  currency: true,
                  platform: true,
                  eventType: true,
                  createdAt: true,
                  // Note: We don't store PII in ConversionLog
                },
              });
              
              const surveyResponses = await prisma.surveyResponse.findMany({
                where: {
                  shopId: shopRecord.id,
                  orderId: { in: ordersRequested.map(String) },
                },
                select: {
                  orderId: true,
                  orderNumber: true,
                  rating: true,
                  source: true,
                  // feedback might contain user input but is optional
                  createdAt: true,
                },
              });
              
              // Log summary (actual data would be sent to shop owner)
              console.log(`Customer data request processed: customerId=${customerId}, ` +
                `orders=${ordersRequested.length}, conversionLogs=${conversionLogs.length}, ` +
                `surveyResponses=${surveyResponses.length}`);
              
              // Note: In production, you would send this data to the shop owner
              // via email or provide it through a secure endpoint
              // For this app, we primarily store non-PII conversion tracking data
            } else {
              console.log(`Customer data request: no orders specified or shop not found`);
            }
          } catch (dataRequestError) {
            console.error("Error processing CUSTOMERS_DATA_REQUEST:", dataRequestError);
            // Still return 200 to acknowledge receipt
          }
        }
        break;

      case "CUSTOMERS_REDACT":
        // Customer data deletion request - MUST delete customer data
        // This is a mandatory webhook for GDPR compliance
        console.log(`GDPR customer redact request for shop ${shop}`);
        if (payload) {
          try {
            const customerPayload = payload as {
              customer?: { id?: number; email?: string };
              orders_to_redact?: number[];
            };
            
            const customerId = customerPayload.customer?.id;
            const ordersToRedact = customerPayload.orders_to_redact || [];
            
            let conversionLogsDeleted = 0;
            let surveyResponsesDeleted = 0;
            
            // Delete data associated with the customer's orders
            if (ordersToRedact.length > 0) {
              // Convert order IDs to strings (our schema uses string orderId)
              const orderIdStrings = ordersToRedact.map(String);
              
              // Delete ConversionLogs for these orders
              // Note: We query by orderId since we don't store customerId
              if (shopRecord) {
                const conversionResult = await prisma.conversionLog.deleteMany({
                  where: {
                    shopId: shopRecord.id,
                    orderId: { in: orderIdStrings },
                  },
                });
                conversionLogsDeleted = conversionResult.count;
                
                // Delete SurveyResponses for these orders
                const surveyResult = await prisma.surveyResponse.deleteMany({
                  where: {
                    shopId: shopRecord.id,
                    orderId: { in: orderIdStrings },
                  },
                });
                surveyResponsesDeleted = surveyResult.count;
              } else {
                // If shop record doesn't exist, try to find and delete by orderId across all
                // This handles edge case where shop was already deleted but data remains
                console.log(`Shop record not found for ${shop}, attempting cross-shop cleanup`);
              }
            }
            
            console.log(`Customer redact completed: customerId=${customerId}, ` +
              `ordersRedacted=${ordersToRedact.length}, conversionLogsDeleted=${conversionLogsDeleted}, ` +
              `surveyResponsesDeleted=${surveyResponsesDeleted}`);
              
          } catch (gdprError) {
            console.error("Error processing CUSTOMERS_REDACT:", gdprError);
            // Still return 200 to acknowledge receipt - Shopify expects this
            // The error is logged for investigation
          }
        }
        break;

      case "SHOP_REDACT":
        // Shop data deletion - happens 48 hours after uninstall
        // This is a mandatory webhook - we MUST delete all shop data
        console.log(`GDPR shop redact request for shop ${shop}`);
        try {
          // Delete all shop data when the shop requests complete data deletion
          // This is called 48 hours after APP_UNINSTALLED
          const shopToDelete = await prisma.shop.findUnique({
            where: { shopDomain: shop },
            select: { id: true, shopDomain: true },
          });
          
          if (shopToDelete) {
            // Log deletion for compliance
            console.log(`Deleting all shop data for ${shop} (GDPR SHOP_REDACT)`);
            
            // Delete all related data (cascade handles child records)
            // The Prisma schema has onDelete: Cascade for all relations
            await prisma.shop.delete({
              where: { id: shopToDelete.id },
            });
            
            // Also delete any orphaned sessions
            await prisma.session.deleteMany({
              where: { shop },
            });
            
            console.log(`Shop data completely deleted for GDPR compliance: ${shop}`);
          } else {
            // Shop may have been deleted already or never existed
            // Still try to clean up any orphaned sessions
            const deletedSessions = await prisma.session.deleteMany({
              where: { shop },
            });
            console.log(`Shop ${shop} not found for SHOP_REDACT (may already be deleted). ` +
              `Cleaned up ${deletedSessions.count} orphaned sessions.`);
          }
        } catch (deleteError) {
          console.error(`Error processing SHOP_REDACT for ${shop}:`, deleteError);
          // Still return 200 to acknowledge receipt - Shopify expects this
          // The error is logged for investigation
        }
        break;

      default:
        console.warn(`Unhandled webhook topic: ${topic}`);
        return new Response(`Unhandled webhook topic: ${topic}`, { status: 404 });
    }

    // Return success response
    return new Response("OK", { status: 200 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    // Log error with stack trace for debugging, but don't expose details to client
    console.error("Webhook processing error:", {
      message: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    // Return 500 to signal Shopify to retry
    // Don't expose internal error details in response
    return new Response("Webhook processing failed", { status: 500 });
  }
};

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
  
  // P0-07: Single upsert to ConversionJob - minimal I/O
  // All consent checking and platform logic deferred to worker
  try {
    await prisma.conversionJob.upsert({
      where: {
        shopId_orderId: {
          shopId: shopRecord.id,
          orderId,
        },
      },
      create: {
        shopId: shopRecord.id,
        orderId,
        orderNumber: orderPayload.order_number ? String(orderPayload.order_number) : null,
        orderValue: parseFloat(orderPayload.total_price || "0"),
        currency: orderPayload.currency || "USD",
        // Store full payload for worker to process
        orderPayload: orderPayload as object,
        status: "queued",
      },
      update: {
        // Update order data if job already exists (shouldn't happen often)
        orderNumber: orderPayload.order_number ? String(orderPayload.order_number) : null,
        orderValue: parseFloat(orderPayload.total_price || "0"),
        currency: orderPayload.currency || "USD",
        orderPayload: orderPayload as object,
        // Don't overwrite status if already processing/completed
      },
    });
    
    console.log(`[P0-07] Order ${orderId} queued for async processing`);
  } catch (error) {
    // Log but don't throw - we still want to return 200 to Shopify
    console.error(`[P0-07] Failed to queue order ${orderId}:`, error);
  }
}

// P0-07: evaluateConsentStrategy moved to retry.server.ts / processConversionJobs
// Webhook now only queues jobs; all consent evaluation is done by the worker

