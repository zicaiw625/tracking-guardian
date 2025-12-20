/**
 * P0-06: App Proxy Route - CURRENTLY DISABLED FOR SECURITY
 * 
 * This endpoint was designed to return order tracking/fulfillment information
 * via Shopify's App Proxy mechanism. However, it has security concerns:
 * 
 * SECURITY ISSUES:
 * 1. App Proxy only verifies the request came from Shopify, NOT that the
 *    requesting customer owns the order
 * 2. Without additional authorization, any customer could enumerate order IDs
 *    and retrieve tracking information for orders they don't own
 * 3. Tracking numbers and URLs could be considered sensitive information
 * 
 * TO ENABLE THIS ENDPOINT SAFELY:
 * 1. Implement customer authentication via Customer Account API or session tokens
 * 2. Verify the logged-in customer owns the requested order
 * 3. Consider only returning non-sensitive status information (no tracking URLs/numbers)
 * 4. Add rate limiting per customer/session
 * 
 * For now, the ShippingTracker extension should use Shopify's native
 * order fulfillment data available in the checkout surfaces.
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { logger } from "../utils/logger";

// P0-06: Feature flag to enable this endpoint (default: disabled)
const TRACKING_API_ENABLED = process.env.ENABLE_TRACKING_API === "true";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // P0-06: Return 503 Service Unavailable when disabled
  if (!TRACKING_API_ENABLED) {
    logger.info("[P0-06] Tracking API request rejected - endpoint disabled for security review");
    return json(
      { 
        error: "This endpoint is currently disabled for security review",
        code: "ENDPOINT_DISABLED",
        message: "Order tracking information is available directly through Shopify's order status page."
      }, 
      { status: 503 }
    );
  }

  // If enabled in the future, the full implementation would go here
  // with proper customer authentication
  return json(
    { error: "Not implemented" },
    { status: 501 }
  );
};

export const action = async () => {
  return json({ error: "Method not allowed" }, { status: 405 });
};

/*
 * ARCHIVED: Original implementation for reference when implementing proper auth
 * 
 * import { authenticate } from "../shopify.server";
 * 
 * interface TrackingInfo {
 *   number: string | null;
 *   url: string | null;
 *   company: string | null;
 * }
 * 
 * interface FulfillmentInfo {
 *   id: string;
 *   status: string;
 *   createdAt: string;
 *   updatedAt: string;
 *   trackingInfo: TrackingInfo[];
 * }
 * 
 * interface OrderTrackingResponse {
 *   orderId: string;
 *   orderNumber: string;
 *   orderStatus: string;
 *   fulfillments: FulfillmentInfo[];
 *   shippingStatus: "unfulfilled" | "partially_fulfilled" | "fulfilled" | "delivered";
 *   estimatedDelivery: string | null;
 * }
 * 
 * // The original loader function would authenticate via app proxy,
 * // fetch order data, and return tracking information.
 * // See git history for full implementation.
 */
