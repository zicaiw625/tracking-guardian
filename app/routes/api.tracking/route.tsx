
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../../db.server";
import {
  getTrackingInfo,
  getTrackingFromShopifyOrder,
  type TrackingProviderConfig,
} from "../../services/shipping-tracker.server";
import { logger } from "../../utils/logger.server";
import type { OrderTrackingSettings } from "../../types/ui-extension";
import { verifyShopifyJwt, extractAuthToken, getShopifyApiSecret } from "../../utils/shopify-jwt";
import { createAdminClientForShop } from "../../shopify.server";
import { optionsResponse, jsonWithCors } from "../../utils/cors";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return optionsResponse(request, true); // 使用 staticCors=true 以支持 GET 方法
  }
  return jsonWithCors({ error: "Method not allowed" }, { status: 405, request, staticCors: true });
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const url = new URL(request.url);
    const orderId = url.searchParams.get("orderId");
    const trackingNumber = url.searchParams.get("trackingNumber");

    if (!orderId) {
      return jsonWithCors({ error: "Missing orderId" }, { status: 400, request, staticCors: true });
    }

    // 支持 session token 认证（来自 UI extension）
    const authToken = extractAuthToken(request);
    
    let shopDomain: string;
    let admin: Awaited<ReturnType<typeof createAdminClientForShop>> | null = null;
    
    if (authToken) {
      // 使用 session token 认证（Checkout UI Extension 场景）
      const apiSecret = getShopifyApiSecret();
      const expectedAud = process.env.SHOPIFY_API_KEY;
      
      if (!expectedAud) {
        logger.error("SHOPIFY_API_KEY not configured");
        return jsonWithCors({ error: "Server configuration error" }, { status: 500, request, staticCors: true });
      }

      // 验证 JWT token（从 token 的 dest 提取 shop domain，不依赖 header）
      const jwtResult = await verifyShopifyJwt(authToken, apiSecret, undefined, expectedAud);
      
      if (!jwtResult.valid || !jwtResult.shopDomain) {
        logger.warn(`JWT verification failed: ${jwtResult.error}`);
        return jsonWithCors({ error: `Unauthorized: ${jwtResult.error}` }, { status: 401, request, staticCors: true });
      }
      
      shopDomain = jwtResult.shopDomain;
      
      // 使用离线 token 创建 Admin Client（不依赖 authenticate.admin）
      admin = await createAdminClientForShop(shopDomain);
      
      if (!admin) {
        // 如果 admin 认证失败，我们仍然可以继续，只是无法从 Shopify 获取订单信息
        logger.warn("Failed to create admin client, will try to use tracking provider only", {
          shopDomain,
        });
      }
    } else {
      // 如果没有 session token，返回未授权（不再支持 admin 认证回退，因为这是给 Checkout UI Extension 用的）
      logger.warn("Missing authentication token");
      return jsonWithCors({ error: "Unauthorized: Missing authentication token" }, { status: 401, request, staticCors: true });
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
      return jsonWithCors({ error: "Shop not found" }, { status: 404, request, staticCors: true });
    }

    const trackingSettings = shop.uiExtensionSettings[0]?.settingsJson as
      | OrderTrackingSettings
      | undefined;

    let trackingInfo = null;
    let trackingNumberFromShopify: string | null = null;
    
    // 先尝试从 Shopify 订单中获取物流信息
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
          // 保存从 Shopify 获取到的 trackingNumber，用于后续调用第三方
          trackingNumberFromShopify = trackingInfo?.trackingNumber || null;
          // 记录订单访问日志（用于安全审计）
          logger.info(`Tracking info requested for orderId: ${orderId}, shop: ${shopDomain}`);
        } else {
          // 安全说明：
          // 1. Shopify Admin API 会自动限制只能查询该 shop 的订单
          // 2. 如果订单不存在或不属于该 shop，Admin API 会返回 null
          // 3. 这提供了基础的订单归属保护，防止跨 shop 访问订单
          // 4. Checkout UI Extension 运行在订单确认页面，用户已能查看自己的订单，风险相对较低
          // 5. 如果需要更严格的验证，可以考虑使用 JWT payload 中的 sub claim（customer gid）来验证订单归属
          logger.info(`Order not found or access denied for orderId: ${orderId}, shop: ${shopDomain}`);
        }
      } catch (error) {
        logger.warn("Failed to fetch order from Shopify", {
          error: error instanceof Error ? error.message : String(error),
          orderId,
        });
      }
    }

    // 如果从 Shopify 获取到了 trackingInfo，且配置了第三方 provider，尝试从第三方获取更详细的信息
    // 如果没获取到，且有传入的 trackingNumber 或从 Shopify 获取到的 trackingNumber，尝试从第三方获取
    const trackingNumberToUse = trackingNumberFromShopify || trackingNumber || null;
    if (trackingSettings?.provider && trackingSettings.provider !== "native" && trackingNumberToUse) {
      const config: TrackingProviderConfig = {
        provider: trackingSettings.provider,
        apiKey: trackingSettings.apiKey,
      };

      const thirdPartyTracking = await getTrackingInfo(
        config,
        trackingNumberToUse,
        trackingSettings.carrier
      );
      
      // 如果从第三方获取到了更详细的信息，使用第三方的结果；否则使用 Shopify 的结果
      if (thirdPartyTracking) {
        trackingInfo = thirdPartyTracking;
      }
    }

    if (!trackingInfo) {
      return jsonWithCors(
        {
          trackingNumber,
          status: "Unknown",
          message: "追踪信息不可用",
        },
        { status: 404, request, staticCors: true }
      );
    }

    return jsonWithCors({
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
    }, { request, staticCors: true });
  } catch (error) {
    logger.error("Failed to fetch tracking info", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonWithCors({ error: "Failed to fetch tracking info" }, { status: 500, request, staticCors: true });
  }
};

