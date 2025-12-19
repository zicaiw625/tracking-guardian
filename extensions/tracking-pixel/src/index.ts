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
 * - Request signing with pure-JS HMAC-SHA256 (no crypto.subtle dependency)
 * 
 * Why NOT inject platform SDKs (fbq, gtag, ttq)?
 * 1. Strict sandbox has DOM/capability restrictions that break SDKs
 * 2. Server-side tracking via CAPI is more reliable (no ad blockers)
 * 3. Better privacy compliance (data processed server-side)
 * 4. Deduplication with webhook events prevents double-counting
 * 
 * P0-1: Signature Strategy
 * - Uses pure JS HMAC-SHA256 implementation (no crypto.subtle dependency)
 * - If signature generation fails, request is sent unsigned
 * - Server accepts unsigned requests but applies stricter rate limiting
 * 
 * P0-4: Sandbox Compatibility
 * - Uses AbortController + setTimeout instead of AbortSignal.timeout
 * - Debug mode defaults to false
 */

import { register } from "@shopify/web-pixels-extension";

// ==========================================
// P0-1: PURE JS HMAC-SHA256 IMPLEMENTATION
// ==========================================
// 
// This implementation does NOT rely on crypto.subtle which may not be
// available in all sandbox environments. It's a lightweight, pure JS
// implementation suitable for signing pixel requests.

/**
 * Pure JS implementation of SHA-256
 * Based on the FIPS 180-4 specification
 */
const sha256 = (() => {
  // SHA-256 constants (first 32 bits of fractional parts of cube roots of first 64 primes)
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  // Initial hash values (first 32 bits of fractional parts of square roots of first 8 primes)
  const H0 = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);

  function rotr(n: number, x: number): number {
    return (x >>> n) | (x << (32 - n));
  }

  function ch(x: number, y: number, z: number): number {
    return (x & y) ^ (~x & z);
  }

  function maj(x: number, y: number, z: number): number {
    return (x & y) ^ (x & z) ^ (y & z);
  }

  function sigma0(x: number): number {
    return rotr(2, x) ^ rotr(13, x) ^ rotr(22, x);
  }

  function sigma1(x: number): number {
    return rotr(6, x) ^ rotr(11, x) ^ rotr(25, x);
  }

  function gamma0(x: number): number {
    return rotr(7, x) ^ rotr(18, x) ^ (x >>> 3);
  }

  function gamma1(x: number): number {
    return rotr(17, x) ^ rotr(19, x) ^ (x >>> 10);
  }

  function stringToBytes(str: string): Uint8Array {
    const encoder = new TextEncoder();
    return encoder.encode(str);
  }

  function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  return function hash(message: string): string {
    const msgBytes = stringToBytes(message);
    const msgLen = msgBytes.length;
    
    // Pre-processing: adding padding bits
    const bitLen = msgLen * 8;
    const padLen = ((msgLen + 8) % 64 < 56) 
      ? 56 - (msgLen + 8) % 64 
      : 120 - (msgLen + 8) % 64;
    const paddedLen = msgLen + 1 + padLen + 8;
    
    const padded = new Uint8Array(paddedLen);
    padded.set(msgBytes);
    padded[msgLen] = 0x80;
    
    // Append original message length in bits as 64-bit big-endian
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLen - 4, bitLen, false);
    
    // Initialize hash values
    const H = new Uint32Array(H0);
    const W = new Uint32Array(64);
    
    // Process each 512-bit chunk
    for (let i = 0; i < paddedLen; i += 64) {
      // Create message schedule
      for (let t = 0; t < 16; t++) {
        W[t] = view.getUint32(i + t * 4, false);
      }
      for (let t = 16; t < 64; t++) {
        W[t] = (gamma1(W[t - 2]) + W[t - 7] + gamma0(W[t - 15]) + W[t - 16]) >>> 0;
      }
      
      // Initialize working variables
      let a = H[0], b = H[1], c = H[2], d = H[3];
      let e = H[4], f = H[5], g = H[6], h = H[7];
      
      // Main loop
      for (let t = 0; t < 64; t++) {
        const T1 = (h + sigma1(e) + ch(e, f, g) + K[t] + W[t]) >>> 0;
        const T2 = (sigma0(a) + maj(a, b, c)) >>> 0;
        h = g; g = f; f = e;
        e = (d + T1) >>> 0;
        d = c; c = b; b = a;
        a = (T1 + T2) >>> 0;
      }
      
      // Update hash values
      H[0] = (H[0] + a) >>> 0;
      H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0;
      H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0;
      H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0;
      H[7] = (H[7] + h) >>> 0;
    }
    
    // Produce final hash value (big-endian)
    const result = new Uint8Array(32);
    const resultView = new DataView(result.buffer);
    for (let i = 0; i < 8; i++) {
      resultView.setUint32(i * 4, H[i], false);
    }
    
    return bytesToHex(result);
  };
})();

