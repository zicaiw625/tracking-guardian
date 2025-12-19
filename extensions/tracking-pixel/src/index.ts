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
 * - Event deduplication via event_id (server generates deterministic eventId)
 * - Graceful error handling (no user-visible errors)
 * - Respects customer consent settings (defaults to NO tracking without consent)
 * - NO PII (email/phone) sent by default for privacy compliance
 * - Request signing with @noble/hashes HMAC-SHA256 (battle-tested pure JS crypto)
 * 
 * Why NOT inject platform SDKs (fbq, gtag, ttq)?
 * 1. Strict sandbox has DOM/capability restrictions that break SDKs
 * 2. Server-side tracking via CAPI is more reliable (no ad blockers)
 * 3. Better privacy compliance (data processed server-side)
 * 4. Deduplication with webhook events prevents double-counting
 * 
 * P0-01: Signature Strategy
 * - Uses @noble/hashes for HMAC-SHA256 (proven, audited crypto library)
 * - If signature generation fails, request is sent unsigned
 * - Server accepts unsigned requests but applies stricter rate limiting
 * 
 * P0-03: orderId Strategy
 * - checkout_completed MUST use checkout.order.id
 * - Also sends checkoutToken for fallback matching on server
 * - Server can match by orderId first, then checkoutToken
 * 
 * P0-04: Consent Strategy
 * - Receipt writing uses hasAnyConsent() (marketing OR analytics)
 * - This allows GA4-only shops to work with analytics consent
 * - Server still applies platform-specific consent checks for actual CAPI sending
 * 
 * P0-4: Sandbox Compatibility
 * - Uses AbortController + setTimeout instead of AbortSignal.timeout
 * - Debug mode defaults to false
 */

import { register } from "@shopify/web-pixels-extension";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

// ==========================================
// P0-01: HMAC-SHA256 using @noble/hashes
// ==========================================
// 
// Using battle-tested @noble/hashes library instead of custom implementation.
// This library is:
// - Pure JavaScript (works in all environments including strict sandbox)
// - Audited and widely used in Web3/crypto projects
// - Zero dependencies
// - Correct implementation (unlike our previous buggy padding logic)

/**
 * P0-01: Generate HMAC-SHA256 signature using @noble/hashes
 * @param key - The secret key (ingestionSecret)
 * @param message - The message to sign (timestamp + body)
 * @returns Hex-encoded HMAC signature
 */
