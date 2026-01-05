
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../../db.server";
import {
  getTrackingInfo,
  type TrackingProviderConfig,
} from "../../services/shipping-tracker.server";
import { logger } from "../../utils/logger.server";
import type { OrderTrackingSettings } from "../../types/ui-extension";
// P0-1: 使用官方 authenticate.public.checkout 处理 Checkout UI Extension 请求
import { authenticate } from "../../shopify.server";
import { optionsResponse, jsonWithCors } from "../../utils/cors";
import { withRateLimit, pathShopKeyExtractor, type RateLimitedHandler } from "../../middleware/rate-limit";
import { withConditionalCache } from "../../lib/with-cache";
import { TTL } from "../../utils/cache";

interface FulfillmentNode {
  trackingInfo?: {
    number: string;
    company: string;
    url?: string;
  };
}

interface TrackingInfo {
  number: string;
  company: string;
  url?: string;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return optionsResponse(request, true);
  }
  return jsonWithCors({ error: "Method not allowed" }, { status: 405, request, staticCors: true });
};

const trackingRateLimit = withRateLimit<Response>({
  maxRequests: 60,
  windowMs: 60 * 1000,
  keyExtractor: pathShopKeyExtractor,
  message: "Too many tracking requests",
}) as (handler: RateLimitedHandler<Response>) => RateLimitedHandler<Response | Response>;

const rateLimitedLoader = trackingRateLimit(async (args: LoaderFunctionArgs | ActionFunctionArgs): Promise<Response> => {
  return await loaderImpl((args as LoaderFunctionArgs).request);
});

const cachedLoader = withConditionalCache(
  async (args: LoaderFunctionArgs) => {
    return await rateLimitedLoader(args);
  },
  {
    key: (args) => {
      if (!args?.request || typeof args.request.url !== "string") {
        return null;
      }
      try {
        const url = new URL(args.request.url);
        const orderId = url.searchParams.get("orderId");
        const shop = url.searchParams.get("shop") || "unknown";
        return orderId ? `tracking:${shop}:${orderId}` : null;
      } catch (error) {
        logger.warn("[api.tracking] Failed to generate cache key", { error });
        return null;
      }
    },
    ttl: TTL.MEDIUM,
    shouldCache: (result) => {

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

    // P0-1: 使用官方 authenticate.public.checkout 处理 Checkout UI Extension 请求
    // 这会自动处理 JWT 验证和 CORS，并返回 session 信息
    let session;
    try {
      const authResult = await authenticate.public.checkout(request);
      session = authResult.session;
    } catch (authError) {
      logger.warn("Checkout authentication failed", {
        error: authError instanceof Error ? authError.message : String(authError),
      });
      return jsonWithCors(
        { error: "Unauthorized: Invalid authentication" },
        { status: 401, request, staticCors: true }
      );
    }

    const shopDomain = session.shop;
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: {
        id: true,
        UiExtensionSetting: {
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

    // P0-5: 使用 getUiModuleConfig 获取已解密的配置（包含解密后的 apiKey）
    const { getUiModuleConfig } = await import("../../services/ui-extension.server");
    const trackingModuleConfig = await getUiModuleConfig(shop.id, "order_tracking");
    const trackingSettings = trackingModuleConfig.isEnabled 
      ? (trackingModuleConfig.settings as OrderTrackingSettings | undefined)
      : undefined;

    let trackingInfo = null;
    let trackingNumberFromShopify: string | null = null;

    // P0-5: v1.0 版本不包含 read_orders scope，因此移除对 Shopify 订单 GraphQL 查询的依赖
    // v1.0 版本仅支持通过用户提供的 trackingNumber 或第三方 API 查询物流信息
    // 如果需要读取 Shopify 订单信息，需要 v1.1+ 版本并添加 read_orders scope
    // 
    // 注意：在 v1.0 中，ShippingTracker 将：
    // 1. 优先使用用户提供的 trackingNumber（来自 URL 参数）
    // 2. 如果配置了第三方追踪服务（AfterShip/17Track）且有 apiKey，使用第三方 API
    // 3. 否则返回提示信息，引导用户查看邮件或联系客服

    // v1.0: 不查询 Shopify 订单，直接使用提供的 trackingNumber 或第三方服务
    logger.info(`Tracking info requested for orderId: ${orderId}, shop: ${shopDomain}`, {
      hasTrackingNumber: !!trackingNumber,
      hasThirdPartyProvider: !!trackingSettings?.provider && trackingSettings.provider !== "native",
    });

    // v1.0: 使用用户提供的 trackingNumber（如果存在）
    const trackingNumberToUse = trackingNumber || trackingNumberFromShopify || null;
    
    // 如果没有 trackingNumber 且没有配置第三方服务，返回提示信息
    if (!trackingNumberToUse) {
      return jsonWithCors(
        {
          success: true,
          tracking: {
            trackingNumber: null,
            status: "pending_fulfillment",
            statusDescription: "物流信息将在发货后通过邮件通知您。如有疑问，请联系客服。",
            carrier: null,
            estimatedDelivery: null,
            events: [],
            // v1.0 提示：由于未配置 read_orders scope，无法自动获取物流单号
            // 用户可以通过邮件中的物流信息或联系客服获取追踪号码
            message: "物流追踪号码将在发货后的邮件中提供。",
          },
        },
        { status: 200, request, staticCors: true }
      );
    }

    if (trackingSettings?.provider && trackingSettings.provider !== "native" && trackingNumberToUse) {
      const config: TrackingProviderConfig = {
        provider: trackingSettings.provider,
        apiKey: trackingSettings.apiKey,
      };

      try {
        const thirdPartyTracking = await getTrackingInfo(
          config,
          trackingNumberToUse,
          trackingSettings.provider
        );

        if (thirdPartyTracking) {

          trackingInfo = {
            ...thirdPartyTracking,

            carrier: thirdPartyTracking.carrier || trackingInfo?.carrier || "unknown",

            trackingNumber: thirdPartyTracking.trackingNumber || trackingInfo?.trackingNumber || trackingNumberToUse,
          };
          logger.info(`Third-party tracking enrich successful for orderId: ${orderId}, provider: ${trackingSettings.provider}`);
        } else {

          logger.warn(`Third-party tracking enrich failed for orderId: ${orderId}, provider: ${trackingSettings.provider}, falling back to Shopify data`);
        }
      } catch (error) {

        logger.error(`Third-party tracking enrich error for orderId: ${orderId}`, {
          error: error instanceof Error ? error.message : String(error),
          provider: trackingSettings.provider,
        });

      }
    }

    if (!trackingInfo) {

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

    // P2-14: 返回字段最小化，只返回展示所需的 tracking 字段
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

