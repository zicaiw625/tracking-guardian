import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { createAdminClientForShop } from "../../shopify.server";
import { logger } from "../../utils/logger.server";
import { checkRateLimitAsync } from "../../middleware/rate-limit";
import { defaultLoaderCache } from "../../lib/with-cache";
import { TTL } from "../../utils/cache";
import prisma from "../../db.server";
import { canUseModule, getUiModuleConfigs } from "../../services/ui-extension.server";
import { PCD_CONFIG } from "../../utils/config.server";
import { readJsonWithSizeLimit } from "../../utils/body-size-guard";
import { authenticatePublic, normalizeDestToShopDomain, handlePublicPreflight, addSecurityHeaders } from "../../utils/public-auth";
import { hashValueSync } from "../../utils/crypto.server";
import { z } from "zod";

const orderIdSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => /^gid:\/\/shopify\/Order\/\d+$/.test(value) || /^\d+$/.test(value), {
    message: "Invalid orderId format",
  });

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return handlePublicPreflight(request);
  }
  if (request.method !== "POST") {
    return addSecurityHeaders(json({ error: "Method not allowed" }, { status: 405 }));
  }
  let authResult;
  try {
    authResult = await authenticatePublic(request);
  } catch {
    return addSecurityHeaders(json(
      { error: "Unauthorized: Invalid authentication" },
      { status: 401 }
    ));
  }
    const shopDomain = normalizeDestToShopDomain(authResult.sessionToken.dest);
    if (!PCD_CONFIG.APPROVED) {
      logger.warn(`Reorder feature requires PCD approval for shop ${shopDomain} - hard disabled at action level`);
      return addSecurityHeaders(authResult.cors(json(
        { error: "Reorder feature requires Protected Customer Data approval", reason: "pcd_not_approved", requiresPcdApproval: true },
      { status: 403 }
    )));
    }
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });
    if (!shop) {
      logger.warn(`Reorder action for unknown shop: ${shopDomain}`);
      return addSecurityHeaders(authResult.cors(json({ error: "Shop not found" }, { status: 404 })));
    }
    const moduleCheck = await canUseModule(shop.id, "reorder");
    if (!moduleCheck.allowed) {
      logger.warn(`Reorder module not allowed for shop ${shopDomain}`, {
        reason: moduleCheck.reason,
        currentPlan: moduleCheck.currentPlan,
        requiredPlan: moduleCheck.requiredPlan,
      });
      return addSecurityHeaders(authResult.cors(json(
        { error: "Module not available", reason: moduleCheck.reason },
      { status: 403 }
    )));
    }
    const modules = await getUiModuleConfigs(shop.id);
    const reorderModule = modules.find((m) => m.moduleKey === "reorder");
    if (!reorderModule || !reorderModule.isEnabled) {
      logger.warn(`Reorder module not enabled for shop ${shopDomain}`);
      return addSecurityHeaders(authResult.cors(json(
        { error: "Reorder module is not enabled" },
      { status: 403 }
    )));
    }
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
      return addSecurityHeaders(authResult.cors(json(
        {
          error: "Too many reorder requests",
          retryAfter: rateLimitResult.retryAfter,
        },
        { status: 429, headers }
      )));
    }
    try {
      const body = (await readJsonWithSizeLimit(request)) as Record<string, unknown> | null;
      const url = new URL(request.url);
      const orderIdRaw = body?.orderId || url.searchParams.get("orderId");
      if (!orderIdRaw) {
        return addSecurityHeaders(authResult.cors(json({ error: "Missing orderId" }, { status: 400 })));
      }
      const orderIdParse = orderIdSchema.safeParse(orderIdRaw);
      if (!orderIdParse.success) {
        return addSecurityHeaders(authResult.cors(json({ error: "Invalid orderId format" }, { status: 400 })));
      }
      const orderId = orderIdParse.data;
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
    if (authResult) {
      return addSecurityHeaders(authResult.cors(json({ error: "Failed to process reorder request" }, { status: 500 })));
    }
    return addSecurityHeaders(json({ error: "Failed to process reorder request" }, { status: 500 }));
  }
};

