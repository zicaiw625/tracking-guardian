/**
 * Tracking API Endpoint
 * 
 * Provides order fulfillment and tracking information for the ShippingTracker
 * thank-you page extension.
 * 
 * P2-4: This endpoint is called by the ShippingTracker extension via App Proxy
 * to get real-time tracking information for a customer's order.
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

interface TrackingInfo {
  number: string | null;
  url: string | null;
  company: string | null;
}

interface FulfillmentInfo {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  trackingInfo: TrackingInfo[];
}

interface OrderTrackingResponse {
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  fulfillments: FulfillmentInfo[];
  shippingStatus: "unfulfilled" | "partially_fulfilled" | "fulfilled" | "delivered";
  estimatedDelivery: string | null;
}

/**
 * Get tracking information for an order
 * 
 * This is accessed via Shopify App Proxy to allow the checkout extension
 * to fetch tracking data securely.
 * 
 * Query params:
 * - orderId: The Shopify order ID (GID format or numeric)
 * - orderToken: Optional token for validation
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    // Authenticate the request via App Proxy
    const { admin, session } = await authenticate.public.appProxy(request);
    
    if (!admin) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const orderId = url.searchParams.get("orderId");
    
    if (!orderId) {
      return json({ error: "Missing orderId parameter" }, { status: 400 });
    }

    // Normalize order ID to GID format
    const orderGid = orderId.startsWith("gid://")
      ? orderId
      : `gid://shopify/Order/${orderId}`;

    // Fetch order with fulfillment data
    const response = await admin.graphql(
      `#graphql
      query GetOrderFulfillments($orderId: ID!) {
        order(id: $orderId) {
          id
          name
          displayFulfillmentStatus
          createdAt
          fulfillments(first: 10) {
            id
            status
            createdAt
            updatedAt
            trackingInfo(first: 5) {
              number
              url
              company
            }
          }
        }
      }
    `,
      { variables: { orderId: orderGid } }
    );

    const data = await response.json();
    
    if (!data.data?.order) {
      return json({ error: "Order not found" }, { status: 404 });
    }

    const order = data.data.order;

    // Transform fulfillment data
    const fulfillments: FulfillmentInfo[] = order.fulfillments.map((f: {
      id: string;
      status: string;
      createdAt: string;
      updatedAt: string;
      trackingInfo: TrackingInfo[];
    }) => ({
      id: f.id,
      status: f.status,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
      trackingInfo: f.trackingInfo || [],
    }));

    // Determine overall shipping status
    let shippingStatus: OrderTrackingResponse["shippingStatus"] = "unfulfilled";
    
    switch (order.displayFulfillmentStatus) {
      case "FULFILLED":
        shippingStatus = "fulfilled";
        break;
      case "PARTIALLY_FULFILLED":
        shippingStatus = "partially_fulfilled";
        break;
      case "UNFULFILLED":
      case "ON_HOLD":
      default:
        shippingStatus = "unfulfilled";
    }

    // Check if any fulfillment shows delivered status
    if (fulfillments.some(f => f.status === "DELIVERED")) {
      shippingStatus = "delivered";
    }

    // Calculate estimated delivery (simple estimation: 5-7 business days from fulfillment)
    let estimatedDelivery: string | null = null;
    if (fulfillments.length > 0 && shippingStatus === "fulfilled") {
      const latestFulfillment = fulfillments[0];
      const shippedDate = new Date(latestFulfillment.createdAt);
      const deliveryDate = new Date(shippedDate);
      deliveryDate.setDate(deliveryDate.getDate() + 7); // Add 7 days
      estimatedDelivery = deliveryDate.toISOString().split("T")[0];
    }

    const result: OrderTrackingResponse = {
      orderId: order.id,
      orderNumber: order.name,
      orderStatus: order.displayFulfillmentStatus,
      fulfillments,
      shippingStatus,
      estimatedDelivery,
    };

    return json(result);
  } catch (error) {
    console.error("Tracking API error:", error);
    
    // Handle authentication errors gracefully
    if (error instanceof Error && error.message.includes("authentication")) {
      return json({ error: "Authentication failed" }, { status: 401 });
    }
    
    return json(
      { error: "Failed to fetch tracking information" },
      { status: 500 }
    );
  }
};

/**
 * Health check for the tracking API
 */
export const action = async () => {
  return json({ error: "Method not allowed" }, { status: 405 });
};
