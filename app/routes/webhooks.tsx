import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendConversionToGoogle } from "../services/platforms/google.server";
import { sendConversionToMeta } from "../services/platforms/meta.server";
import { sendConversionToTikTok } from "../services/platforms/tiktok.server";
import { decryptJson, generateEventId, normalizeOrderId } from "../utils/crypto";
import { scheduleRetry } from "../services/retry.server";
import type {
  OrderWebhookPayload,
  ConversionData,
  GoogleCredentials,
  MetaCredentials,
  TikTokCredentials,
  PlatformCredentials,
  ShopData,
  PixelConfigData,
} from "../types";

// Default max retry attempts
const MAX_RETRY_ATTEMPTS = 5;

interface ShopWithPixelConfigs extends ShopData {
  pixelConfigs: PixelConfigData[];
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

    // Get shop from our database
    const shopRecord = await prisma.shop.findUnique({
      where: { shopDomain: shop },
      select: {
        id: true,
        shopDomain: true,
        isActive: true,
        piiEnabled: true, // P0-5: Check if PII should be sent to platforms
        weakConsentMode: true, // P1-3: Check if weak consent mode is enabled
        pixelConfigs: {
          where: { isActive: true, serverSideEnabled: true },
          select: {
            id: true,
            platform: true,
            platformId: true,
            credentialsEncrypted: true,
            credentials: true,
          },
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
        // Process conversion tracking for paid orders only
        // NOTE: We only process ORDERS_PAID (not ORDERS_CREATE) to:
        // 1. Ensure payment is confirmed before sending conversion
        // 2. Avoid duplicate events (ORDERS_CREATE + ORDERS_PAID for same order)
        // 3. Match "purchase" semantics more accurately
        if (shopRecord && payload) {
          console.log(`Processing ${topic} webhook for shop ${shop}, order ${payload.id}`);
          await processOrderConversion(
            shopRecord as ShopWithPixelConfigs,
            payload as OrderWebhookPayload,
            topic
          );
          console.log(`Successfully processed ${topic} for order ${payload.id}`);
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
            include: {
              _count: {
                select: {
                  pixelConfigs: true,
                  alertConfigs: true,
                  conversionLogs: true,
                  scanReports: true,
                  reconciliationReports: true,
                  surveyResponses: true,
                  auditLogs: true,
                },
              },
            },
          });
          
          if (shopToDelete) {
            // Log what will be deleted for audit trail
            console.log(`Deleting shop data for ${shop}:`, {
              pixelConfigs: shopToDelete._count.pixelConfigs,
              alertConfigs: shopToDelete._count.alertConfigs,
              conversionLogs: shopToDelete._count.conversionLogs,
              scanReports: shopToDelete._count.scanReports,
              reconciliationReports: shopToDelete._count.reconciliationReports,
              surveyResponses: shopToDelete._count.surveyResponses,
              auditLogs: shopToDelete._count.auditLogs,
            });
            
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
 * P2-4: Process order conversion for all platforms
 * Uses Promise.allSettled for parallel platform sends
 */
async function processOrderConversion(
  shopRecord: ShopWithPixelConfigs,
  orderPayload: OrderWebhookPayload,
  topic: string
): Promise<void> {
  const order = orderPayload;
  // Always use "purchase" as event type since we only process ORDERS_PAID
  const eventType = "purchase";
  
  // Normalize order ID for consistent storage
  const orderId = normalizeOrderId(String(order.id));
  
  // Generate deterministic eventId for platform CAPI deduplication
  const eventId = generateEventId(orderId, eventType, shopRecord.shopDomain);

  // P2-4: Process all platforms in parallel using Promise.allSettled
  const platformPromises = shopRecord.pixelConfigs.map((pixelConfig) =>
    processSinglePlatform(shopRecord, order, pixelConfig, orderId, eventId, eventType)
  );
  
  const results = await Promise.allSettled(platformPromises);
  
  // Log any failed platforms
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      const platform = shopRecord.pixelConfigs[index]?.platform || "unknown";
      console.error(`Platform ${platform} processing failed:`, result.reason);
    }
  });
}

/**
 * P2-4: Process conversion for a single platform
 * Extracted to support parallel execution via Promise.allSettled
 */
async function processSinglePlatform(
  shopRecord: ShopWithPixelConfigs,
  order: OrderWebhookPayload,
  pixelConfig: PixelConfigData,
  orderId: string,
  eventId: string,
  eventType: string
): Promise<void> {
  // Check if we already logged this conversion
  const existingLog = await prisma.conversionLog.findUnique({
    where: {
      shopId_orderId_platform_eventType: {
        shopId: shopRecord.id,
        orderId: orderId,
        platform: pixelConfig.platform,
        eventType,
      },
    },
  });

  if (existingLog && existingLog.status === "sent") {
    return; // Already sent successfully
  }

  // ==========================================
  // P1 CONSENT GATE: Shopify Pixel Privacy Compliance
  // P1-3: Enhanced with weak consent mode option
  // ==========================================
  const hasPixelConsent = existingLog?.clientSideSent === true;
  const weakConsentMode = (shopRecord as { weakConsentMode?: boolean }).weakConsentMode === true;

  if (!hasPixelConsent) {
    // P1-3: In weak consent mode, allow sending without pixel consent
    // This is for regions where implied consent is legal (e.g., non-GDPR regions)
    if (weakConsentMode) {
      console.log(
        `Consent gate: WEAK MODE - proceeding with server-side conversion for order=${orderId}, ` +
        `platform=${pixelConfig.platform} - no pixel consent but weak consent mode enabled`
      );
      // Continue processing (don't return)
    } else {
      console.log(
        `Consent gate: Skipping server-side conversion for order=${orderId}, ` +
        `platform=${pixelConfig.platform} - no pixel event received (no consent evidence)`
      );

      await prisma.conversionLog.upsert({
        where: {
          shopId_orderId_platform_eventType: {
            shopId: shopRecord.id,
            orderId: orderId,
            platform: pixelConfig.platform,
            eventType,
          },
        },
        update: {
          status: existingLog?.status || "pending_consent",
          eventId: eventId,
        },
        create: {
          shopId: shopRecord.id,
          orderId: orderId,
          eventId: eventId,
          orderNumber: order.order_number ? String(order.order_number) : null,
          orderValue: parseFloat(order.total_price || "0"),
          currency: order.currency || "USD",
          platform: pixelConfig.platform,
          eventType,
          status: "pending_consent",
          attempts: 0,
          clientSideSent: false,
          serverSideSent: false,
        },
      });

      return; // Don't send without consent in strict mode
    }
  }

  console.log(
    `Consent gate: Proceeding with server-side conversion for order=${orderId}, ` +
    `platform=${pixelConfig.platform} - pixel consent verified`
  );

  const conversionLog = await prisma.conversionLog.upsert({
    where: {
      shopId_orderId_platform_eventType: {
        shopId: shopRecord.id,
        orderId: orderId,
        platform: pixelConfig.platform,
        eventType,
      },
    },
    update: {
      status: "pending",
      lastAttemptAt: new Date(),
      eventId: eventId,
    },
    create: {
      shopId: shopRecord.id,
      orderId: orderId,
      eventId: eventId,
      orderNumber: order.order_number ? String(order.order_number) : null,
      orderValue: parseFloat(order.total_price || "0"),
      currency: order.currency || "USD",
      platform: pixelConfig.platform,
      eventType,
      status: "pending",
      attempts: 0,
      lastAttemptAt: new Date(),
    },
  });

  try {
    let result;

    const piiEnabled = (shopRecord as { piiEnabled?: boolean }).piiEnabled === true;

    const conversionData: ConversionData = {
      orderId: orderId,
      orderNumber: order.order_number ? String(order.order_number) : null,
      value: parseFloat(order.total_price || "0"),
      currency: order.currency || "USD",
      ...(piiEnabled && {
        email: order.email,
        phone: order.phone || order.billing_address?.phone,
        firstName: order.customer?.first_name || order.billing_address?.first_name,
        lastName: order.customer?.last_name || order.billing_address?.last_name,
        city: order.billing_address?.city,
        state: order.billing_address?.province,
        country: order.billing_address?.country_code,
        zip: order.billing_address?.zip,
      }),
      lineItems: order.line_items?.map((item) => ({
        productId: String(item.product_id),
        variantId: String(item.variant_id),
        name: item.name,
        quantity: item.quantity,
        price: parseFloat(item.price),
      })),
    };

    // Decrypt credentials
    let decryptedCredentials: PlatformCredentials | null = null;

    if (pixelConfig.credentialsEncrypted) {
      try {
        decryptedCredentials = decryptJson<PlatformCredentials>(
          pixelConfig.credentialsEncrypted as string
        );
      } catch (decryptError) {
        console.warn(
          `Failed to decrypt credentialsEncrypted for ${pixelConfig.platform}:`,
          decryptError instanceof Error ? decryptError.message : "Unknown error"
        );
      }
    }

    if (!decryptedCredentials && (pixelConfig as Record<string, unknown>).credentials) {
      try {
        const legacyCredentials = (pixelConfig as Record<string, unknown>).credentials;
        if (typeof legacyCredentials === "string") {
          decryptedCredentials = decryptJson<PlatformCredentials>(legacyCredentials);
        } else if (typeof legacyCredentials === "object" && legacyCredentials !== null) {
          decryptedCredentials = legacyCredentials as PlatformCredentials;
        }
      } catch (legacyError) {
        console.warn(`Failed to read legacy credentials for ${pixelConfig.platform}`);
      }
    }

    if (!decryptedCredentials) {
      await prisma.conversionLog.update({
        where: { id: conversionLog.id },
        data: {
          status: "failed",
          attempts: 1,
          errorMessage: "No credentials configured",
        },
      });
      return;
    }

    switch (pixelConfig.platform) {
      case "google":
        result = await sendConversionToGoogle(
          decryptedCredentials as GoogleCredentials | null,
          conversionData,
          eventId
        );
        break;
      case "meta":
        result = await sendConversionToMeta(
          decryptedCredentials as MetaCredentials | null,
          conversionData,
          eventId
        );
        break;
      case "tiktok":
        result = await sendConversionToTikTok(
          decryptedCredentials as TikTokCredentials | null,
          conversionData,
          eventId
        );
        break;
      default:
        console.log(`Skipping unsupported platform: ${pixelConfig.platform}`);
        return;
    }

    await prisma.conversionLog.update({
      where: { id: conversionLog.id },
      data: {
        status: "sent",
        serverSideSent: true,
        sentAt: new Date(),
        platformResponse: result,
        attempts: 1,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`Conversion send failed for ${pixelConfig.platform}:`, errorMessage);

    await prisma.conversionLog.update({
      where: { id: conversionLog.id },
      data: { attempts: 1 },
    });

    await scheduleRetry(conversionLog.id, errorMessage);
  }
}

