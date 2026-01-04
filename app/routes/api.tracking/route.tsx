
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
    return optionsResponse(request, true);
  }
  return jsonWithCors({ error: "Method not allowed" }, { status: 405, request, staticCors: true });
};

const trackingRateLimit = withRateLimit({
  maxRequests: 60,
  windowMs: 60 * 1000,
  keyExtractor: pathShopKeyExtractor,
  message: "Too many tracking requests",
});

const cachedLoader = withConditionalCache(
  trackingRateLimit(async ({ request }: LoaderFunctionArgs) => {
    return await loaderImpl(request);
  }) as (args: LoaderFunctionArgs) => Promise<Response>,
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

    const authToken = extractAuthToken(request);

    let shopDomain: string;
    let admin: Awaited<ReturnType<typeof createAdminClientForShop>> | null = null;
    let customerGidFromToken: string | null = null;

    if (authToken) {

      const apiSecret = getShopifyApiSecret();
      const expectedAud = process.env.SHOPIFY_API_KEY;

      if (!expectedAud) {
        logger.error("SHOPIFY_API_KEY not configured");
        return jsonWithCors({ error: "Server configuration error" }, { status: 500, request, staticCors: true });
      }

      const jwtResult = await verifyShopifyJwt(authToken, apiSecret, undefined, expectedAud);

      if (!jwtResult.valid || !jwtResult.shopDomain) {
        logger.warn(`JWT verification failed: ${jwtResult.error}`);
        return jsonWithCors({ error: `Unauthorized: ${jwtResult.error}` }, { status: 401, request, staticCors: true });
      }

      shopDomain = jwtResult.shopDomain;

      customerGidFromToken = jwtResult.payload?.sub || null;

      admin = await createAdminClientForShop(shopDomain);

      if (!admin) {

        logger.warn("Failed to create admin client, will try to use tracking provider only", {
          shopDomain,
        });
      }
    } else {

      logger.warn("Missing authentication token");
      return jsonWithCors({ error: "Unauthorized: Missing authentication token" }, { status: 401, request, staticCors: true });
    }
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

    const trackingSettings = shop.UiExtensionSetting[0]?.settingsJson as
      | OrderTrackingSettings
      | undefined;

    let trackingInfo = null;
    let trackingNumberFromShopify: string | null = null;

    if (admin) {
      try {
        const orderResponse = await admin.graphql(`
          query GetOrder($id: ID!) {
            order(id: $id) {
              id
              customer {
                id
              }
              fulfillments(first: 10) {
                nodes {
                  trackingInfo {
                    number
                    company
                    url
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

        const orderData = await orderResponse.json();
        if (orderData.data?.order) {

          const orderCustomerId = orderData.data.order.customer?.id || null;
          if (customerGidFromToken && orderCustomerId) {

            const normalizeCustomerGid = (gid: string): string => {

              const gidMatch = gid.match(/gid:\/\/shopify\/Customer\/(\d+)/);
              if (gidMatch) {
                return gidMatch[1];
              }

              if (/^\d+$/.test(gid)) {
                return gid;
              }

              const lastNum = gid.split("/").pop();
              return lastNum && /^\d+$/.test(lastNum) ? lastNum : gid;
            };

            const tokenCustomerId = normalizeCustomerGid(customerGidFromToken);
            const orderCustomerIdNum = normalizeCustomerGid(orderCustomerId);

            if (tokenCustomerId !== orderCustomerIdNum) {
              logger.warn(`Order access denied: customer mismatch for orderId: ${orderId}, shop: ${shopDomain}`, {
                tokenCustomerId,
                orderCustomerId: orderCustomerIdNum,
              });
              return jsonWithCors({ error: "Order access denied" }, { status: 403, request, staticCors: true });
            }
          }

          const fulfillments = orderData.data.order.fulfillments?.nodes || [];
          const fulfillmentTrackingInfo = fulfillments
            .map((f: { trackingInfo?: { number: string; company: string; url?: string } }) => f.trackingInfo)
            .filter((ti: { number: string; company: string; url?: string } | undefined): ti is { number: string; company: string; url?: string } => !!ti);

          if (fulfillmentTrackingInfo.length > 0) {
            trackingNumberFromShopify = fulfillmentTrackingInfo[0].number;
          }

          trackingInfo = await getTrackingFromShopifyOrder({
            fulfillmentTrackingInfo,
          });

          logger.info(`Tracking info requested for orderId: ${orderId}, shop: ${shopDomain}`, {
            hasCustomerVerification: !!customerGidFromToken,
            hasTrackingNumber: !!trackingNumberFromShopify,
          });
        } else {

          logger.info(`Order not found (may be still creating) for orderId: ${orderId}, shop: ${shopDomain}`);
          return jsonWithCors(
            {
              success: false,
              error: "Order not found",
              message: "订单正在生成，请稍后重试",
              retryAfter: 2,
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

    const trackingNumberToUse = trackingNumberFromShopify || trackingNumber || null;
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

