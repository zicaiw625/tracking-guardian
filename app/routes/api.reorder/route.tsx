
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { createAdminClientForShop } from "../../shopify.server";
import { verifyShopifyJwt, extractAuthToken, getShopifyApiSecret } from "../../utils/shopify-jwt";
import { logger } from "../../utils/logger.server";
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

    if (!orderId) {
      return jsonWithCors({ error: "Missing orderId" }, { status: 400, request, staticCors: true });
    }

    const authToken = extractAuthToken(request);
    if (!authToken) {
      return jsonWithCors({ error: "Unauthorized: Missing authentication token" }, { status: 401, request, staticCors: true });
    }

    const apiSecret = getShopifyApiSecret();
    const expectedAud = process.env.SHOPIFY_API_KEY;
    
    if (!expectedAud) {
      logger.error("SHOPIFY_API_KEY not configured");
      return jsonWithCors({ error: "Server configuration error" }, { status: 500, request, staticCors: true });
    }

    // 验证 JWT token（不依赖 shopHeader，从 token 的 dest 提取 shop domain）
    const jwtResult = await verifyShopifyJwt(authToken, apiSecret, undefined, expectedAud);
    
    if (!jwtResult.valid || !jwtResult.shopDomain) {
      logger.warn(`JWT verification failed: ${jwtResult.error}`);
      return jsonWithCors({ error: `Unauthorized: ${jwtResult.error}` }, { status: 401, request, staticCors: true });
    }

    const shopDomain = jwtResult.shopDomain;

    // 使用离线 token 创建 Admin Client（不依赖 authenticate.admin）
    const admin = await createAdminClientForShop(shopDomain);
    
    if (!admin) {
      logger.warn(`Failed to create admin client for shop ${shopDomain}`);
      return jsonWithCors({ error: "Failed to authenticate admin" }, { status: 401, request, staticCors: true });
    }

    // 查询订单的 line items
    const orderResponse = await admin.graphql(`
      query GetOrderLineItems($id: ID!) {
        order(id: $id) {
          id
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

    const orderData = await orderResponse.json();
    
    if (!orderData.data?.order) {
      // 安全说明：
      // 1. Shopify Admin API 会自动限制只能查询该 shop 的订单
      // 2. 如果订单不存在或不属于该 shop，Admin API 会返回 null
      // 3. 这提供了基础的订单归属保护，防止跨 shop 访问订单
      // 4. 如果需要更严格的验证，可以考虑使用 JWT payload 中的 sub claim（customer gid）来验证订单归属
      // 5. 当前实现只返回 cart URL，不返回订单细节，进一步降低了信息泄露风险
      logger.info(`Order not found or access denied for orderId: ${orderId}, shop: ${shopDomain}`);
      return jsonWithCors({ error: "Order not found" }, { status: 404, request, staticCors: true });
    }
    
    // 记录订单访问日志（用于安全审计）
    logger.info(`Reorder URL requested for orderId: ${orderId}, shop: ${shopDomain}`);

    const lineItems = orderData.data.order.lineItems.edges || [];
    
    if (lineItems.length === 0) {
      return jsonWithCors({ reorderUrl: "/cart" }, { request, staticCors: true });
    }

    // 构建重新购买 URL
    const items = lineItems
      .map((edge: { node: { variant: { id: string }; quantity: number } }) => {
        const variantId = edge.node.variant?.id || "";
        const numericId = variantId.split("/").pop() || "";
        return `${numericId}:${edge.node.quantity}`;
      })
      .filter((item: string) => item && !item.startsWith(":"))
      .join(",");

    const reorderUrl = items ? `/cart/${items}` : "/cart";

    return jsonWithCors({ reorderUrl }, { request, staticCors: true });
  } catch (error) {
    logger.error("Failed to get reorder URL", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonWithCors({ error: "Failed to get reorder URL" }, { status: 500, request, staticCors: true });
  }
};

