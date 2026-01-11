import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { createAdminClientForShop, authenticate } from "../../shopify.server";
import { logger } from "../../utils/logger.server";
import { optionsResponse, jsonWithCors } from "../../utils/cors";
import { withRateLimit, pathShopKeyExtractor, type RateLimitedHandler, checkRateLimitAsync } from "../../middleware/rate-limit";
import { withConditionalCache, createUrlCacheKey } from "../../lib/with-cache";
import { TTL } from "../../utils/cache";
import prisma from "../../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return optionsResponse(request, true);
  }
  if (request.method !== "POST") {
    return jsonWithCors({ error: "Method not allowed" }, { status: 405, request, staticCors: true });
  }
  let session: { shop: string; [key: string]: unknown };
  try {
    const authResult = await authenticate.public.checkout(request) as unknown as { 
      session: { shop: string; [key: string]: unknown } 
    };
    session = authResult.session;
  } catch (authError) {
    logger.warn("Reorder action authentication failed", {
      error: authError instanceof Error ? authError.message : String(authError),
    });
    return jsonWithCors(
      { error: "Unauthorized: Invalid authentication" },
      { status: 401, request, staticCors: true }
    );
  }
  const shopDomain = session.shop;
  const rateLimitKey = `reorder:${shopDomain}`;
  const rateLimitResult = await checkRateLimitAsync(rateLimitKey, 60, 60 * 1000);
  if (!rateLimitResult.allowed) {
    const headers = new Headers();
    headers.set("X-RateLimit-Limit", "60");
    headers.set("X-RateLimit-Remaining", "0");
    headers.set("X-RateLimit-Reset", String(Math.ceil(rateLimitResult.resetAt / 1000)));
    if (rateLimitResult.retryAfter) {
      headers.set("Retry-After", String(rateLimitResult.retryAfter));
    }
    logger.warn("Reorder rate limit exceeded", {
      shopDomain,
      retryAfter: rateLimitResult.retryAfter,
    });
    return jsonWithCors(
      {
        error: "Too many reorder requests",
        retryAfter: rateLimitResult.retryAfter,
      },
      { status: 429, request, staticCors: true, headers }
    );
  }
  try {
    const body = await request.json().catch(() => null);
    const url = new URL(request.url);
    const orderId = body?.orderId || url.searchParams.get("orderId");
    if (!orderId) {
      return jsonWithCors({ error: "Missing orderId" }, { status: 400, request, staticCors: true });
    }
    const newUrl = new URL(request.url);
    newUrl.searchParams.set("orderId", orderId);
    const newRequest = new Request(newUrl.toString(), {
      method: "GET",
      headers: request.headers,
    });
    return await loaderImpl(newRequest);
  } catch (error) {
    logger.error("Reorder action failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonWithCors({ error: "Failed to process reorder request" }, { status: 500, request, staticCors: true });
  }
};

const reorderRateLimit = withRateLimit<Response>({
  maxRequests: 60,
  windowMs: 60 * 1000,
  keyExtractor: pathShopKeyExtractor,
  message: "Too many reorder requests",
}) as (handler: RateLimitedHandler<Response>) => RateLimitedHandler<Response | Response>;

