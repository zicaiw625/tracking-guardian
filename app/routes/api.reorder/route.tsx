
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import { verifyShopifyJwt, extractAuthToken, getShopifyApiSecret } from "../../utils/shopify-jwt";
import { logger } from "../../utils/logger.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const url = new URL(request.url);
    const orderId = url.searchParams.get("orderId");

    if (!orderId) {
      return json({ error: "Missing orderId" }, { status: 400 });
    }

    const shopHeader = request.headers.get("X-Shopify-Shop-Domain");
    if (!shopHeader) {
      return json({ error: "Missing shop domain header" }, { status: 400 });
    }

    const authToken = extractAuthToken(request);
    if (!authToken) {
      return json({ error: "Unauthorized: Missing authentication token" }, { status: 401 });
    }

    const apiSecret = getShopifyApiSecret();
    const jwtResult = await verifyShopifyJwt(authToken, apiSecret, shopHeader);
    
    if (!jwtResult.valid) {
      logger.warn(`JWT verification failed for shop ${shopHeader}: ${jwtResult.error}`);
      return json({ error: `Unauthorized: ${jwtResult.error}` }, { status: 401 });
    }

    // 使用 Admin API 获取订单详情
    const { session, admin } = await authenticate.admin(request);
    
    if (!admin) {
      return json({ error: "Failed to authenticate admin" }, { status: 401 });
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
      return json({ error: "Order not found" }, { status: 404 });
    }

    const lineItems = orderData.data.order.lineItems.edges || [];
    
    if (lineItems.length === 0) {
      return json({ reorderUrl: "/cart" });
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

    return json({ reorderUrl });
  } catch (error) {
    logger.error("Failed to get reorder URL", {
      error: error instanceof Error ? error.message : String(error),
    });
    return json({ error: "Failed to get reorder URL" }, { status: 500 });
  }
};

