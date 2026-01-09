import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../../db.server";
import {
  getTrackingInfo,
  type TrackingProviderConfig,
  type TrackingInfo,
} from "../../services/shipping-tracker.server";
import { logger } from "../../utils/logger.server";
import type { OrderTrackingSettings } from "../../types/ui-extension";

import { authenticate, createAdminClientForShop } from "../../shopify.server";
import { optionsResponse, jsonWithCors } from "../../utils/cors";
import { withRateLimit, pathShopKeyExtractor, type RateLimitedHandler } from "../../middleware/rate-limit";
import { withConditionalCache } from "../../lib/with-cache";
import { TTL } from "../../utils/cache";
import { getUiModuleConfig } from "../../services/ui-extension.server";

interface FulfillmentNode {
  trackingInfo?: {
    number: string;
    company: string;
    url?: string;
  };
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

    let session: { shop: string; [key: string]: unknown };
    try {
      const authResult = await authenticate.public.checkout(request) as unknown as { session: { shop: string; [key: string]: unknown } };
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
      },
    });

    if (!shop) {
      return jsonWithCors({ error: "Shop not found" }, { status: 404, request, staticCors: true });
    }

    const trackingModuleConfig = await getUiModuleConfig(shop.id, "order_tracking");
    const trackingSettings = trackingModuleConfig.isEnabled
      ? (trackingModuleConfig.settings as OrderTrackingSettings | undefined)
      : undefined;

    let trackingInfo: TrackingInfo | null = null;
    let trackingNumberFromShopify: string | null = null;
    let carrierFromShopify: string | null = null;
    let trackingUrlFromShopify: string | null = null;

    logger.info(`Tracking info requested for orderId: ${orderId}, shop: ${shopDomain}`, {
      hasTrackingNumber: !!trackingNumber,
      hasThirdPartyProvider: !!trackingSettings?.provider && trackingSettings.provider !== "native",
    });

    try {
      const admin = await createAdminClientForShop(shopDomain);
      if (admin) {
        const fulfillmentResponse = await admin.graphql(`
          query GetOrderFulfillments($id: ID!) {
            order(id: $id) {
              id
              fulfillments(first: 10) {
                edges {
                  node {
                    trackingInfo {
                      number
                      company
                      url
                    }
                    status
                  }
                }
              }
            }
          }
        `, {
          variables: {
            id: orderId,
          },
        });

        const fulfillmentData = await fulfillmentResponse.json().catch((jsonError) => {
          logger.warn("Failed to parse fulfillment GraphQL response as JSON", {
            error: jsonError instanceof Error ? jsonError.message : String(jsonError),
            orderId,
            shopDomain,
          });
          return { data: null };
        });

        if (fulfillmentData.data?.order?.fulfillments?.edges?.length > 0) {

          const firstFulfillment = fulfillmentData.data.order.fulfillments.edges[0].node;
          if (firstFulfillment.trackingInfo) {
            trackingNumberFromShopify = firstFulfillment.trackingInfo.number || null;
            carrierFromShopify = firstFulfillment.trackingInfo.company || null;
            trackingUrlFromShopify = firstFulfillment.trackingInfo.url || null;
            logger.info(`Found tracking info from Shopify for orderId: ${orderId}`, {
              trackingNumber: trackingNumberFromShopify,
              carrier: carrierFromShopify,
            });
          }
        }
      }
    } catch (error) {

      logger.warn("Failed to query Shopify order fulfillments", {
        error: error instanceof Error ? error.message : String(error),
        orderId,
        shopDomain,
      });
    }

    const trackingNumberToUse = trackingNumber || trackingNumberFromShopify || null;

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

          const enrichedTracking = thirdPartyTracking;
          trackingInfo = {
            ...enrichedTracking,
            carrier: enrichedTracking.carrier || trackingInfo?.carrier || "unknown",
            trackingNumber: enrichedTracking.trackingNumber || trackingInfo?.trackingNumber || trackingNumberToUse,
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

      if (trackingNumberToUse) {
        return jsonWithCors(
          {
            success: true,
            tracking: {
              trackingNumber: trackingNumberToUse,
              status: "pending_fulfillment",
              statusDescription: "物流信息已生成，正在等待承运商更新状态",
              carrier: carrierFromShopify || null,
              estimatedDelivery: null,
              events: [],
              ...(trackingUrlFromShopify ? { trackingUrl: trackingUrlFromShopify } : {}),
            },
          },
          { status: 200, request, staticCors: true }
        );
      }

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