function hmacSha256(key: string, message: string): string {
  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(key);
  const messageBytes = encoder.encode(message);
  
  // Use @noble/hashes hmac function
  const signature = hmac(sha256, keyBytes, messageBytes);
  
  // Convert to hex string
  return bytesToHex(signature);
}

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
  // P0-4: ingestion_secret renamed to ingestion_key in UI, but key name kept for compatibility
  // This key is used for request association and noise filtering, not as a security boundary
  const ingestionSecret = settings.ingestion_secret as string | undefined;
  const shopDomain = init.data?.shop?.myshopifyDomain || "";
  // P0-4: Debug mode defaults to false for production safety
  const debugMode = settings.debug === true;
  
  // Conditional logging - only in debug mode
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
  // P0-01: REQUEST SIGNING (@noble/hashes)
  // ==========================================
  
  /**
   * Generate HMAC-SHA256 signature for request authentication
   * Uses @noble/hashes - a proven, audited crypto library
   * 
   * P0-01: This function always succeeds if ingestionSecret is configured.
   * The @noble/hashes library ensures correct implementation.
   */
  function generateSignature(timestamp: number, body: string): string | null {
    if (!ingestionSecret) {
      // No secret configured - requests will be sent unsigned
      // Server will accept but apply stricter rate limiting
      log("No ingestion secret configured - request will be unsigned");
      return null;
    }
    
    try {
      // Create the message to sign: timestamp + body
      const message = `${timestamp}${body}`;
      
      // Use @noble/hashes HMAC-SHA256 implementation
      const signature = hmacSha256(ingestionSecret, message);
      
      return signature;
    } catch (e) {
      // This should rarely happen with @noble/hashes
      log("Failed to generate signature:", e);
      return null;
    }
  }

  // ==========================================
  // CONSENT MANAGEMENT (P0-04)
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
   * P0-04: Check if we have ANY form of consent
   * 
   * For RECORDING pixel events (writing PixelEventReceipt):
   * - Allow if EITHER marketing OR analytics consent is granted
   * - This enables GA4-only shops to work with just analytics consent
   * 
   * The SERVER will decide which platforms to actually send to based on:
   * - Platform type (marketing vs analytics)
   * - Consent state in the receipt
   */
  function hasAnyConsent(): boolean {
    return marketingAllowed === true || analyticsAllowed === true;
  }
  
  /**
   * P0-04: Check if we have marketing consent specifically
   * Used for logging/debugging purposes
   */
  function hasMarketingConsent(): boolean {
    return marketingAllowed === true;
  }
  
  /**
   * P0-04: Check if we have analytics consent specifically
   * Used for logging/debugging purposes
   */
  function hasAnalyticsConsent(): boolean {
    return analyticsAllowed === true;
  }

  // P0-5: Removed generateEventId from pixel side
  // Server generates deterministic eventId using generateEventId(orderId, eventType, shopDomain)
  // This ensures pixel + webhook events use the same eventId for deduplication

  /**
   * P0-4: Create an abort signal with timeout using AbortController
   * Compatible with all sandbox environments (no AbortSignal.timeout dependency)
   */
  function createTimeoutSignal(timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    return {
      signal: controller.signal,
      cleanup: () => clearTimeout(timeoutId),
    };
  }

  /**
   * Safely send event to backend
   * Uses fire-and-forget pattern to avoid blocking
   * Respects customer consent settings
   * 
   * P0-01: Includes HMAC signature using @noble/hashes
   * P0-04: Uses hasAnyConsent() for receipt recording (server decides platform routing)
   * P0-04: Uses AbortController for timeout (not AbortSignal.timeout)
   * P0-05: Does not generate eventId - server handles this
   * P0-05: Includes consent state in payload for server-side decision making
   */
  async function sendToBackend(
    eventName: string,
    data: Record<string, unknown>
  ): Promise<void> {
    // P0-04: Check ANY consent for recording receipts
    // This allows analytics-only platforms (GA4) to work
    // Server will apply platform-specific consent checks for actual CAPI sending
    if (!hasAnyConsent()) {
      log(`Skipping ${eventName} - no consent (marketing: ${marketingAllowed}, analytics: ${analyticsAllowed})`);
      return;
    }

    try {
      const timestamp = Date.now();
      const payload = {
        eventName,
        // P0-5: No eventId from pixel - server generates it
        timestamp,
        shopDomain,
        // P0-04: Include BOTH consent states for server-side platform routing
        consent: {
          marketing: marketingAllowed,
          analytics: analyticsAllowed,
        },
        data,
      };
      
      const body = JSON.stringify(payload);
      
      // P0-01: Generate signature using @noble/hashes HMAC-SHA256
      const signature = generateSignature(timestamp, body);
      
      // Build headers
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      
      // Add signature headers if available
      if (signature) {
        headers["X-Tracking-Guardian-Signature"] = signature;
        headers["X-Tracking-Guardian-Timestamp"] = timestamp.toString();
      } else {
        // P0-1: Mark request as unsigned for server-side handling
        headers["X-Tracking-Guardian-Unsigned"] = "true";
      }

      // P0-4: Create timeout using AbortController (compatible with all environments)
      const { signal, cleanup } = createTimeoutSignal(5000);

      // Fire and forget - don't await to avoid blocking
      fetch(`${backendUrl}/api/pixel-events`, {
        method: "POST",
        headers,
        body,
        signal,
      })
        .then(() => cleanup())
        .catch(() => {
          cleanup();
          // Silently ignore errors - don't affect user experience
        });
    } catch {
      // Silently ignore - tracking should never break user experience
    }
  }

  // ==========================================
  // EVENT SUBSCRIPTIONS
  // ==========================================
  // 
  // P0-5: All events are sent without eventId from pixel.
  // Server generates deterministic eventId for deduplication.

  // Page View (low priority - mainly for GA4 analytics)
  analytics.subscribe("page_viewed", (event) => {
    sendToBackend("page_viewed", {
      pageTitle: event.context?.document?.title || "",
      pageUrl: event.context?.document?.location?.href || "",
    });
  });

  // Product Viewed
  analytics.subscribe("product_viewed", (event) => {
    const product = event.data?.productVariant as ProductVariantData | undefined;
    if (!product?.id) return;
    
    sendToBackend("product_viewed", {
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

    const price = parseFloat(cartLine.merchandise.price?.amount || "0");
    const quantity = cartLine.quantity || 1;

    sendToBackend("product_added_to_cart", {
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

    sendToBackend("checkout_started", {
      checkoutToken: checkout.token || "",
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

    sendToBackend("payment_info_submitted", {
      checkoutToken: checkout.token || "",
      value: parseFloat(checkout.totalPrice?.amount || "0"),
      currency: checkout.currencyCode || "USD",
    });
  });

  // Purchase Complete (MOST IMPORTANT - triggers CAPI)
  // P0-03: orderId MUST be from checkout.order.id only
  //        Also send checkoutToken for fallback server-side matching
  analytics.subscribe("checkout_completed", (event) => {
    const checkout = event.data?.checkout as CheckoutData | undefined;
    if (!checkout) return;

    // P0-03: CRITICAL - orderId must be the actual order ID, not checkout token
    // checkout.order.id is the Shopify GID (e.g., "gid://shopify/Order/123456")
    // Server webhook uses payload.id which is the numeric order ID
    // Server normalizes both to numeric ID for matching
    const orderId = checkout.order?.id;
    const checkoutToken = checkout.token;
    
    // P0-03: If we don't have a real order ID, log but still send
    // Include checkoutToken so server can potentially match later
    if (!orderId) {
      log("checkout_completed: No order.id available, using checkoutToken for fallback");
    }
    
    // Must have at least one identifier
    if (!orderId && !checkoutToken) {
      log("checkout_completed: No orderId or checkoutToken, skipping");
      return;
    }

    const value = parseFloat(checkout.totalPrice?.amount || "0");
    const tax = parseFloat(checkout.totalTax?.amount || "0");
    const shipping = parseFloat(checkout.shippingLine?.price?.amount || "0");

    // P0-5: Do NOT send PII (email/phone) from pixel by default
    // Server-side tracking via webhooks handles PII with proper controls
    // PII is handled server-side via webhooks where we have more control
    sendToBackend("checkout_completed", {
      // P0-03: Send orderId (may be undefined) and checkoutToken separately
      // Server will use orderId if available, fall back to checkoutToken for matching
      orderId: orderId || null,
      checkoutToken: checkoutToken || null,
      value,
      tax,
      shipping,
      currency: checkout.currencyCode || "USD",
      // Note: email and phone are intentionally NOT included
      items: (checkout.lineItems || []).map((item) => ({
        id: item.id || "",
        name: item.title || "",
        price: parseFloat(item.variant?.price?.amount || "0"),
        quantity: item.quantity || 1,
      })),
    });
  });
});
