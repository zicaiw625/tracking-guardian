/**
 * Tracking Guardian - Web Pixel Extension
 * 
 * P0-01: Backend URL Configuration
 * The backend URL is hardcoded (not merchant-configurable) to prevent 
 * data exfiltration concerns during App Store review.
 * 
 * P0-02: Privacy-First Event Collection
 * ONLY checkout_completed events are sent to the backend.
 * Other events (page_viewed, product_viewed, etc.) are NOT collected.
 * This aligns with our privacy disclosure that we don't collect browsing history.
 * 
 * P1-1: Ingestion Key Clarification
 * The ingestion_secret is a CORRELATION TOKEN, NOT a security credential.
 * - It is visible in browser network traffic (anyone can see it)
 * - Primary purpose: correlate pixel events with webhooks, filter noise/misconfigured requests
 * - Server validates it to reject obviously invalid requests (204 No Content)
 * 
 * REAL SECURITY BOUNDARIES (defense in depth):
 * 1. TLS encryption (all traffic is HTTPS)
 * 2. Origin validation (only Shopify checkout/thank-you page origins accepted)
 * 3. Rate limiting (per-shop and global limits)
 * 4. Data minimization (no PII collected, only order IDs and values)
 * 5. Webhook verification (orderId must match ORDERS_PAID webhook for CAPI sending)
 */

import { register } from "@shopify/web-pixels-extension";

/**
 * P0-2: Centralized Backend URL Configuration
 * 
 * DEPLOYMENT INSTRUCTIONS:
 * This URL is set at build time. For different environments:
 * 
 * - Production: https://tracking-guardian.onrender.com (default)
 * - Staging: Set BACKEND_URL env var before `shopify app deploy`
 * - Development: Uses ngrok tunnel via SHOPIFY_APP_URL
 * 
 * SECURITY: This is intentionally NOT merchant-configurable.
 * Only the app developer can change this by rebuilding the extension.
 * 
 * See: extensions/shared/config.ts for centralized configuration
 */
const BACKEND_URL = "https://tracking-guardian.onrender.com";

// P0-2: Allowed URL patterns for validation (kept for auditing/documentation)
// These are the only domains that should ever be set as BACKEND_URL
const ALLOWED_URL_PATTERNS = [
  /^https:\/\/tracking-guardian\.onrender\.com$/,
  /^https:\/\/tracking-guardian-staging\.onrender\.com$/,
  // Local development (only works in dev mode)
  /^https?:\/\/localhost:\d+$/,
  /^https?:\/\/127\.0\.0\.1:\d+$/,
];

// Server-side security layers:
// 1. Ingestion key validation (reject requests with missing/invalid key)
// 2. Origin validation (only Shopify origins allowed)
// 3. Rate limiting (per-shop and global)
// 4. Order verification (orderId format, shop ownership via webhook)

// Types are intentionally loose to handle Shopify's varying type definitions
interface CheckoutData {
  order?: { id?: string };
  token?: string;
  totalPrice?: { amount?: string | number };
  totalTax?: { amount?: string | number };
  shippingLine?: { price?: { amount?: string | number } };
  currencyCode?: string;
  lineItems?: Array<{
    id?: string;
    title?: string;
    quantity?: number;
    variant?: { price?: { amount?: string | number } };
  }>;
  
  // P3-1 NOTE: email/phone fields exist in Shopify's checkout object but are 
  // intentionally NOT accessed or sent by this pixel to comply with data minimization.
  // These type definitions are kept only for TypeScript compatibility with Shopify's types.
  // DO NOT access these fields - they contain PII that should not leave the client.
  email?: string;
  phone?: string;
}

// P0-02: ProductVariantData and CartLineData types removed
// They were only used by page_viewed, product_viewed, etc. which are no longer collected

interface VisitorConsentCollectedEvent {
  analyticsProcessingAllowed: boolean;
  marketingAllowed: boolean;
  preferencesProcessingAllowed: boolean;
  saleOfDataAllowed: boolean;
}

