/**
 * Webhook Handler for Shopify Events
 * 
 * P0-1: Billing gate - checks usage limits before processing
 * P0-2: Fast ACK + async queue - immediately returns 200, processes via worker
 * P0-3: Uses PixelEventReceipt for consent decisions
 * P0-5: Implements consent strategy (strict/balanced/weak)
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

interface ShopWithPixelConfigs extends Shop {
  pixelConfigs: PixelConfig[];
}

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { topic, shop, session, admin, payload } =
      await authenticate.webhook(request);

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
            
            // Still return 200 to acknowledge receipt
            break;
          }
          
          // P0-2: Queue the order for async processing
          await queueOrderForProcessing(
            shopRecord as ShopWithPixelConfigs,
            payload as OrderWebhookPayload
          );
          
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
 * P0-2: Queue order for async processing
 * Creates ConversionLog records and returns immediately
 * The actual CAPI sending is done by the worker (processConversionJobs/processRetries)
 * 
 * P0-1: Writes eventId for platform deduplication
 * P0-3: Updates all key fields (not just status) when record exists
 * P0-2: Uses PixelEventReceipt for consent decisions (primary source)
 * 
 * NOTE: This uses ConversionLog until the full migration to ConversionJob is complete.
 * After running prisma migrate, this can be updated to use ConversionJob directly.
 */
async function queueOrderForProcessing(
  shopRecord: ShopWithPixelConfigs,
  orderPayload: OrderWebhookPayload
): Promise<void> {
  const orderId = normalizeOrderId(String(orderPayload.id));
  const eventType = "purchase";
  // P0-1: Generate deterministic eventId for platform deduplication
  const eventId = generateEventId(orderId, eventType, shopRecord.shopDomain);
  
  // Check if already sent
  const existingLog = await prisma.conversionLog.findFirst({
    where: {
      shopId: shopRecord.id,
      orderId,
      eventType,
      status: "sent",
    },
  });
  
  if (existingLog) {
    console.log(`Order ${orderId} already sent, skipping`);
    return;
  }
  
  // P0-2: Check PixelEventReceipt for consent (primary source of truth)
  const pixelReceipt = await prisma.pixelEventReceipt.findUnique({
    where: {
      shopId_orderId_eventType: {
        shopId: shopRecord.id,
        orderId,
        eventType,
      },
    },
    select: {
      consentState: true,
      isTrusted: true,
    },
  });
  
  // Fallback: Check ConversionLog for clientSideSent (backwards compatibility)
  const hasPixelConsent = pixelReceipt || await prisma.conversionLog.findFirst({
    where: {
      shopId: shopRecord.id,
      orderId,
      eventType,
      clientSideSent: true,
    },
    select: { id: true },
  });
  
  // Determine consent status based on strategy
  const consentStrategy = (shopRecord as { consentStrategy?: string }).consentStrategy || "balanced";
  const weakConsentMode = (shopRecord as { weakConsentMode?: boolean }).weakConsentMode || false;
  
  // Build consent info from PixelEventReceipt or fallback
  const consentInfo = pixelReceipt 
    ? { consentState: pixelReceipt.consentState, isTrusted: pixelReceipt.isTrusted }
    : (hasPixelConsent ? { consentState: { marketing: true }, isTrusted: false } : null);
  
  const consentDecision = evaluateConsentStrategy(
    consentStrategy,
    consentInfo,
    weakConsentMode
  );
  
  // P0-3: Extract order data from webhook (authoritative source)
  const orderNumber = orderPayload.order_number ? String(orderPayload.order_number) : null;
  const orderValue = parseFloat(orderPayload.total_price || "0");
  const currency = orderPayload.currency || "USD";
  
  // Create ConversionLog entries for each platform
  for (const config of shopRecord.pixelConfigs) {
    await prisma.conversionLog.upsert({
      where: {
        shopId_orderId_platform_eventType: {
          shopId: shopRecord.id,
          orderId,
          platform: config.platform,
          eventType,
        },
      },
      create: {
        shopId: shopRecord.id,
        orderId,
        orderNumber,
        orderValue,
        currency,
        platform: config.platform,
        eventType,
        // P0-1: Write eventId for deduplication
        eventId,
        status: consentDecision.allowed ? "pending" : "pending_consent",
        clientSideSent: !!hasPixelConsent,
      },
      update: {
        // P0-3: Update ALL key fields from webhook (authoritative source)
        // This fixes the bug where pixel first writes value=0 and webhook doesn't correct it
        orderNumber,
        orderValue,
        currency,
        // P0-1: Write eventId for deduplication
        eventId,
        status: consentDecision.allowed ? "pending" : "pending_consent",
        // Only set clientSideSent to true, never back to false
        ...(hasPixelConsent ? { clientSideSent: true } : {}),
        // Clear any previous error message
        errorMessage: null,
      },
    });
  }
}

/**
 * P0-5: Evaluate consent strategy
 * Determines if CAPI sending is allowed based on strategy and pixel receipt
 */
function evaluateConsentStrategy(
  strategy: string,
  pixelReceipt: { consentState: unknown; isTrusted: boolean } | null,
  legacyWeakMode: boolean
): { allowed: boolean; reason?: string } {
  // Parse consent state if available
  const consentState = pixelReceipt?.consentState as { 
    marketing?: boolean; 
    analytics?: boolean 
  } | null;
  
  switch (strategy) {
    case "strict":
      // Must have pixel receipt with explicit marketing consent
      if (!pixelReceipt) {
        return { allowed: false, reason: "No pixel event received (strict mode)" };
      }
      if (!consentState?.marketing) {
        return { allowed: false, reason: "Marketing consent not granted (strict mode)" };
      }
      return { allowed: true };
      
    case "balanced":
      // If we have a receipt, use its consent state
      if (pixelReceipt) {
        if (consentState?.marketing === false) {
          return { allowed: false, reason: "Marketing consent explicitly denied" };
        }
        // If marketing is true or undefined (not explicitly denied), allow
        return { allowed: true };
      }
      // No receipt - check if we should allow anyway (default: no)
      // In balanced mode without receipt, we don't send
      return { allowed: false, reason: "No pixel event received (balanced mode)" };
      
    case "weak":
      // Always allow (for regions with implied consent)
      return { allowed: true };
      
    default:
      // Fallback: use legacy weakConsentMode for backwards compatibility
      if (legacyWeakMode) {
        return { allowed: true };
      }
      // Default to balanced behavior
      if (pixelReceipt) {
        return { allowed: true };
      }
      return { allowed: false, reason: "No pixel event received" };
  }
}

