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
      console.warn("[Webhook] HMAC validation failed - returning 401");
      return new Response("Unauthorized", { status: 401 });
    }
    // P0-02: Handle JSON parsing errors - return 400
    if (error instanceof SyntaxError) {
      console.warn("[Webhook] Payload JSON parse error - returning 400");
      return new Response("Bad Request: Invalid JSON", { status: 400 });
    }
    // P0-02: For other errors, log and return 500
    console.error("[Webhook] Authentication error:", error);
    return new Response("Webhook authentication failed", { status: 500 });
  }

  try {
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
          const orderPayload = payload as OrderWebhookPayload;
          const orderId = normalizeOrderId(String(orderPayload.id));
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
              await recordWebhookProcessed(shop, webhookId, topic, orderId, "processed");
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
        console.log(`ORDERS_CREATE received for shop ${shop}, order ${(payload as { id?: number })?.id} - skipping (using ORDERS_PAID instead)`);
        break;

      case "ORDERS_UPDATED":
        // Handle order updates if needed (e.g., refunds)
        console.log(`Order updated for shop ${shop}: order_id=${(payload as { id?: number })?.id}`);
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
        // P0-03: Must delete ALL customer-related data across ALL tables
        console.log(`GDPR customer redact request for shop ${shop}`);
        if (payload) {
          try {
            const customerPayload = payload as {
              customer?: { id?: number; email?: string };
              orders_to_redact?: number[];
            };
            
            const customerId = customerPayload.customer?.id;
            const ordersToRedact = customerPayload.orders_to_redact || [];
            
            // P0-03: Track all deletions for logging
            let conversionLogsDeleted = 0;
            let surveyResponsesDeleted = 0;
            let conversionJobsDeleted = 0;
            let pixelEventReceiptsDeleted = 0;
            let webhookLogsDeleted = 0;
            
            // Delete data associated with the customer's orders
            if (ordersToRedact.length > 0) {
              // Convert order IDs to strings (our schema uses string orderId)
              const orderIdStrings = ordersToRedact.map(String);
              
              if (shopRecord) {
                // P0-03: Delete ConversionLogs for these orders
                const conversionResult = await prisma.conversionLog.deleteMany({
                  where: {
                    shopId: shopRecord.id,
                    orderId: { in: orderIdStrings },
                  },
                });
                conversionLogsDeleted = conversionResult.count;
                
                // P0-03: Delete SurveyResponses for these orders
                const surveyResult = await prisma.surveyResponse.deleteMany({
                  where: {
                    shopId: shopRecord.id,
                    orderId: { in: orderIdStrings },
                  },
                });
                surveyResponsesDeleted = surveyResult.count;
                
                // P0-03: Delete ConversionJobs for these orders
                // This may contain orderPayload with PII
                const conversionJobResult = await prisma.conversionJob.deleteMany({
                  where: {
                    shopId: shopRecord.id,
                    orderId: { in: orderIdStrings },
                  },
                });
                conversionJobsDeleted = conversionJobResult.count;
                
                // P0-03: Delete PixelEventReceipts for these orders
                const pixelReceiptResult = await prisma.pixelEventReceipt.deleteMany({
                  where: {
                    shopId: shopRecord.id,
                    orderId: { in: orderIdStrings },
                  },
                });
                pixelEventReceiptsDeleted = pixelReceiptResult.count;
              }
              
              // P0-03: Delete WebhookLogs for these orders (uses shopDomain, not shopId)
              const webhookLogResult = await prisma.webhookLog.deleteMany({
                where: {
                  shopDomain: shop,
                  orderId: { in: orderIdStrings },
                },
              });
              webhookLogsDeleted = webhookLogResult.count;
            }
            
            console.log(
              `[P0-03] Customer redact completed: customerId=${customerId}, ` +
              `ordersRedacted=${ordersToRedact.length}, ` +
              `conversionLogsDeleted=${conversionLogsDeleted}, ` +
              `surveyResponsesDeleted=${surveyResponsesDeleted}, ` +
              `conversionJobsDeleted=${conversionJobsDeleted}, ` +
              `pixelEventReceiptsDeleted=${pixelEventReceiptsDeleted}, ` +
              `webhookLogsDeleted=${webhookLogsDeleted}`
            );
              
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
        // P0-04: Must delete ALL shop data including non-cascaded tables
        console.log(`GDPR shop redact request for shop ${shop}`);
        try {
          // Delete all shop data when the shop requests complete data deletion
          // This is called 48 hours after APP_UNINSTALLED
          const shopToDelete = await prisma.shop.findUnique({
            where: { shopDomain: shop },
            select: { id: true, shopDomain: true },
          });
          
          // P0-04: Delete WebhookLog first (not cascaded - uses shopDomain string)
          // Must be done before shop deletion since it references shopDomain
          const webhookLogResult = await prisma.webhookLog.deleteMany({
            where: { shopDomain: shop },
          });
          console.log(`[P0-04] Deleted ${webhookLogResult.count} WebhookLog entries for ${shop}`);
          
          if (shopToDelete) {
            // Log deletion for compliance
            console.log(`Deleting all shop data for ${shop} (GDPR SHOP_REDACT)`);
            
            // Delete all related data (cascade handles child records)
            // The Prisma schema has onDelete: Cascade for:
            // - ScanReport, PixelConfig, AlertConfig, ConversionLog
            // - ReconciliationReport, SurveyResponse, AuditLog
            // - MonthlyUsage, PixelEventReceipt, ConversionJob
            await prisma.shop.delete({
              where: { id: shopToDelete.id },
            });
            
            // Also delete any orphaned sessions
            await prisma.session.deleteMany({
              where: { shop },
            });
            
            console.log(`[P0-04] Shop data completely deleted for GDPR compliance: ${shop}`);
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
 * P0-05: Build minimal CAPI input from order payload
 * Only includes fields necessary for platform API calls - NO raw PII
 */
function buildCapiInput(orderPayload: OrderWebhookPayload, orderId: string): object {
  // Extract line items summary (no PII)
  // Shopify uses 'title' for product name, but some versions use 'name'
  const items = orderPayload.line_items?.map((item) => ({
    productId: item.product_id ? String(item.product_id) : undefined,
    variantId: item.variant_id ? String(item.variant_id) : undefined,
    name: item.title || item.name || "",
    quantity: item.quantity || 1,
    price: parseFloat(item.price || "0"),
  })) || [];

  return {
    orderId,
    value: parseFloat(orderPayload.total_price || "0"),
    currency: orderPayload.currency || "USD",
    orderNumber: orderPayload.order_number ? String(orderPayload.order_number) : null,
    items,
    // P0-05: Store tax and shipping for accurate conversion value
    tax: parseFloat(orderPayload.total_tax || "0"),
    shipping: parseFloat(orderPayload.total_shipping_price_set?.shop_money?.amount || "0"),
    // Timestamp for event timing
    processedAt: orderPayload.processed_at || new Date().toISOString(),
    // P0-05: Do NOT include raw email/phone/address - only if piiEnabled and hashed
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
    
    console.log(`[P0-07] Order ${orderId} queued for async processing`);
  } catch (error) {
    // Log but don't throw - we still want to return 200 to Shopify
    console.error(`[P0-07] Failed to queue order ${orderId}:`, error);
  }
}

// P0-07: evaluateConsentStrategy moved to retry.server.ts / processConversionJobs
// Webhook now only queues jobs; all consent evaluation is done by the worker

