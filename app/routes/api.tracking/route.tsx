
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  getTrackingInfo,
  getTrackingFromShopifyOrder,
  type TrackingProviderConfig,
} from "../services/shipping-tracker.server";
import { logger } from "../utils/logger.server";
import type { OrderTrackingSettings } from "../types/ui-extension";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session, admin } = await authenticate.admin(request);
    const url = new URL(request.url);
    const orderId = url.searchParams.get("orderId");
    const trackingNumber = url.searchParams.get("trackingNumber");

    if (!orderId) {
      return json({ error: "Missing orderId" }, { status: 400 });
    }

    const shop = await prisma.shop.findUnique({
      where: { shopDomain: session.shop },
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

