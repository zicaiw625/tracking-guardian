/**
 * Tracking Guardian - Web Pixel Extension
 * 
 * This extension subscribes to Shopify Customer Events and forwards them to
 * the backend API for server-side processing via platform CAPI.
 * 
 * IMPORTANT: This pixel runs in Shopify's strict sandbox environment.
 * 
 * Design principles:
 * - NO third-party script injection (stable in strict sandbox)
 * - Minimal data extraction (privacy-first)
 * - Event deduplication via event_id
 * - Graceful error handling (no user-visible errors)
 * - Respects customer consent settings (defaults to NO tracking without consent)
 * - NO PII (email/phone) sent by default for privacy compliance
 * - Request signing to prevent forgery/abuse (P1-1)
 * 
 * Why NOT inject platform SDKs (fbq, gtag, ttq)?
 * 1. Strict sandbox has DOM/capability restrictions that break SDKs
 * 2. Server-side tracking via CAPI is more reliable (no ad blockers)
 * 3. Better privacy compliance (data processed server-side)
 * 4. Deduplication with webhook events prevents double-counting
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
  // Note: email/phone are available but NOT sent by default for privacy compliance
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

// Consent change event type
interface VisitorConsentCollectedEvent {
  analyticsProcessingAllowed: boolean;
  marketingAllowed: boolean;
  preferencesProcessingAllowed: boolean;
  saleOfDataAllowed: boolean;
}

register(({ analytics, settings, init }) => {
  // Get configuration from pixel settings
  const backendUrl = settings.backend_url as string | undefined;
  const ingestionSecret = settings.ingestion_secret as string | undefined;
  const shopDomain = init.data?.shop?.myshopifyDomain || "";
  const debugMode = settings.debug === true;
  
  // Conditional logging - only in debug mode (P1-3)
  function log(...args: unknown[]): void {
    if (debugMode) {
      console.log("[Tracking Guardian]", ...args);
    }
  }
  
  // If no backend URL configured, we can't send events
  if (!backendUrl) {
    log("backend_url not configured in pixel settings");
    return;
  }

  // ==========================================
  // P1-1: REQUEST SIGNING
  // ==========================================
  
  /**
   * Generate HMAC-SHA256 signature for request authentication
   * This prevents unauthorized requests to our API
   */
  async function generateSignature(timestamp: number, body: string): Promise<string | null> {
    if (!ingestionSecret) {
      // No secret configured - requests will be sent unsigned
      // Server should still accept these but may rate limit more aggressively
      return null;
    }
    
    try {
      // Create the message to sign: timestamp + body
      const message = `${timestamp}${body}`;
      
      // Convert secret and message to ArrayBuffer
      const encoder = new TextEncoder();
      const keyData = encoder.encode(ingestionSecret);
      const messageData = encoder.encode(message);
      
      // Import the key for HMAC
      const key = await crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      
      // Generate the signature
      const signatureBuffer = await crypto.subtle.sign("HMAC", key, messageData);
      
      // Convert to hex string
      const signatureArray = Array.from(new Uint8Array(signatureBuffer));
      const signature = signatureArray.map(b => b.toString(16).padStart(2, "0")).join("");
      
      return signature;
    } catch {
      // Crypto API might not be available in all sandbox environments
      log("Failed to generate signature");
      return null;
    }
  }

  // ==========================================
  // CONSENT MANAGEMENT (P0-3)
  // ==========================================
  
  // Default consent state: FALSE (most conservative approach)
  // This ensures we don't track users without explicit consent
  let marketingAllowed = false;
  let analyticsAllowed = false;
  
  // Initialize consent state from Shopify's customer privacy API
  const customerPrivacy = init.customerPrivacy;
  if (customerPrivacy) {
    // Read initial consent state - must be explicitly true
    marketingAllowed = customerPrivacy.marketingAllowed === true;
    analyticsAllowed = customerPrivacy.analyticsProcessingAllowed === true;
    
    log("Initial consent state:", { marketingAllowed, analyticsAllowed });
    
    // Subscribe to consent changes so we can start/stop tracking dynamically
    // This handles cases where:
    // 1. User initially denies consent, then later accepts
    // 2. User accepts consent, then later revokes it
    // 3. Consent banner is shown and user makes a choice
    try {
      customerPrivacy.subscribe("visitorConsentCollected", (event: VisitorConsentCollectedEvent) => {
        marketingAllowed = event.marketingAllowed === true;
        analyticsAllowed = event.analyticsProcessingAllowed === true;
        log("Consent updated:", { marketingAllowed, analyticsAllowed });
      });
    } catch {
      // Some sandbox environments may not support subscribe
      log("Could not subscribe to consent changes");
    }
  } else {
    // If privacy API is not available, we stay with defaults (no tracking)
    // This is the safest approach for GDPR/privacy compliance
    log("Customer privacy API not available, defaulting to no tracking");
  }

  /**
   * Check if we have consent to track
   * Conversion tracking typically requires marketing consent
   */
  function hasTrackingConsent(): boolean {
    // For conversion tracking, we need marketing consent
    // marketingAllowed covers advertising/conversion use cases
    return marketingAllowed === true;
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
   * Respects customer consent settings
   * Includes HMAC signature for request verification (P1-1)
   */
  async function sendToBackend(
    eventName: string,
    eventId: string,
    data: Record<string, unknown>
  ): Promise<void> {
    // Check consent before sending any tracking data
    if (!hasTrackingConsent()) {
      log(`Skipping ${eventName} - no marketing consent`);
      return;
    }

    try {
      const timestamp = Date.now();
      const payload = {
        eventName,
        eventId,
        timestamp,
        shopDomain,
        data,
      };
      
      const body = JSON.stringify(payload);
      
      // Generate signature for request verification (P1-1)
      const signature = await generateSignature(timestamp, body);
      
      // Build headers
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      
      // Add signature headers if available
      if (signature) {
        headers["X-Tracking-Guardian-Signature"] = signature;
        headers["X-Tracking-Guardian-Timestamp"] = timestamp.toString();
      }

      // Fire and forget - don't await to avoid blocking
      fetch(`${backendUrl}/api/pixel-events`, {
        method: "POST",
        headers,
        body,
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

    // P0-5: Do NOT send PII (email/phone) from pixel by default
    // Server-side tracking via webhooks handles PII with proper controls
    // This ensures privacy compliance and simplifies GDPR/CCPA handling
    sendToBackend("checkout_completed", eventId, {
      orderId,
      value,
      tax,
      shipping,
      currency: checkout.currencyCode || "USD",
      // Note: email and phone are intentionally NOT included
      // PII is handled server-side via webhooks where we have more control
      items: (checkout.lineItems || []).map((item) => ({
        id: item.id || "",
        name: item.title || "",
        price: parseFloat(item.variant?.price?.amount || "0"),
        quantity: item.quantity || 1,
      })),
    });
  });
});