// Helper to safely convert amount to number
function toNumber(value: string | number | undefined | null, defaultValue = 0): number {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "number") return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
register(({ analytics, settings, init, customerPrivacy }: any) => {
  
  // P0-2: Use centralized backend URL (no merchant-configurable URL)
  // See extensions/shared/config.ts for URL management strategy
  const backendUrl = BACKEND_URL;

  // P1-2: Backwards-compatible reading of ingestion key
  // Read from both "ingestion_key" (new) and "ingestion_secret" (legacy)
  // This is NOT a security credential - it's used for request correlation and diagnostics
  const ingestionKey = (settings.ingestion_key || settings.ingestion_secret) as string | undefined;
  const shopDomain = init.data?.shop?.myshopifyDomain || "";
  
  // P0-03: Debug mode removed - Shopify settings are strings, not booleans
  // For debugging, use browser DevTools Network tab to inspect requests
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function log(..._args: unknown[]): void {
    // No-op: debug logging disabled in production
    // To enable: uncomment the line below
    // console.log("[Tracking Guardian]", ..._args);
  }

  // P0-03: generateSignature function removed
  // Security is now enforced server-side through:
  // 1. Origin validation (only Shopify origins)
  // 2. Rate limiting (prevents abuse)
  // 3. Order verification (validates orderId belongs to shop)

  let marketingAllowed = false;
  let analyticsAllowed = false;
  // P1-1: Track sale_of_data consent (for CCPA compliance)
  // When sale_of_data="enabled" in extension.toml, if customer opts out, we must respect it
  let saleOfDataAllowed = true; // Default true (no opt-out detected)

  // customerPrivacy is provided directly to the register callback
  if (customerPrivacy) {
    
    marketingAllowed = customerPrivacy.marketingAllowed === true;
    analyticsAllowed = customerPrivacy.analyticsProcessingAllowed === true;
    // P1-1: Check sale of data consent
    // Note: saleOfDataAllowed is true by default, becomes false when customer explicitly opts out
    saleOfDataAllowed = customerPrivacy.saleOfDataAllowed !== false;
    
    log("Initial consent state:", { marketingAllowed, analyticsAllowed, saleOfDataAllowed });

    try {
      customerPrivacy.subscribe("visitorConsentCollected", (event: VisitorConsentCollectedEvent) => {
        marketingAllowed = event.marketingAllowed === true;
        analyticsAllowed = event.analyticsProcessingAllowed === true;
        // P1-1: Also track sale of data opt-out
        saleOfDataAllowed = event.saleOfDataAllowed !== false;
        log("Consent updated:", { marketingAllowed, analyticsAllowed, saleOfDataAllowed });
      });
    } catch {
      
      log("Could not subscribe to consent changes");
    }
  } else {

    log("Customer privacy API not available, defaulting to no tracking");
  }

  // P0-03: Updated consent check to match customer_privacy declaration
  // Since marketing=true in extension.toml, pixel only loads when marketing consent is granted
  // We still check saleOfDataAllowed for CCPA compliance
  function hasAnyConsent(): boolean {
    // P0-03: Both marketing and analytics are required for this pixel to load
    // So if we reach here, both consents should be true
    // We only need to check saleOfDataAllowed (CCPA opt-out)
    const hasRequiredConsent = marketingAllowed === true && analyticsAllowed === true;
    return hasRequiredConsent && saleOfDataAllowed;
  }

  function hasMarketingConsent(): boolean {
    return marketingAllowed === true && saleOfDataAllowed;
  }

  function hasAnalyticsConsent(): boolean {
    return analyticsAllowed === true;
  }

  function createTimeoutSignal(timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    return {
      signal: controller.signal,
      cleanup: () => clearTimeout(timeoutId),
    };
  }

  async function sendToBackend(
    eventName: string,
    data: Record<string, unknown>
  ): Promise<void> {

    if (!hasAnyConsent()) {
      log(`Skipping ${eventName} - no consent (marketing: ${marketingAllowed}, analytics: ${analyticsAllowed}, saleOfData: ${saleOfDataAllowed})`);
      return;
    }

    try {
      const timestamp = Date.now();
      const payload = {
        eventName,
        timestamp,
        shopDomain,
        consent: {
          marketing: marketingAllowed,
          analytics: analyticsAllowed,
          // P1-1: Include sale_of_data consent state
          saleOfData: saleOfDataAllowed,
        },
        data,
      };
      
      const body = JSON.stringify(payload);

      // P0-03: Headers simplified - no more HMAC signatures
      // ingestion_key is sent for correlation/diagnostics only
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // P0-03: Send ingestion key for request correlation (optional, not for security)
      if (ingestionKey) {
        headers["X-Tracking-Guardian-Key"] = ingestionKey;
      }
      headers["X-Tracking-Guardian-Timestamp"] = timestamp.toString();

      const { signal, cleanup } = createTimeoutSignal(5000);

      // P1-4: Use keepalive to prevent request cancellation on page unload
      fetch(`${backendUrl}/api/pixel-events`, {
        method: "POST",
        headers,
        keepalive: true,
        body,
        signal,
      })
        .then(() => cleanup())
        .catch(() => {
          cleanup();
        });
    } catch {
      // Silently ignore errors - pixel should never disrupt checkout
    }
  }

  // P0-02: ONLY checkout_completed is sent to backend
  // Other events (page_viewed, product_viewed, etc.) are NOT collected
  // This aligns with our privacy disclosure that we don't collect browsing history
  //
  // Why only checkout_completed?
  // 1. Privacy: We don't need/store browsing behavior
  // 2. CAPI: Server-side conversion tracking only needs completed purchases
  // 3. Compliance: Minimizes data collection footprint for App Store review

  analytics.subscribe("checkout_completed", (event) => {
    const checkout = event.data?.checkout as CheckoutData | undefined;
    if (!checkout) return;

    const orderId = checkout.order?.id;
    const checkoutToken = checkout.token;

    if (!orderId) {
      log("checkout_completed: No order.id available, using checkoutToken for fallback");
    }

    if (!orderId && !checkoutToken) {
      log("checkout_completed: No orderId or checkoutToken, skipping");
      return;
    }

    const value = toNumber(checkout.totalPrice?.amount);
    const tax = toNumber(checkout.totalTax?.amount);
    const shipping = toNumber(checkout.shippingLine?.price?.amount);

    sendToBackend("checkout_completed", {

      orderId: orderId || null,
      checkoutToken: checkoutToken || null,
      value,
      tax,
      shipping,
      currency: checkout.currencyCode || "USD",
      
      items: (checkout.lineItems || []).map((item) => ({
        id: item.id || "",
        name: item.title || "",
        price: toNumber(item.variant?.price?.amount),
        quantity: item.quantity || 1,
      })),
    });
  });
});
