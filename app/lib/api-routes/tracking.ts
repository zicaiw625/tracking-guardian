import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../../db.server";
import {
  getTrackingInfo,
  type TrackingProviderConfig,
  type TrackingInfo,
} from "../../services/experimental/shipping-tracker.server";
import { logger } from "../../utils/logger.server";
import type { OrderTrackingSettings } from "../../types/ui-extension";

import { createAdminClientForShop } from "../../shopify.server";
import { json } from "@remix-run/node";
import { checkRateLimitAsync } from "../../middleware/rate-limit";
import { defaultLoaderCache } from "../../lib/with-cache";
import { TTL } from "../../utils/cache";
import { getUiModuleConfig } from "../../services/ui-extension.server";
import { authenticatePublic, tryAuthenticatePublicWithShop, handlePublicPreflight, addSecurityHeaders } from "../../utils/public-auth";
import { hashValueSync } from "../../utils/crypto.server";
import { z } from "zod";
import { FEATURE_FLAGS } from "../../utils/config.server";

type TrackingApiPayload = {
  success: boolean;
  tracking: {
    trackingNumber: string | null;
    status: string;
    statusDescription: string;
    carrier: string | null;
    estimatedDelivery: string | null;
    events: Array<{ timestamp: string; location?: string; description?: string; status?: string }>;
    trackingUrl?: string;
    message?: string;
  };
};

const orderIdSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => /^gid:\/\/shopify\/Order\/\d+$/.test(value) || /^\d+$/.test(value), {
    message: "Invalid orderId format",
  });

const querySchema = z.object({
  orderId: orderIdSchema,
  trackingNumber: z.string().min(1).max(64).optional(),
  checkoutToken: z.string().min(1).max(128).optional(),
});

export const action = async ({ request }: ActionFunctionArgs) => {
  if (!FEATURE_FLAGS.TRACKING_API) {
    return addSecurityHeaders(json({ error: "Tracking API is not available in v1.0" }, { status: 404 }));
  }
  if (request.method === "OPTIONS") {
    return handlePublicPreflight(request);
  }
    return addSecurityHeaders(json({ error: "Method not allowed" }, { status: 405 }));
};

export const loader = async (args: LoaderFunctionArgs) => {
  return await loaderImpl(args.request);
};