export const loader = async (args: LoaderFunctionArgs) => {
  return await loaderImpl(args.request);
};

async function loaderImpl(request: Request) {
  try {
    const url = new URL(request.url);
    const orderIdRaw = url.searchParams.get("orderId");
    if (!orderIdRaw) {
      const authResult = await authenticatePublic(request).catch(() => null);
      if (authResult) {
        return addSecurityHeaders(authResult.cors(json({ error: "Missing orderId" }, { status: 400 })));
      }
      return addSecurityHeaders(json({ error: "Missing orderId" }, { status: 400 }));
    }
    const orderIdParse = orderIdSchema.safeParse(orderIdRaw);
    if (!orderIdParse.success) {
      const authResult = await authenticatePublic(request).catch(() => null);
      if (authResult) {
        return addSecurityHeaders(authResult.cors(json({ error: "Invalid orderId format" }, { status: 400 })));
      }
      return addSecurityHeaders(json({ error: "Invalid orderId format" }, { status: 400 }));
    }
    const orderId = orderIdParse.data;
    let authResult;
    try {
      authResult = await authenticatePublic(request);
    } catch {
      return addSecurityHeaders(json(
        { error: "Unauthorized: Invalid authentication" },
        { status: 401 }
      ));
    }
    const shopDomain = normalizeDestToShopDomain(authResult.sessionToken.dest);
    const customerGidFromToken = authResult.sessionToken.sub || null;
    if (!customerGidFromToken) {
      logger.warn(`Reorder request without customer ID for shop ${shopDomain}`, {
        context: "Reorder is only available in customer account (order status) context, not in checkout (thank you) context",
      });
      return addSecurityHeaders(authResult.cors(json(
        { error: "Reorder is only available in order status page", reason: "Customer authentication required" },
      { status: 403 }
    )));
    }
    const orderIdHash = hashValueSync(orderId).slice(0, 12);
    const customerKey = hashValueSync(customerGidFromToken).slice(0, 16);
    const cacheKey = `reorder:${shopDomain}:${orderId}:cust:${customerKey}`;
    const cachedData = defaultLoaderCache.get(cacheKey) as { reorderUrl: string } | undefined;
    if (cachedData !== undefined) {
      return addSecurityHeaders(authResult.cors(json(cachedData)));
    }
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
      return addSecurityHeaders(authResult.cors(json(
        {
          error: "Too many reorder requests",
          retryAfter: rateLimitResult.retryAfter,
        },
        { status: 429, headers }
      )));
    }
    if (!PCD_CONFIG.APPROVED) {
      logger.warn(`Reorder feature requires PCD approval for shop ${shopDomain}`);
      return addSecurityHeaders(authResult.cors(json(
        { error: "Reorder feature requires Protected Customer Data approval", reason: "pcd_not_approved", requiresPcdApproval: true },
      { status: 403 }
    )));
    }
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });
    if (!shop) {
      logger.warn(`Reorder request for unknown shop: ${shopDomain}`);
      return addSecurityHeaders(authResult.cors(json({ error: "Shop not found" }, { status: 404 })));
    }
    const moduleCheck = await canUseModule(shop.id, "reorder");
    if (!moduleCheck.allowed) {
      logger.warn(`Reorder module not allowed for shop ${shopDomain}`, {
        reason: moduleCheck.reason,
        currentPlan: moduleCheck.currentPlan,
        requiredPlan: moduleCheck.requiredPlan,
      });
      return addSecurityHeaders(authResult.cors(json(
        { error: "Module not available", reason: moduleCheck.reason },
      { status: 403 }
    )));
    }
    const modules = await getUiModuleConfigs(shop.id);
    const reorderModule = modules.find((m) => m.moduleKey === "reorder");
    if (!reorderModule || !reorderModule.isEnabled) {
      logger.warn(`Reorder module not enabled for shop ${shopDomain}`);
      return addSecurityHeaders(authResult.cors(json(
        { error: "Reorder module is not enabled" },
      { status: 403 }
    )));
    }
    const admin = await createAdminClientForShop(shopDomain);
    if (!admin) {
      logger.warn(`Failed to create admin client for shop ${shopDomain}`);
      return addSecurityHeaders(authResult.cors(json({ error: "Failed to authenticate admin" }, { status: 401 })));
    }
    const gidOrderId = /^\d+$/.test(orderId) ? `gid://shopify/Order/${orderId}` : orderId;
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
          id: gidOrderId,
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
        return addSecurityHeaders(authResult.cors(json(
          {
            success: false,
            error: "Missing required permission",
            message: "此功能需要 read_orders 权限。请在 Shopify Partner Dashboard 中为应用添加 read_orders scope，并重新授权应用。",
            requiresReauthorization: true,
            requiredScope: "read_orders",
          },
      { status: 403 }
    )));
      }
      logger.error("Failed to query order from Shopify", {
        error: errorMessage,
        orderId,
        shopDomain,
      });
      return addSecurityHeaders(authResult.cors(json(
        { error: "Failed to query order", message: "无法读取订单信息，请稍后重试" },
        { status: 500 }
      )));
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
        return addSecurityHeaders(authResult.cors(json(
          {
            success: false,
            error: "Missing required permission",
            message: "此功能需要 read_orders 权限。请在 Shopify Partner Dashboard 中为应用添加 read_orders scope，并重新授权应用。",
            requiresReauthorization: true,
            requiredScope: "read_orders",
          },
      { status: 403 }
    )));
      }
    }
    if (!orderData.data?.order) {
      logger.info(`Order not found (may be still creating) for orderId: ${orderIdHash}, shop: ${shopDomain}`);
      return addSecurityHeaders(authResult.cors(json(
        {
          success: false,
          error: "Order not found",
          message: "订单正在生成，请稍后重试",
          retryAfter: 2,
        },
        {
          status: 202,
          headers: {
            "Retry-After": "2",
          },
        }
      )));
    }
    const orderCustomerId = orderData.data.order.customer?.id || null;
    if (!orderCustomerId) {
      logger.warn(`Reorder denied: order has no customer for orderId: ${orderIdHash}, shop: ${shopDomain}`);
      return addSecurityHeaders(authResult.cors(json(
        { error: "This order does not support reorder", reason: "order_has_no_customer" },
        { status: 403 }
      )));
    }
    if (customerGidFromToken) {
      const tokenCustomerId = customerGidFromToken.includes("/")
        ? customerGidFromToken.split("/").pop()
        : customerGidFromToken;
      const orderCustomerIdNum = orderCustomerId.includes("/")
        ? orderCustomerId.split("/").pop()
        : orderCustomerId;
      if (tokenCustomerId !== orderCustomerIdNum) {
        logger.warn(`Order access denied: customer mismatch for orderId: ${orderIdHash}, shop: ${shopDomain}`, {
          tokenCustomerId: tokenCustomerId,
          orderCustomerId: orderCustomerIdNum,
        });
        return addSecurityHeaders(authResult.cors(json({ error: "Order access denied" }, { status: 403 })));
      }
    } else {
      logger.warn(`Order access attempt without customer ID in token for orderId: ${orderIdHash}, shop: ${shopDomain}`);
      return addSecurityHeaders(authResult.cors(json(
        { error: "Unauthorized: Customer authentication required" },
        { status: 401 }
      )));
    }
    logger.info(`Reorder URL requested for orderId: ${orderIdHash}, shop: ${shopDomain}`);
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
    const data = { reorderUrl };
    defaultLoaderCache.set(cacheKey, data, TTL.SHORT);
    return addSecurityHeaders(authResult.cors(json(data)));
  } catch (error) {
    logger.error("Failed to get reorder URL", {
      error: error instanceof Error ? error.message : String(error),
    });
    const authResult = await authenticatePublic(request).catch(() => null);
    if (authResult) {
      return addSecurityHeaders(authResult.cors(json({ error: "Failed to get reorder URL" }, { status: 500 })));
    }
    return addSecurityHeaders(json({ error: "Failed to get reorder URL" }, { status: 500 }));
  }
}
