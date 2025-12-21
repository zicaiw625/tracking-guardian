

import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { generateEventId, normalizeOrderId } from "../utils/crypto";
import { 
  checkBillingGate, 
  incrementMonthlyUsage,
  type PlanId 
} from "../services/billing.server";

import { logger } from "../utils/logger";
import { parseOrderWebhookPayload } from "../utils/webhook-validation";
import type {
  OrderWebhookPayload,
  PixelConfigData,
} from "../types";
import type { Shop, PixelConfig } from "@prisma/client";

async function tryAcquireWebhookLock(
  shopDomain: string,
  webhookId: string | null,
  topic: string,
  orderId?: string
): Promise<{ acquired: boolean; existing?: boolean }> {
  if (!webhookId) {

    logger.warn(`[Webhook] Missing X-Shopify-Webhook-Id for topic ${topic} from ${shopDomain}`);
    return { acquired: true };
  }
  
  try {
    
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
    
    if ((error as { code?: string })?.code === "P2002") {
      logger.info(
        `[Webhook Idempotency] Duplicate webhook detected: ${topic} for ${shopDomain}, ` +
        `webhookId=${webhookId}`
      );
      return { acquired: false, existing: true };
    }
    
    logger.error(`[Webhook] Failed to acquire lock: ${error}`);
    return { acquired: true };
  }
}

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
    
    logger.error(`[Webhook] Failed to update status: ${error}`);
  }
}

interface ShopWithPixelConfigs extends Shop {
  pixelConfigs: PixelConfig[];
}

export const action = async ({ request }: ActionFunctionArgs) => {
  
  let topic: string;
  let shop: string;
  let session: unknown;
  let admin: unknown;
  let payload: unknown;

  try {
    const authResult = await authenticate.webhook(request);
    topic = authResult.topic;
    shop = authResult.shop;
    session = authResult.session;
    admin = authResult.admin;
    payload = authResult.payload;
  } catch (error) {
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

  try {
    
    const webhookId = request.headers.get("X-Shopify-Webhook-Id");

    if (webhookId) {
      const lock = await tryAcquireWebhookLock(shop, webhookId, topic);
      if (!lock.acquired) {
        
        logger.info(`[Webhook Idempotency] Skipping duplicate: ${topic} for ${shop}`);
        return new Response("OK (duplicate)", { status: 200 });
      }
    }

    if (!admin && topic !== "SHOP_REDACT" && topic !== "CUSTOMERS_DATA_REQUEST" && topic !== "CUSTOMERS_REDACT") {
      
      logger.info(`Webhook ${topic} received for uninstalled shop ${shop}`);
      return new Response("OK", { status: 200 });
    }

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
        
        if (shopRecord) {
          await prisma.shop.update({
            where: { id: shopRecord.id },
            data: {
              isActive: false,
              uninstalledAt: new Date(),
            },
          });
        }
        
        if (webhookId) {
          await updateWebhookStatus(shop, webhookId, topic, "processed");
        }
        logger.info(`Successfully processed APP_UNINSTALLED for shop ${shop}`);
        break;

      case "ORDERS_PAID":

        if (shopRecord && payload) {
          const orderPayload = parseOrderWebhookPayload(payload, shop);
          if (!orderPayload) {
            logger.warn(`Invalid ORDERS_PAID payload from ${shop}, skipping`);
            if (webhookId) {
              await updateWebhookStatus(shop, webhookId, topic, "failed");
            }
            return new Response("Invalid payload", { status: 400 });
          }
          
          const orderId = normalizeOrderId(String(orderPayload.id));
          logger.info(`Processing ${topic} webhook for shop ${shop}, order ${orderId}`);

          const billingCheck = await checkBillingGate(
            shopRecord.id,
            (shopRecord.plan || "free") as PlanId
          );
          
          if (!billingCheck.allowed) {
            logger.info(
              `Billing gate blocked order ${orderId}: ${billingCheck.reason}, ` +
              `usage=${billingCheck.usage.current}/${billingCheck.usage.limit}`
            );

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
                  
                  orderNumber: orderPayload.order_number ? String(orderPayload.order_number) : null,
                  orderValue: parseFloat(orderPayload.total_price || "0"),
                  currency: orderPayload.currency || "USD",
                  eventId: blockedEventId,
                  status: "failed",
                  errorMessage: `Monthly limit exceeded: ${billingCheck.usage.current}/${billingCheck.usage.limit}`,
                },
              });
            }

            if (webhookId) {
              await updateWebhookStatus(shop, webhookId, topic, "processed", orderId);
            }

            break;
          }

          await queueOrderForProcessing(
            shopRecord as ShopWithPixelConfigs,
            orderPayload
          );

          if (webhookId) {
            await updateWebhookStatus(shop, webhookId, topic, "processed", orderId);
          }
          
          logger.info(`Order ${orderId} queued for processing`);
        } else {
          logger.warn(`Skipping ${topic}: shopRecord=${!!shopRecord}, payload=${!!payload}`);
        }
        break;
      
      case "ORDERS_UPDATED":
        
        logger.info(`Order updated for shop ${shop}: order_id=${(payload as { id?: number })?.id}`);
        break;

      case "CUSTOMERS_DATA_REQUEST":
        logger.info(`GDPR data request received for shop ${shop}`);
        try {
          const dataRequestPayload = payload as {
            shop_id?: number;
            shop_domain?: string;
            orders_requested?: number[];
            customer?: { id?: number; email?: string; phone?: string };
            data_request?: { id?: number };
          };
          
          const minimalPayload = {
            shop_id: dataRequestPayload.shop_id,
            shop_domain: dataRequestPayload.shop_domain,
            orders_requested: dataRequestPayload.orders_requested || [],
            customer_id: dataRequestPayload.customer?.id,
            data_request_id: dataRequestPayload.data_request?.id,
          };
          
          await prisma.gDPRJob.create({
            data: {
              shopDomain: shop,
              jobType: "data_request",
              payload: minimalPayload,
              status: "queued",
            },
          });
          logger.info(`GDPR data request queued for ${shop}`);
        } catch (queueError) {
          logger.error("Failed to queue GDPR data request:", queueError);
        }
        break;

      case "CUSTOMERS_REDACT":
        logger.info(`GDPR customer redact request for shop ${shop}`);
        try {
          const customerRedactPayload = payload as {
            shop_id?: number;
            shop_domain?: string;
            customer?: { id?: number; email?: string; phone?: string };
            orders_to_redact?: number[];
          };
          
          const minimalPayload = {
            shop_id: customerRedactPayload.shop_id,
            shop_domain: customerRedactPayload.shop_domain,
            customer_id: customerRedactPayload.customer?.id,
            orders_to_redact: customerRedactPayload.orders_to_redact || [],
          };
          
          await prisma.gDPRJob.create({
            data: {
              shopDomain: shop,
              jobType: "customer_redact",
              payload: minimalPayload,
              status: "queued",
            },
          });
          logger.info(`GDPR customer redact queued for ${shop}`);
        } catch (queueError) {
          logger.error("Failed to queue GDPR customer redact:", queueError);
        }
        break;

      case "SHOP_REDACT":
        logger.info(`GDPR shop redact request for shop ${shop}`);
        try {
          const shopRedactPayload = payload as {
            shop_id?: number;
            shop_domain?: string;
          };
          
          const minimalPayload = {
            shop_id: shopRedactPayload.shop_id,
            shop_domain: shopRedactPayload.shop_domain,
          };
          
          await prisma.gDPRJob.create({
            data: {
              shopDomain: shop,
              jobType: "shop_redact",
              payload: minimalPayload,
              status: "queued",
            },
          });
          logger.info(`GDPR shop redact queued for ${shop}`);
        } catch (queueError) {
          logger.error("Failed to queue GDPR shop redact:", queueError);
        }
        break;

      default:
        logger.warn(`Unhandled webhook topic: ${topic}`);
        return new Response(`Unhandled webhook topic: ${topic}`, { status: 404 });
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    logger.error("Webhook processing error:", {
      message: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });

    return new Response("Webhook processing failed", { status: 500 });
  }
};