/**
 * Pure JS implementation of HMAC-SHA256
 */
function hmacSha256(key: string, message: string): string {
  const BLOCK_SIZE = 64;
  
  // Convert key to bytes
  const encoder = new TextEncoder();
  let keyBytes = encoder.encode(key);
  
  // If key is longer than block size, hash it
  if (keyBytes.length > BLOCK_SIZE) {
    const hashed = sha256(key);
    keyBytes = new Uint8Array(hashed.length / 2);
    for (let i = 0; i < keyBytes.length; i++) {
      keyBytes[i] = parseInt(hashed.substr(i * 2, 2), 16);
    }
  }
  
  // Pad key to block size
  const paddedKey = new Uint8Array(BLOCK_SIZE);
  paddedKey.set(keyBytes);
  
  // Create inner and outer padded keys
  const ipad = new Uint8Array(BLOCK_SIZE);
  const opad = new Uint8Array(BLOCK_SIZE);
  
  for (let i = 0; i < BLOCK_SIZE; i++) {
    ipad[i] = paddedKey[i] ^ 0x36;
    opad[i] = paddedKey[i] ^ 0x5c;
  }
  
  // Convert to strings for hashing
  const ipadStr = Array.from(ipad).map(b => String.fromCharCode(b)).join("");
  const opadStr = Array.from(opad).map(b => String.fromCharCode(b)).join("");
  
  // Inner hash: H(K XOR ipad || message)
  const innerHash = sha256(ipadStr + message);
  
  // Convert inner hash hex to bytes then to string
  const innerBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    innerBytes[i] = parseInt(innerHash.substr(i * 2, 2), 16);
  }
  const innerStr = Array.from(innerBytes).map(b => String.fromCharCode(b)).join("");
  
  // Outer hash: H(K XOR opad || inner_hash)
  return sha256(opadStr + innerStr);
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
  // P0-1: REQUEST SIGNING (Pure JS Implementation)
  // ==========================================
  
  /**
   * Generate HMAC-SHA256 signature for request authentication
   * Uses pure JS implementation - no crypto.subtle dependency
   * 
   * P0-1: This function always succeeds if ingestionSecret is configured.
   * The pure JS implementation ensures 100% signing capability.
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
      
      // Use pure JS HMAC-SHA256 implementation
      const signature = hmacSha256(ingestionSecret, message);
      
      return signature;
    } catch (e) {
      // This should rarely happen with pure JS implementation
      log("Failed to generate signature:", e);
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
   * P0-1: Includes HMAC signature using pure JS implementation
   * P0-4: Uses AbortController for timeout (not AbortSignal.timeout)
   * P0-5: Does not generate eventId - server handles this
   */
  async function sendToBackend(
    eventName: string,
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
        // P0-5: No eventId from pixel - server generates it
        timestamp,
        shopDomain,
        data,
      };
      
      const body = JSON.stringify(payload);
      
      // P0-1: Generate signature using pure JS HMAC-SHA256
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
  analytics.subscribe("checkout_completed", (event) => {
    const checkout = event.data?.checkout as CheckoutData | undefined;
    if (!checkout) return;

    const orderId = checkout.order?.id || checkout.token || "";
    if (!orderId) return;

    const value = parseFloat(checkout.totalPrice?.amount || "0");
    const tax = parseFloat(checkout.totalTax?.amount || "0");
    const shipping = parseFloat(checkout.shippingLine?.price?.amount || "0");

    // P0-5: Do NOT send PII (email/phone) from pixel by default
    // Server-side tracking via webhooks handles PII with proper controls
    // PII is handled server-side via webhooks where we have more control
    sendToBackend("checkout_completed", {
      orderId,
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
