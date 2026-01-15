import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../../db.server";
import {
  getTrackingInfo,
  type TrackingProviderConfig,
  type TrackingInfo,
} from "../../services/shipping-tracker.server";
import { logger } from "../../utils/logger.server";
import type { OrderTrackingSettings } from "../../types/ui-extension";

import { createAdminClientForShop } from "../../shopify.server";
import { optionsResponse, jsonWithCors } from "../../utils/cors";
import { checkRateLimitAsync } from "../../middleware/rate-limit";
import { defaultLoaderCache } from "../../lib/with-cache";
import { TTL } from "../../utils/cache";
import { getUiModuleConfig } from "../../services/ui-extension.server";
import { authenticatePublic, normalizeDestToShopDomain } from "../../utils/public-auth";

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

export const loader = async (args: LoaderFunctionArgs) => {
  return await loaderImpl(args.request);
};

async function loaderImpl(request: Request) {
  let authResult: Awaited<ReturnType<typeof authenticatePublic>> | null = null;
  try {
    const url = new URL(request.url);
    const orderId = url.searchParams.get("orderId");
    const trackingNumber = url.searchParams.get("trackingNumber");
    if (!orderId) {
      authResult = await authenticatePublic(request).catch(() => null);
      if (authResult) {
        return authResult.cors(jsonWithCors({ error: "Missing orderId" }, { status: 400, request, staticCors: true }));
      }
      return jsonWithCors({ error: "Missing orderId" }, { status: 400, request, staticCors: true });
    }
    try {
      authResult = await authenticatePublic(request);
    } catch (authError) {
      return jsonWithCors(
        { error: "Unauthorized: Invalid authentication" },
        { status: 401, request, staticCors: true }
      );
    }
    const shopDomain = normalizeDestToShopDomain(authResult.sessionToken.dest);
    const cacheKey = `tracking:${shopDomain}:${orderId}`;
    const cached = defaultLoaderCache.get(cacheKey) as Response | undefined;
    if (cached !== undefined) {
      return authResult.cors(cached);
    }
    const rateLimitKey = `tracking:${shopDomain}`;
    const rateLimitResult = await checkRateLimitAsync(rateLimitKey, 60, 60 * 1000);
    if (!rateLimitResult.allowed) {
      const headers = new Headers();
      headers.set("X-RateLimit-Limit", "60");
      headers.set("X-RateLimit-Remaining", "0");
      headers.set("X-RateLimit-Reset", String(Math.ceil(rateLimitResult.resetAt / 1000)));
      if (rateLimitResult.retryAfter) {
        headers.set("Retry-After", String(rateLimitResult.retryAfter));
      }
      logger.warn("Tracking rate limit exceeded", {
        shopDomain,
        retryAfter: rateLimitResult.retryAfter,
      });
      return authResult.cors(jsonWithCors(
        {
          error: "Too many tracking requests",
          retryAfter: rateLimitResult.retryAfter,
        },
        { status: 429, request, staticCors: true, headers }
      ));
    }
    const customerId = authResult.sessionToken.sub;
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: {
        id: true,
      },
    });
    if (!shop) {
      return authResult.cors(jsonWithCors({ error: "Shop not found" }, { status: 404, request, staticCors: true }));
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
              customer {
                id
              }
              checkoutToken
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
        if (fulfillmentData.data?.order) {
          if (authResult.surface === "customer_account" && customerId) {
            const orderCustomerId = fulfillmentData.data.order.customer?.id || null;
            if (orderCustomerId) {
              const tokenCustomerId = customerId.includes("/") ? customerId.split("/").pop() : customerId;
              const orderCustomerIdNum = orderCustomerId.includes("/") ? orderCustomerId.split("/").pop() : orderCustomerId;
              if (tokenCustomerId !== orderCustomerIdNum) {
                logger.warn(`Order access denied: customer mismatch for orderId: ${orderId}, shop: ${shopDomain}`, {
                  tokenCustomerId: tokenCustomerId,
                  orderCustomerId: orderCustomerIdNum,
                });
                return authResult.cors(jsonWithCors({ error: "Order access denied" }, { status: 403, request, staticCors: true }));
              }
            } else {
              logger.warn(`Order access denied: order has no customer for orderId: ${orderId}, shop: ${shopDomain}`);
              return authResult.cors(jsonWithCors({ error: "Order access denied" }, { status: 403, request, staticCors: true }));
            }
          } else if (authResult.surface === "checkout") {
            const url = new URL(request.url);
            const checkoutToken = url.searchParams.get("checkoutToken");
            if (!checkoutToken) {
              logger.warn(`Order access denied: checkout context requires checkoutToken for orderId: ${orderId}, shop: ${shopDomain}`);
              return authResult.cors(jsonWithCors({ error: "Order access denied: checkout context requires checkoutToken" }, { status: 403, request, staticCors: true }));
            }
            const orderCheckoutToken = fulfillmentData.data.order.checkoutToken || null;
            if (orderCheckoutToken && orderCheckoutToken !== checkoutToken) {
              logger.warn(`Order access denied: checkoutToken mismatch for orderId: ${orderId}, shop: ${shopDomain}`);
              return authResult.cors(jsonWithCors({ error: "Order access denied" }, { status: 403, request, staticCors: true }));
            }
          }
          if (fulfillmentData.data.order.fulfillments?.edges?.length > 0) {
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
      return authResult.cors(jsonWithCors(
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
      ));
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
        return authResult.cors(jsonWithCors(
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
        ));
      }
      return authResult.cors(jsonWithCors(
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
      ));
    }
    const response = authResult.cors(jsonWithCors({
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
    }, { request, staticCors: true }));
    if (response.status === 200) {
      defaultLoaderCache.set(cacheKey, response, TTL.MEDIUM);
    }
    return response;
  } catch (error) {
    logger.error("Failed to fetch tracking info", {
      error: error instanceof Error ? error.message : String(error),
    });
    if (authResult) {
      return authResult.cors(jsonWithCors({ error: "Failed to fetch tracking info" }, { status: 500, request, staticCors: true }));
    }
    return jsonWithCors({ error: "Failed to fetch tracking info" }, { status: 500, request, staticCors: true });
  }
}