function buildCapiInput(orderPayload: OrderWebhookPayload, orderId: string): object {

  const items = orderPayload.line_items?.map((item) => ({
    productId: item.product_id ? String(item.product_id) : undefined,
    variantId: item.variant_id ? String(item.variant_id) : undefined,
    sku: item.sku || undefined,
    name: item.title || item.name || "",
    quantity: item.quantity || 1,
    price: parseFloat(item.price || "0"),
  })) || [];

  const contentIds = items
    .map(item => item.productId)
    .filter((id): id is string => !!id);

  return {
    
    orderId,
    value: parseFloat(orderPayload.total_price || "0"),
    currency: orderPayload.currency || "USD",
    orderNumber: orderPayload.order_number ? String(orderPayload.order_number) : null,

    items,
    
    contentIds,
    numItems: items.reduce((sum, item) => sum + item.quantity, 0),

    tax: parseFloat(orderPayload.total_tax || "0"),
    shipping: parseFloat(orderPayload.total_shipping_price_set?.shop_money?.amount || "0"),

    processedAt: orderPayload.processed_at || new Date().toISOString(),
    webhookReceivedAt: new Date().toISOString(),

    checkoutToken: orderPayload.checkout_token || null,

    shopifyOrderId: orderPayload.id,

  };
}

async function queueOrderForProcessing(
  shopRecord: ShopWithPixelConfigs,
  orderPayload: OrderWebhookPayload
): Promise<void> {
  const orderId = normalizeOrderId(String(orderPayload.id));

  const capiInput = buildCapiInput(orderPayload, orderId);

  try {

    const createData = {
      shopId: shopRecord.id,
      orderId,
      orderNumber: orderPayload.order_number ? String(orderPayload.order_number) : null,
      orderValue: parseFloat(orderPayload.total_price || "0"),
      currency: orderPayload.currency || "USD",
      capiInput: capiInput as object,
      status: "queued",
    };
    
    const updateData = {
      orderNumber: orderPayload.order_number ? String(orderPayload.order_number) : null,
      orderValue: parseFloat(orderPayload.total_price || "0"),
      currency: orderPayload.currency || "USD",
      
      capiInput: capiInput as object,
    };
    
    await prisma.conversionJob.upsert({
      where: {
        shopId_orderId: {
          shopId: shopRecord.id,
          orderId,
        },
      },
      
      create: createData as Parameters<typeof prisma.conversionJob.upsert>[0]["create"],
      update: updateData as Parameters<typeof prisma.conversionJob.upsert>[0]["update"],
    });
    
    logger.info(`Order ${orderId} queued for async processing`);
  } catch (error) {
    logger.error(`Failed to queue order ${orderId}:`, error);
  }
}