async function loaderImpl(request: Request) {
  if (!FEATURE_FLAGS.TRACKING_API) {
    return addSecurityHeaders(json({ error: "Tracking API is not available in v1.0" }, { status: 404 }));
  }
  let authResult: Awaited<ReturnType<typeof authenticatePublic>> | null = null;
  try {
    const url = new URL(request.url);
    const orderIdRaw = url.searchParams.get("orderId")?.trim() || "";
    if (!orderIdRaw) {
      authResult = await authenticatePublic(request).catch(() => null);
      if (authResult) {
        return addSecurityHeaders(authResult.cors(json({ error: "Missing orderId" }, { status: 400 })));
      }
      return addSecurityHeaders(json({ error: "Missing orderId" }, { status: 400 }));
    }
    const queryParse = querySchema.safeParse({
      orderId: orderIdRaw,
      trackingNumber: url.searchParams.get("trackingNumber")?.trim() || undefined,
      checkoutToken: url.searchParams.get("checkoutToken")?.trim() || undefined,
    });
    if (!queryParse.success) {
      authResult = await authenticatePublic(request).catch(() => null);
      if (authResult) {
        return addSecurityHeaders(authResult.cors(json({ error: "Invalid query parameters" }, { status: 400 })));
      }
      return addSecurityHeaders(json({ error: "Invalid query parameters" }, { status: 400 }));
    }
    const auth = await tryAuthenticatePublicWithShop(request);
    if (!auth) {
      return addSecurityHeaders(json({ error: "Unauthorized: Invalid authentication" }, { status: 401 }));
    }
    authResult = auth.authResult;
    const { orderId, trackingNumber, checkoutToken } = queryParse.data;
    const gidOrderId = /^\d+$/.test(orderId) ? `gid://shopify/Order/${orderId}` : orderId;
    const shopDomain = auth.shopDomain;
    const customerId = authResult.sessionToken.sub || "";
    const surface = authResult.surface;
    if (surface === "checkout" && !checkoutToken) {
      return addSecurityHeaders(authResult.cors(json({ error: "Order access denied: checkout context requires checkoutToken" }, { status: 403 })));
    }
    const cacheKey =
      surface === "customer_account"
        ? `tracking:${shopDomain}:${orderId}:cust:${hashValueSync(customerId).slice(0, 16)}`
        : `tracking:${shopDomain}:${orderId}:co:${hashValueSync(checkoutToken || "").slice(0, 16)}`;
    const cachedData = defaultLoaderCache.get(cacheKey) as TrackingApiPayload | undefined;
    if (cachedData !== undefined) {
      return addSecurityHeaders(authResult.cors(json(cachedData)));
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
      return addSecurityHeaders(authResult.cors(json(
        {
          error: "Too many tracking requests",
          retryAfter: rateLimitResult.retryAfter,
        },
        { status: 429, headers }
      )));
    }
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: {
        id: true,
      },
    });
    if (!shop) {
      return addSecurityHeaders(authResult.cors(json({ error: "Shop not found" }, { status: 404 })));
    }
    const trackingModuleConfig = await getUiModuleConfig(shop.id, "order_tracking");
    const trackingSettings = trackingModuleConfig.isEnabled
      ? (trackingModuleConfig.settings as OrderTrackingSettings | undefined)
      : undefined;
    let trackingInfo: TrackingInfo | null = null;
    let trackingNumberFromShopify: string | null = null;
    let carrierFromShopify: string | null = null;
    let trackingUrlFromShopify: string | null = null;
    const orderIdHash = hashValueSync(orderId).slice(0, 12);
    logger.info(`Tracking info requested for orderId: ${orderIdHash}, shop: ${shopDomain}`, {
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
            id: gidOrderId,
          },
        });
        const fulfillmentData = await fulfillmentResponse.json().catch((jsonError) => {
          logger.warn("Failed to parse fulfillment GraphQL response as JSON", {
            error: jsonError instanceof Error ? jsonError.message : String(jsonError),
            orderIdHash,
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
                logger.warn(`Order access denied: customer mismatch for orderId: ${orderIdHash}, shop: ${shopDomain}`, {
                  tokenCustomerId: tokenCustomerId,
                  orderCustomerId: orderCustomerIdNum,
                });
                return addSecurityHeaders(authResult.cors(json({ error: "Order access denied" }, { status: 403 })));
              }
            } else {
              logger.warn(`Order access denied: order has no customer for orderId: ${orderIdHash}, shop: ${shopDomain}`);
              return addSecurityHeaders(authResult.cors(json({ error: "Order access denied" }, { status: 403 })));
            }
          } else if (authResult.surface === "checkout") {
            const orderCheckoutToken = fulfillmentData.data?.order?.checkoutToken ?? null;
            if (!orderCheckoutToken) {
              logger.warn(`Order access denied: missing order checkoutToken for orderId: ${orderIdHash}, shop: ${shopDomain}`);
              return addSecurityHeaders(authResult.cors(json({ error: "Order access denied: missing order checkoutToken" }, { status: 403 })));
            }
            if (orderCheckoutToken !== checkoutToken) {
              const checkoutTokenHash = checkoutToken ? hashValueSync(checkoutToken).slice(0, 12) : "null";
              logger.warn(`Order access denied: checkoutToken mismatch for orderId: ${orderIdHash}, shop: ${shopDomain}`, {
                checkoutTokenHash,
              });
              return addSecurityHeaders(authResult.cors(json({ error: "Order access denied: checkoutToken mismatch" }, { status: 403 })));
            }
          }
          if (fulfillmentData.data.order.fulfillments?.edges?.length > 0) {
            const firstFulfillment = fulfillmentData.data.order.fulfillments.edges[0].node;
            if (firstFulfillment.trackingInfo) {
              trackingNumberFromShopify = firstFulfillment.trackingInfo.number || null;
              carrierFromShopify = firstFulfillment.trackingInfo.company || null;
              trackingUrlFromShopify = firstFulfillment.trackingInfo.url || null;
              logger.info(`Found tracking info from Shopify for orderId: ${orderIdHash}`, {
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
        orderIdHash,
        shopDomain,
      });
    }
    const trackingNumberToUse = trackingNumber || trackingNumberFromShopify || null;
    if (!trackingNumberToUse) {
      return addSecurityHeaders(authResult.cors(json(
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
        { status: 200 }
      )));
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
          const src = thirdPartyTracking as unknown as Record<string, unknown>;
          trackingInfo = {
            trackingNumber: (src["trackingNumber"] as string) || trackingNumberToUse,
            carrier: (src["carrier"] as string) || carrierFromShopify || "unknown",
            status: (src["status"] as string) || "in_transit",
            statusDescription: src["statusDescription"] as string | undefined,
            estimatedDelivery: src["estimatedDelivery"] as Date | undefined,
            events: (src["events"] as TrackingInfo["events"]) || [],
          };
          logger.info(`Third-party tracking enrich successful for orderId: ${orderIdHash}, provider: ${trackingSettings.provider}`);
        } else {
          logger.warn(`Third-party tracking enrich failed for orderId: ${orderIdHash}, provider: ${trackingSettings.provider}, falling back to Shopify data`);
        }
      } catch (error) {
        logger.error(`Third-party tracking enrich error for orderId: ${orderIdHash}`, {
          error: error instanceof Error ? error.message : String(error),
          provider: trackingSettings.provider,
        });
      }
    }
    if (!trackingInfo) {
      if (trackingNumberToUse) {
        return addSecurityHeaders(authResult.cors(json(
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
          { status: 200 }
        )));
      }
      return addSecurityHeaders(authResult.cors(json(
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
        { status: 200 }
      )));
    }
    const data: TrackingApiPayload = {
      success: true,
      tracking: {
        trackingNumber: trackingInfo.trackingNumber ?? null,
        carrier: trackingInfo.carrier,
        status: trackingInfo.status,
        statusDescription: trackingInfo.statusDescription ?? "",
        estimatedDelivery: trackingInfo.estimatedDelivery?.toISOString() || null,
        events: trackingInfo.events.map((event) => ({
          timestamp: event.timestamp.toISOString(),
          location: event.location,
          description: event.description,
          status: event.status,
        })),
      },
    };
    defaultLoaderCache.set(cacheKey, data, TTL.MEDIUM);
    return addSecurityHeaders(authResult.cors(json(data)));
  } catch (error) {
    logger.error("Failed to fetch tracking info", {
      error: error instanceof Error ? error.message : String(error),
    });
    if (authResult) {
      return addSecurityHeaders(authResult.cors(json({ error: "Failed to fetch tracking info" }, { status: 500 })));
    }
    return addSecurityHeaders(json({ error: "Failed to fetch tracking info" }, { status: 500 }));
  }
}
