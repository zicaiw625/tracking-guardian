
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
import { withRateLimit, pathShopKeyExtractor } from "../../middleware/rate-limit";
import { withConditionalCache } from "../../lib/with-cache";
import { TTL } from "../../utils/cache";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return optionsResponse(request, true); // 使用 staticCors=true 以支持 GET 方法
  }
  return jsonWithCors({ error: "Method not allowed" }, { status: 405, request, staticCors: true });
};

// Rate limit 配置：每个 shop 每分钟最多 60 次请求（避免重复渲染导致暴击）
const trackingRateLimit = withRateLimit({
  maxRequests: 60,
  windowMs: 60 * 1000, // 1 分钟
  keyExtractor: pathShopKeyExtractor,
  message: "Too many tracking requests",
});

// 缓存配置：per shop + per orderId，60 秒 TTL（物流信息变化不频繁）
const cachedLoader = withConditionalCache(
  trackingRateLimit(async ({ request }: LoaderFunctionArgs) => {
    return await loaderImpl(request);
  }),
  {
    key: (args) => {
      const url = new URL(args.request.url);
      const orderId = url.searchParams.get("orderId");
      const shop = url.searchParams.get("shop") || "unknown";
      return orderId ? `tracking:${shop}:${orderId}` : null;
    },
    ttl: TTL.MEDIUM, // 60 秒
    shouldCache: (result) => {
      // 只缓存成功响应（200），不缓存 202（订单正在生成）或错误响应
      if (result instanceof Response) {
        return result.status === 200;
      }
      return false;
    },
  }
);

export const loader = cachedLoader;

async function loaderImpl(request: Request) {
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
      
      // 获取 JWT payload 中的 sub claim（customer gid），用于后续订单归属验证
      const customerGidFromToken = jwtResult.payload?.sub || null;
      
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
              customer {
                id
              }
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
          // 安全验证：如果 JWT 中有 customer gid（sub claim），验证订单是否属于该 customer
          // 这提供了更严格的订单归属保护，防止越权访问
          // 注意：Checkout UI extensions 的 session token 可能没有 sub claim（匿名购买场景）
          // 只有在有 sub claim 时才进行严格的归属验证
          const orderCustomerId = orderData.data.order.customer?.id || null;
          if (customerGidFromToken && orderCustomerId) {
            // 规范化 customer gid 格式以便比较
            // token 中的 sub 可能是 "gid://shopify/Customer/123456" 或纯数字
            // order 中的 customer.id 是 "gid://shopify/Customer/123456" 格式
            const normalizeCustomerGid = (gid: string): string => {
              // 如果是完整 gid 格式，提取数字部分
              const gidMatch = gid.match(/gid:\/\/shopify\/Customer\/(\d+)/);
              if (gidMatch) {
                return gidMatch[1];
              }
              // 如果已经是纯数字，直接返回
              if (/^\d+$/.test(gid)) {
                return gid;
              }
              // 其他格式，尝试提取最后的数字部分
              const lastNum = gid.split("/").pop();
              return lastNum && /^\d+$/.test(lastNum) ? lastNum : gid;
            };
            
            const tokenCustomerId = normalizeCustomerGid(customerGidFromToken);
            const orderCustomerIdNum = normalizeCustomerGid(orderCustomerId);
            
            // 如果 customer ID 不匹配，拒绝访问
            if (tokenCustomerId !== orderCustomerIdNum) {
              logger.warn(`Order access denied: customer mismatch for orderId: ${orderId}, shop: ${shopDomain}`, {
                tokenCustomerId,
                orderCustomerId: orderCustomerIdNum,
              });
              return jsonWithCors({ error: "Order access denied" }, { status: 403, request, staticCors: true });
            }
          }
          
          trackingInfo = await getTrackingFromShopifyOrder(orderData.data.order);
          // 保存从 Shopify 获取到的 trackingNumber，用于后续调用第三方
          trackingNumberFromShopify = trackingInfo?.trackingNumber || null;
          // 记录订单访问日志（用于安全审计）
          logger.info(`Tracking info requested for orderId: ${orderId}, shop: ${shopDomain}`, {
            hasCustomerVerification: !!customerGidFromToken,
          });
        } else {
          // Shopify 官方明确提到：Thank you 页渲染时订单可能尚未创建，但 order id 已可用
          // 需要等订单创建完成后再去查 Admin GraphQL，通常要等 1-2 秒再查才稳定
          // 返回 202 Accepted + Retry-After，让客户端按指示重试
          logger.info(`Order not found (may be still creating) for orderId: ${orderId}, shop: ${shopDomain}`);
          return jsonWithCors(
            {
              success: false,
              error: "Order not found",
              message: "订单正在生成，请稍后重试",
              retryAfter: 2, // 建议 2 秒后重试
            },
            {
              status: 202,
              request,
              staticCors: true,
              headers: {
                "Retry-After": "2",
              },
            }
          );
        }
      } catch (error) {
        logger.warn("Failed to fetch order from Shopify", {
          error: error instanceof Error ? error.message : String(error),
          orderId,
        });
      }
    }

    // 核心逻辑：如果配置了第三方 provider（且不是 native），并且有 tracking number，
    // 应该用该 tracking number 去第三方 enrich（把 events/status 补全）
    // 这样即使从 Shopify 获取到了简版 trackingInfo，也能拿到完整的物流节点事件
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
      
      // 如果从第三方获取到了更详细的信息，使用第三方的结果（包含完整 events）
      // 如果第三方查询失败，回退到 Shopify 的简版信息（至少保证有 tracking number 和基础状态）
      if (thirdPartyTracking) {
        trackingInfo = thirdPartyTracking;
      }
      // 注意：如果 thirdPartyTracking 为 null，我们仍然使用之前从 Shopify 获取的 trackingInfo
      // 这样即使第三方查询失败，用户至少能看到 tracking number 和基础状态
    }

    if (!trackingInfo) {
      // 返回 200 状态码，表示请求成功但暂未生成物流信息（pending_fulfillment）
      // 这样前端可以正常处理，显示"暂未发货"等状态，而不是错误页面
      return jsonWithCors(
        {
          success: true,
          tracking: {
            trackingNumber: trackingNumber || null,
            status: "pending_fulfillment",
            statusDescription: "暂未生成物流信息",
            carrier: null,
            estimatedDelivery: null,
            events: [],
          },
        },
        { status: 200, request, staticCors: true }
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
}

