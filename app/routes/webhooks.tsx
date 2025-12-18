import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendConversionToGoogle } from "../services/platforms/google.server";
import { sendConversionToMeta } from "../services/platforms/meta.server";
import { sendConversionToTikTok } from "../services/platforms/tiktok.server";
import { decryptJson } from "../utils/crypto";
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

      case "ORDERS_CREATE":
      case "ORDERS_PAID":
        // Process conversion tracking for the order
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

      case "ORDERS_UPDATED":
        // Handle order updates if needed (e.g., refunds)
        console.log(`Order updated for shop ${shop}: order_id=${payload?.id}`);
        break;

      case "CUSTOMERS_DATA_REQUEST":
        // Customer data request - return what data we have for the customer
        // Shopify requires acknowledgment, actual data sent separately
        console.log(`GDPR data request received for shop ${shop}`);
        // In a full implementation, you would:
        // 1. Extract customer info from payload (customer_id, email, etc.)
        // 2. Query your database for any data related to this customer
        // 3. Email the data to the shop owner or provide via a secure endpoint
        break;

      case "CUSTOMERS_REDACT":
        // Customer data deletion request
        console.log(`GDPR customer redact request for shop ${shop}`);
        if (shopRecord && payload) {
          try {
            const customerPayload = payload as { customer?: { id?: number; email?: string } };
            const customerId = customerPayload.customer?.id;
            const customerEmail = customerPayload.customer?.email;
            
            // Delete or anonymize customer-related data
            // For this app, we primarily store order-related data in ConversionLog
            // We should anonymize any PII but can keep aggregated/anonymized conversion data
            
            // Note: ConversionLogs don't directly store customer IDs but may have email in metadata
            // In a full implementation, you would:
            // 1. Find all records associated with this customer
            // 2. Delete or anonymize PII while preserving anonymous analytics data
            
            console.log(`Customer redact processed: customerId=${customerId}, hasEmail=${!!customerEmail}`);
          } catch (gdprError) {
            console.error("Error processing CUSTOMERS_REDACT:", gdprError);
            // Still return 200 to acknowledge receipt
          }
        }
        break;

      case "SHOP_REDACT":
        // Shop data deletion - happens 48 hours after uninstall
        console.log(`GDPR shop redact request for shop ${shop}`);
        try {
          // Delete all shop data when the shop requests complete data deletion
          // This is called 48 hours after APP_UNINSTALLED
          const shopToDelete = await prisma.shop.findUnique({
            where: { shopDomain: shop },
          });
          
          if (shopToDelete) {
            // Delete all related data (cascade should handle most of this)
            // The Prisma schema has onDelete: Cascade for relations
            await prisma.shop.delete({
              where: { id: shopToDelete.id },
            });
            console.log(`Shop data deleted for GDPR compliance: ${shop}`);
          } else {
            console.log(`Shop ${shop} not found for SHOP_REDACT (may already be deleted)`);
          }
        } catch (deleteError) {
          console.error(`Error processing SHOP_REDACT for ${shop}:`, deleteError);
          // Still return 200 to acknowledge receipt
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
  const eventType = topic === "ORDERS_CREATE" ? "purchase" : "purchase_paid";

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
        status: "pending",
        attempts: { increment: 1 },
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
        attempts: 1,
        lastAttemptAt: new Date(),
      },
    });

    try {
      let result;
      const conversionData: ConversionData = {
        orderId: String(order.id),
        orderNumber: order.order_number ? String(order.order_number) : null,
        value: parseFloat(order.total_price || "0"),
        currency: order.currency || "USD",
        email: order.email,
        phone: order.phone || order.billing_address?.phone,
        firstName: order.customer?.first_name || order.billing_address?.first_name,
        lastName: order.customer?.last_name || order.billing_address?.last_name,
        city: order.billing_address?.city,
        state: order.billing_address?.province,
        country: order.billing_address?.country_code,
        zip: order.billing_address?.zip,
        lineItems: order.line_items?.map((item) => ({
          productId: String(item.product_id),
          variantId: String(item.variant_id),
          name: item.name,
          quantity: item.quantity,
          price: parseFloat(item.price),
        })),
      };

      // Decrypt credentials before use
      let decryptedCredentials: PlatformCredentials | null = null;
      if (pixelConfig.credentials) {
        try {
          decryptedCredentials = decryptJson<PlatformCredentials>(
            pixelConfig.credentials as string
          );
        } catch (decryptError) {
          console.error(`Failed to decrypt credentials for ${pixelConfig.platform}:`, decryptError);
          continue;
        }
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

      // Update log with success
      await prisma.conversionLog.update({
        where: { id: conversionLog.id },
        data: {
          status: "sent",
          serverSideSent: true,
          sentAt: new Date(),
          platformResponse: result,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`Conversion send failed for ${pixelConfig.platform}:`, errorMessage);
      
      // Update log with failure
      await prisma.conversionLog.update({
        where: { id: conversionLog.id },
        data: {
          status: conversionLog.attempts >= 3 ? "failed" : "retrying",
          errorMessage,
        },
      });
    }
  }
}

