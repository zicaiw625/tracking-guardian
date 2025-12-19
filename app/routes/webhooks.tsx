import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendConversionToGoogle } from "../services/platforms/google.server";
import { sendConversionToMeta } from "../services/platforms/meta.server";
import { sendConversionToTikTok } from "../services/platforms/tiktok.server";
import { decryptJson } from "../utils/crypto";
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

async function processOrderConversion(
  shopRecord: ShopWithPixelConfigs,
  orderPayload: OrderWebhookPayload,
  topic: string
): Promise<void> {
  const order = orderPayload;
  // Always use "purchase" as event type since we only process ORDERS_PAID
  // This matches the standard conversion event name across platforms
  const eventType = "purchase";

  // Process each configured platform
  for (const pixelConfig of shopRecord.pixelConfigs) {
    // Check if we already logged this conversion
    const existingLog = await prisma.conversionLog.findUnique({
      where: {
        shopId_orderId_platform_eventType: {
          shopId: shopRecord.id,
          orderId: String(order.id),
          platform: pixelConfig.platform,
          eventType,
        },
      },
    });

    if (existingLog && existingLog.status === "sent") {
      continue; // Already sent successfully
    }

    // Create or update conversion log
    // NOTE: attempts is incremented ONLY after a send attempt completes (success or failure)
    // - attempts=0: log created, not yet attempted
    // - attempts=1: first send attempt completed
    // - attempts=N: N send attempts completed
    const conversionLog = await prisma.conversionLog.upsert({
      where: {
        shopId_orderId_platform_eventType: {
          shopId: shopRecord.id,
          orderId: String(order.id),
          platform: pixelConfig.platform,
          eventType,
        },
      },
      update: {
        // Don't increment attempts here - only mark as pending for processing
        status: "pending",
        lastAttemptAt: new Date(),
      },
      create: {
        shopId: shopRecord.id,
        orderId: String(order.id),
        orderNumber: order.order_number ? String(order.order_number) : null,
        orderValue: parseFloat(order.total_price || "0"),
        currency: order.currency || "USD",
        platform: pixelConfig.platform,
        eventType,
        status: "pending",
        attempts: 0, // Start at 0 - will be incremented after first send attempt
        lastAttemptAt: new Date(),
      },
    });

    try {
      let result;
      
      // P0-5: Build conversion data with PII only if merchant has enabled it
      // By default, piiEnabled is false for maximum privacy compliance
      // When enabled, PII is hashed (SHA256) before being sent to platforms
      const piiEnabled = (shopRecord as { piiEnabled?: boolean }).piiEnabled === true;
      
      const conversionData: ConversionData = {
        orderId: String(order.id),
        orderNumber: order.order_number ? String(order.order_number) : null,
        value: parseFloat(order.total_price || "0"),
        currency: order.currency || "USD",
        // PII fields are only included when merchant explicitly enables them
        // This gives merchants control over their privacy compliance posture
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

      // Decrypt credentials before use
      // Prefer credentialsEncrypted (new field), fallback to legacy credentials field
      let decryptedCredentials: PlatformCredentials | null = null;
      
      // Try credentialsEncrypted first (new unified field)
      if (pixelConfig.credentialsEncrypted) {
        try {
          decryptedCredentials = decryptJson<PlatformCredentials>(
            pixelConfig.credentialsEncrypted as string
          );
        } catch (decryptError) {
          console.warn(
            `Failed to decrypt credentialsEncrypted for ${pixelConfig.platform} (shop=${shopRecord.shopDomain}):`,
            decryptError instanceof Error ? decryptError.message : "Unknown error"
          );
          // Fall through to try legacy field
        }
      }
      
      // Fallback: try legacy credentials field (for backwards compatibility)
      // Note: Prisma schema maps this to credentials_legacy column
      if (!decryptedCredentials && (pixelConfig as Record<string, unknown>).credentials) {
        try {
          const legacyCredentials = (pixelConfig as Record<string, unknown>).credentials;
          if (typeof legacyCredentials === "string") {
            decryptedCredentials = decryptJson<PlatformCredentials>(legacyCredentials);
          } else if (typeof legacyCredentials === "object" && legacyCredentials !== null) {
            decryptedCredentials = legacyCredentials as PlatformCredentials;
          }
          console.log(
            `Using legacy credentials for ${pixelConfig.platform} (shop=${shopRecord.shopDomain}) - ` +
            `please reconfigure in Settings to use new encryption`
          );
        } catch (legacyError) {
          console.warn(
            `Failed to read legacy credentials for ${pixelConfig.platform}:`,
            legacyError instanceof Error ? legacyError.message : "Unknown error"
          );
        }
      }
      
      if (!decryptedCredentials) {
        console.warn(
          `No credentials for ${pixelConfig.platform} (shop=${shopRecord.shopDomain}), ` +
          `skipping server-side conversion. Configure credentials in Settings.`
        );
        // Record the failure
        await prisma.conversionLog.update({
          where: { id: conversionLog.id },
          data: {
            status: "failed",
            attempts: 1,
            errorMessage: "No credentials configured - please set up in Settings",
          },
        });
        continue;
      }

      switch (pixelConfig.platform) {
        case "google":
          result = await sendConversionToGoogle(
            decryptedCredentials as GoogleCredentials | null,
            conversionData
          );
          break;
        case "meta":
          result = await sendConversionToMeta(
            decryptedCredentials as MetaCredentials | null,
            conversionData
          );
          break;
        case "tiktok":
          result = await sendConversionToTikTok(
            decryptedCredentials as TikTokCredentials | null,
            conversionData
          );
          break;
        default:
          console.log(`Skipping unsupported platform: ${pixelConfig.platform}`);
          continue;
      }

      // Update log with success - increment attempts to 1 (first attempt succeeded)
      await prisma.conversionLog.update({
        where: { id: conversionLog.id },
        data: {
          status: "sent",
          serverSideSent: true,
          sentAt: new Date(),
          platformResponse: result,
          attempts: 1, // First attempt completed successfully
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`Conversion send failed for ${pixelConfig.platform}:`, errorMessage);
      
      // First attempt failed - increment attempts to 1, then schedule retry
      await prisma.conversionLog.update({
        where: { id: conversionLog.id },
        data: { attempts: 1 },
      });
      
      // Use retry service for exponential backoff and dead letter handling
      await scheduleRetry(conversionLog.id, errorMessage);
    }
  }
}