const rateLimitedLoader = reorderRateLimit(async (args: LoaderFunctionArgs | ActionFunctionArgs): Promise<Response> => {
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
        return orderId ? `reorder:${shop}:${orderId}` : null;
      } catch (error) {
        logger.warn("[api.reorder] Failed to generate cache key", { error });
        return null;
      }
    },
    ttl: TTL.SHORT,
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
    const customerGidFromToken = session.customerId || null;
    const admin = await createAdminClientForShop(shopDomain);
    if (!admin) {
      logger.warn(`Failed to create admin client for shop ${shopDomain}`);
      return jsonWithCors({ error: "Failed to authenticate admin" }, { status: 401, request, staticCors: true });
    }
    let orderResponse: Response;
    try {
      orderResponse = await admin.graphql(`
        query GetOrderLineItems($id: ID!) {
          order(id: $id) {
            id
            customer {
              id
            }
            lineItems(first: 250) {
              edges {
                node {
                  variant {
                    id
                  }
                  quantity
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
    } catch (graphqlError) {
      const errorMessage = graphqlError instanceof Error ? graphqlError.message : String(graphqlError);
      if (errorMessage.includes("read_orders") || errorMessage.includes("Required access")) {
        logger.warn("Reorder failed: Missing read_orders scope", {
          shopDomain,
          orderId,
          error: errorMessage,
        });
        return jsonWithCors(
          {
            success: false,
            error: "Missing required permission",
            message: "此功能需要 read_orders 权限。请在 Shopify Partner Dashboard 中为应用添加 read_orders scope，并重新授权应用。",
            requiresReauthorization: true,
            requiredScope: "read_orders",
          },
          { status: 403, request, staticCors: true }
        );
      }
      logger.error("Failed to query order from Shopify", {
        error: errorMessage,
        orderId,
        shopDomain,
      });
      return jsonWithCors(
        { error: "Failed to query order", message: "无法读取订单信息，请稍后重试" },
        { status: 500, request, staticCors: true }
      );
    }
    const orderData = await orderResponse.json().catch((jsonError) => {
      logger.warn("Failed to parse GraphQL response as JSON", {
        error: jsonError instanceof Error ? jsonError.message : String(jsonError),
        orderId,
        shopDomain,
      });
      return { data: null };
    });
    if (orderData.errors) {
      const hasAccessError = orderData.errors.some((err: { message?: string }) => 
        err.message?.includes("read_orders") || err.message?.includes("Required access")
      );
      if (hasAccessError) {
        logger.warn("Reorder failed: Missing read_orders scope (from GraphQL errors)", {
          shopDomain,
          orderId,
          errors: orderData.errors,
        });
        return jsonWithCors(
          {
            success: false,
            error: "Missing required permission",
            message: "此功能需要 read_orders 权限。请在 Shopify Partner Dashboard 中为应用添加 read_orders scope，并重新授权应用。",
            requiresReauthorization: true,
            requiredScope: "read_orders",
          },
          { status: 403, request, staticCors: true }
        );
      }
    }
    if (!orderData.data?.order) {
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
    const orderCustomerId = orderData.data.order.customer?.id || null;
    if (orderCustomerId) {
      if (customerGidFromToken) {
        const tokenCustomerId = customerGidFromToken.includes("/")
          ? customerGidFromToken.split("/").pop()
          : customerGidFromToken;
        const orderCustomerIdNum = orderCustomerId.includes("/")
          ? orderCustomerId.split("/").pop()
          : orderCustomerId;
        if (tokenCustomerId !== orderCustomerIdNum) {
          logger.warn(`Order access denied: customer mismatch for orderId: ${orderId}, shop: ${shopDomain}`, {
            tokenCustomerId: tokenCustomerId,
            orderCustomerId: orderCustomerIdNum,
          });
          return jsonWithCors({ error: "Order access denied" }, { status: 403, request, staticCors: true });
        }
      } else {
        logger.warn(`Order access attempt without customer ID in token for orderId: ${orderId}, shop: ${shopDomain}`);
        return jsonWithCors(
          { error: "Unauthorized: Customer authentication required" },
          { status: 401, request, staticCors: true }
        );
      }
    }
    logger.info(`Reorder URL requested for orderId: ${orderId}, shop: ${shopDomain}`);
    const lineItems = orderData.data.order.lineItems.edges || [];
    const relativeUrl = (() => {
      if (lineItems.length === 0) {
        return "/cart";
      }
      const items = lineItems
        .map((edge: { node: { variant: { id: string }; quantity: number } }) => {
          const variantId = edge.node.variant?.id || "";
          const numericId = variantId.split("/").pop() || "";
          return `${numericId}:${edge.node.quantity}`;
        })
        .filter((item: string) => item && !item.startsWith(":"))
        .join(",");
      return items ? `/cart/${items}` : "/cart";
    })();
    let reorderUrl = relativeUrl;
    try {
      const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: { primaryDomain: true, storefrontDomains: true },
      });
      if (shop?.primaryDomain) {
        const baseUrl = shop.primaryDomain.startsWith("http")
          ? shop.primaryDomain
          : `https://${shop.primaryDomain}`;
        reorderUrl = `${baseUrl}${relativeUrl}`;
      } else if (shop?.storefrontDomains && shop.storefrontDomains.length > 0) {
        const baseUrl = shop.storefrontDomains[0].startsWith("http")
          ? shop.storefrontDomains[0]
          : `https://${shop.storefrontDomains[0]}`;
        reorderUrl = `${baseUrl}${relativeUrl}`;
      }
    } catch (error) {
      logger.warn("Failed to fetch shop domain for reorder URL, using relative path", {
        shopDomain,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return jsonWithCors({ reorderUrl }, { request, staticCors: true });
  } catch (error) {
    logger.error("Failed to get reorder URL", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonWithCors({ error: "Failed to get reorder URL" }, { status: 500, request, staticCors: true });
  }
}
