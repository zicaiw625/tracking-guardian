/**
 * Tracking Guardian - Web Pixel Extension
 * 
 * This extension subscribes to Shopify Customer Events and forwards them to
 * the backend API for server-side processing via platform CAPI.
 * 
 * Design principles:
 * - NO third-party script injection (stable in strict sandbox)
 * - Minimal data extraction (privacy-first)
 * - Event deduplication via event_id
 * - Graceful error handling (no user-visible errors)
 */

import { register } from "@shopify/web-pixels-extension";

// Event types for type safety
interface CheckoutData {
  order?: { id?: string };
  token?: string;
  totalPrice?: { amount?: string };
  totalTax?: { amount?: string };
  shippingLine?: { price?: { amount?: string } };
  currencyCode?: string;
  lineItems?: Array<{
    id?: string;
    title?: string;
    quantity?: number;
    variant?: { price?: { amount?: string } };
  }>;
  email?: string;
  phone?: string;
}

interface ProductVariantData {
  id?: string;
  title?: string;
  price?: { amount?: string; currencyCode?: string };
}

interface CartLineData {
  merchandise?: {
    id?: string;
    title?: string;
    price?: { amount?: string; currencyCode?: string };
  };
  quantity?: number;
}

register(({ analytics, settings, init }) => {
  // Get configuration from pixel settings
  const backendUrl = settings.backend_url as string | undefined;
  const shopDomain = init.data?.shop?.myshopifyDomain || "";
  
  // If no backend URL configured, we can't send events
  if (!backendUrl) {
    console.warn("[Tracking Guardian] backend_url not configured in pixel settings");
    return;
  }

  /**
   * Generate a unique event ID for deduplication
   * Format: {identifier}_{eventName}_{5min_bucket}
   */
  function generateEventId(identifier: string, eventName: string): string {
    const timeBucket = Math.floor(Date.now() / 300000); // 5-minute buckets
    return `${identifier}_${eventName}_${timeBucket}`;
  }

  /**
   * Safely send event to backend
   * Uses fire-and-forget pattern to avoid blocking
   */
  async function sendToBackend(
    eventName: string,
    eventId: string,
    data: Record<string, unknown>
  ): Promise<void> {
    try {
      const payload = {
        eventName,
        eventId,
        timestamp: Date.now(),
        shopDomain,
        data,
      };

      // Fire and forget - don't await to avoid blocking
      fetch(`${backendUrl}/api/pixel-events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        // Short timeout to prevent hanging
        signal: AbortSignal.timeout(5000),
      }).catch(() => {
        // Silently ignore errors - don't affect user experience
      });
    } catch {
      // Silently ignore - tracking should never break user experience
    }
  }

  // ==========================================
  // EVENT SUBSCRIPTIONS
  // ==========================================

  // Page View (low priority - mainly for GA4 analytics)
  analytics.subscribe("page_viewed", (event) => {
    const pageId = event.context?.document?.location?.href || "unknown";
    const eventId = generateEventId(pageId.slice(-20), "page_viewed");
    
    sendToBackend("page_viewed", eventId, {
      pageTitle: event.context?.document?.title || "",
      pageUrl: event.context?.document?.location?.href || "",
    });
  });

  // Product Viewed
  analytics.subscribe("product_viewed", (event) => {
    const product = event.data?.productVariant as ProductVariantData | undefined;
    if (!product?.id) return;

    const eventId = generateEventId(product.id, "product_viewed");
    
    sendToBackend("product_viewed", eventId, {
      productId: product.id,
      productName: product.title || "",
      productPrice: parseFloat(product.price?.amount || "0"),
      currency: product.price?.currencyCode || "USD",
    });
  });

  // Add to Cart
  analytics.subscribe("product_added_to_cart", (event) => {
    const cartLine = event.data?.cartLine as CartLineData | undefined;
    if (!cartLine?.merchandise?.id) return;

    const eventId = generateEventId(cartLine.merchandise.id, "product_added_to_cart");
    const price = parseFloat(cartLine.merchandise.price?.amount || "0");
    const quantity = cartLine.quantity || 1;

    sendToBackend("product_added_to_cart", eventId, {
      productId: cartLine.merchandise.id,
      productName: cartLine.merchandise.title || "",
      productPrice: price,
      quantity,
      value: price * quantity,
      currency: cartLine.merchandise.price?.currencyCode || "USD",
    });
  });

  // Checkout Started
  analytics.subscribe("checkout_started", (event) => {
    const checkout = event.data?.checkout as CheckoutData | undefined;
    if (!checkout) return;

    const checkoutId = checkout.token || "unknown";
    const eventId = generateEventId(checkoutId, "checkout_started");

    sendToBackend("checkout_started", eventId, {
      value: parseFloat(checkout.totalPrice?.amount || "0"),
      currency: checkout.currencyCode || "USD",
      items: (checkout.lineItems || []).map((item) => ({
        id: item.id || "",
        name: item.title || "",
        price: parseFloat(item.variant?.price?.amount || "0"),
        quantity: item.quantity || 1,
      })),
    });
  });

  // Payment Info Submitted
  analytics.subscribe("payment_info_submitted", (event) => {
    const checkout = event.data?.checkout as CheckoutData | undefined;
    if (!checkout) return;

    const checkoutId = checkout.token || "unknown";
    const eventId = generateEventId(checkoutId, "payment_info_submitted");

    sendToBackend("payment_info_submitted", eventId, {
      value: parseFloat(checkout.totalPrice?.amount || "0"),
      currency: checkout.currencyCode || "USD",
    });
  });

  // Purchase Complete (MOST IMPORTANT - triggers CAPI)
  analytics.subscribe("checkout_completed", (event) => {
    const checkout = event.data?.checkout as CheckoutData | undefined;
    if (!checkout) return;

    const orderId = checkout.order?.id || checkout.token || "";
    if (!orderId) return;

    const eventId = generateEventId(orderId, "checkout_completed");
    const value = parseFloat(checkout.totalPrice?.amount || "0");
    const tax = parseFloat(checkout.totalTax?.amount || "0");
    const shipping = parseFloat(checkout.shippingLine?.price?.amount || "0");

    sendToBackend("checkout_completed", eventId, {
      orderId,
      value,
      tax,
      shipping,
      currency: checkout.currencyCode || "USD",
      // Customer data for enhanced matching (sent to backend for hashing)
      email: checkout.email,
      phone: checkout.phone,
      items: (checkout.lineItems || []).map((item) => ({
        id: item.id || "",
        name: item.title || "",
        price: parseFloat(item.variant?.price?.amount || "0"),
        quantity: item.quantity || 1,
      })),
    });
  });
});
