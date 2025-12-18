import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendConversionToGoogle } from "../services/platforms/google.server";
import { sendConversionToMeta } from "../services/platforms/meta.server";
import { sendConversionToTikTok } from "../services/platforms/tiktok.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, session, admin, payload } =
    await authenticate.webhook(request);

  if (!admin && topic !== "SHOP_REDACT") {
    // The admin context isn't returned if the webhook fired after a shop uninstalled
    throw new Response();
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
      break;

    case "ORDERS_CREATE":
    case "ORDERS_PAID":
      // Process conversion tracking for the order
      if (shopRecord && payload) {
        await processOrderConversion(shopRecord, payload, topic);
      }
      break;

    case "ORDERS_UPDATED":
      // Handle order updates if needed (e.g., refunds)
      console.log(`Order updated for shop ${shop}:`, payload?.id);
      break;

    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
    case "SHOP_REDACT":
      // Handle GDPR webhooks - these are mandatory
      console.log(`GDPR webhook received: ${topic} for shop ${shop}`);
      break;

    default:
      throw new Response("Unhandled webhook topic", { status: 404 });
  }

  throw new Response();
};

async function processOrderConversion(
  shopRecord: any,
  orderPayload: any,
  topic: string
) {
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
      const conversionData = {
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
        lineItems: order.line_items?.map((item: any) => ({
          productId: String(item.product_id),
          variantId: String(item.variant_id),
          name: item.name,
          quantity: item.quantity,
          price: parseFloat(item.price),
        })),
      };

      switch (pixelConfig.platform) {
        case "google":
          result = await sendConversionToGoogle(
            pixelConfig.credentials,
            conversionData
          );
          break;
        case "meta":
          result = await sendConversionToMeta(
            pixelConfig.credentials,
            conversionData
          );
          break;
        case "tiktok":
          result = await sendConversionToTikTok(
            pixelConfig.credentials,
            conversionData
          );
          break;
        default:
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
      // Update log with failure
      await prisma.conversionLog.update({
        where: { id: conversionLog.id },
        data: {
          status: conversionLog.attempts >= 3 ? "failed" : "retrying",
          errorMessage: error instanceof Error ? error.message : "Unknown error",
        },
      });
    }
  }
}

