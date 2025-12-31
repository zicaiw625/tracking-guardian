
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import {
  getTrackingInfo,
  getTrackingFromShopifyOrder,
  type TrackingProviderConfig,
} from "../services/shipping-tracker.server";
import { logger } from "../utils/logger.server";
import type { OrderTrackingSettings } from "../types/ui-extension";
import { verifyShopifyJwt, extractAuthToken, getShopifyApiSecret } from "../../utils/shopify-jwt";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const url = new URL(request.url);
    const orderId = url.searchParams.get("orderId");
    const trackingNumber = url.searchParams.get("trackingNumber");

    if (!orderId) {
      return json({ error: "Missing orderId" }, { status: 400 });
    }

    // 支持 session token 认证（来自 UI extension）
    const authToken = extractAuthToken(request);
    const shopHeader = request.headers.get("X-Shopify-Shop-Domain");
    
    let shopDomain: string;
    let admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"] | null = null;
    
    if (authToken && shopHeader) {
      // 使用 session token 认证
      const apiSecret = getShopifyApiSecret();
      const jwtResult = await verifyShopifyJwt(authToken, apiSecret, shopHeader);
      
      if (!jwtResult.valid || !jwtResult.shopDomain) {
        logger.warn(`JWT verification failed for shop ${shopHeader}: ${jwtResult.error}`);
        return json({ error: `Unauthorized: ${jwtResult.error}` }, { status: 401 });
      }
      
      shopDomain = jwtResult.shopDomain;
      
      // 对于 session token，我们仍然需要使用 admin API 来获取订单信息
      // 通过 shopDomain 查找 shop，然后使用 shop 的 access token 来调用 admin API
      try {
        const { admin: adminClient } = await authenticate.admin(request);
        admin = adminClient;
      } catch (error) {
        // 如果 admin 认证失败，我们仍然可以继续，只是无法从 Shopify 获取订单信息
        logger.warn("Admin authentication failed, will try to use tracking provider only", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      // 回退到 admin 认证（用于内部调用）
      try {
        const { session, admin: adminClient } = await authenticate.admin(request);
        shopDomain = session.shop;
        admin = adminClient;
      } catch (error) {
        logger.warn("Authentication failed", error);
        return json({ error: "Unauthorized" }, { status: 401 });
      }
    }
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: {
        id: true,
        uiExtensionSettings: {
          where: {
            moduleKey: "order_tracking",
            isEnabled: true,
          },
          select: {
            settingsJson: true,
          },
        },
      },
    });

    if (!shop) {
      return json({ error: "Shop not found" }, { status: 404 });
    }

    const trackingSettings = shop.uiExtensionSettings[0]?.settingsJson as
      | OrderTrackingSettings
      | undefined;

    let trackingInfo = null;
    if (admin) {
      try {
        const orderResponse = await admin.graphql(`
          query GetOrder($id: ID!) {
            order(id: $id) {
              id
              fulfillments {
                trackingInfo {
                  number
                  company
                  url
                }
              }
            }
          }
        `, {
          variables: {
            id: orderId,
          },
        });

        const orderData = await orderResponse.json();
        if (orderData.data?.order) {
          trackingInfo = await getTrackingFromShopifyOrder(orderData.data.order);
        }
      } catch (error) {
        logger.warn("Failed to fetch order from Shopify", {
          error: error instanceof Error ? error.message : String(error),
          orderId,
        });
      }
    }

    // 如果从 Shopify 订单中获取到了物流信息，直接返回
    // 否则，如果有第三方物流提供商配置，尝试从第三方获取
    if (!trackingInfo && trackingSettings?.provider && trackingSettings.provider !== "native" && trackingNumber) {
      const config: TrackingProviderConfig = {
        provider: trackingSettings.provider,
        apiKey: trackingSettings.apiKey,
      };

      trackingInfo = await getTrackingInfo(
        config,
        trackingNumber,
        trackingSettings.carrier
      );
    }

    if (!trackingInfo) {
      return json(
        {
          trackingNumber,
          status: "Unknown",
          message: "追踪信息不可用",
        },
        { status: 404 }
      );
    }

    return json({
      success: true,
      tracking: {
        trackingNumber: trackingInfo.trackingNumber,
        carrier: trackingInfo.carrier,
        status: trackingInfo.status,
        statusDescription: trackingInfo.statusDescription,
        estimatedDelivery: trackingInfo.estimatedDelivery?.toISOString(),
        events: trackingInfo.events.map((event) => ({
          timestamp: event.timestamp.toISOString(),
          location: event.location,
          description: event.description,
          status: event.status,
        })),
      },
    });
  } catch (error) {
    logger.error("Failed to fetch tracking info", {
      error: error instanceof Error ? error.message : String(error),
    });
    return json({ error: "Failed to fetch tracking info" }, { status: 500 });
  }
};

