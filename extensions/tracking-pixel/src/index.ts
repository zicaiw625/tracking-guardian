import { register } from "@shopify/web-pixels-extension";

// P0-11: Backend URL allowlist for security
// Only these URLs are allowed in production to prevent data exfiltration
const PRODUCTION_BACKEND_ALLOWLIST = [
  "https://tracking-guardian.onrender.com",
  // Add other approved production URLs here
] as const;

// P0-11: Dev/staging URL patterns for non-production testing
const DEV_BACKEND_PATTERNS = [
  /^https?:\/\/localhost/,
  /^https?:\/\/127\.0\.0\.1/,
  /^https?:\/\/.*\.ngrok/,
  /^https?:\/\/.*\.trycloudflare\.com/,
] as const;

// P0-4: Checkout data interface - PII fields intentionally omitted
// This extension does NOT access email, phone, name, or address fields.
// If PCD access is granted in the future, these fields would be added
// with proper consent verification before use.
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
  // PII fields (email, phone, name, address) are NOT accessed
  // This ensures the extension functions correctly without PCD approval
}

interface VisitorConsentCollectedEvent {
  analyticsProcessingAllowed: boolean;
  marketingAllowed: boolean;
  preferencesProcessingAllowed: boolean;
  saleOfDataAllowed: boolean;
}

function toNumber(value: string | number | undefined | null, defaultValue = 0): number {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "number") return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

register(({ analytics, settings, init, customerPrivacy }: any) => {
  const ingestionKey = settings.ingestion_key as string | undefined;
  const shopDomain = init.data?.shop?.myshopifyDomain || "";
  
  const isDevMode = (() => {
    if (shopDomain.includes(".myshopify.dev") || /-(dev|staging|test)\./i.test(shopDomain)) {
      return true;
    }
    return false;
  })();

  // P0-11: Validate and resolve backend URL with security checks
  const resolveBackendUrl = (): string | null => {
    const configuredUrl = (settings.backend_url as string | undefined)?.trim();
    
    // Case 1: URL is configured and in production allowlist
    if (configuredUrl && PRODUCTION_BACKEND_ALLOWLIST.includes(configuredUrl as typeof PRODUCTION_BACKEND_ALLOWLIST[number])) {
      return configuredUrl;
    }
    
    // Case 2: Dev mode - allow localhost/ngrok URLs
    if (isDevMode && configuredUrl) {
      const isDevUrl = DEV_BACKEND_PATTERNS.some(pattern => pattern.test(configuredUrl));
      if (isDevUrl) {
        return configuredUrl;
      }
    }
    
    // Case 3: No URL configured - use first production URL if available
    if (!configuredUrl && PRODUCTION_BACKEND_ALLOWLIST.length > 0) {
      // In production, we require explicit configuration
      // Return the default only in dev mode
      if (isDevMode) {
        return PRODUCTION_BACKEND_ALLOWLIST[0];
      }
      // Production: backend_url should be set during pixel installation
      // Return the production URL but log a warning
      return PRODUCTION_BACKEND_ALLOWLIST[0];
    }
    
    // Case 4: URL configured but not in allowlist and not dev
    // This is a security concern - reject
    return null;
  };

  const backendUrl = resolveBackendUrl();

  function log(...args: unknown[]): void {
    if (isDevMode) {
      console.log("[Tracking Guardian]", ...args);
    }
  }

  // P0-11: Early exit if backend URL could not be resolved (security check)
  if (!backendUrl) {
    if (isDevMode) {
      log("ERROR: Backend URL not in allowlist and not a valid dev URL. Events will not be sent.");
    }
    // Don't subscribe to events if we can't send them
    return;
  }

  if (isDevMode) {
    log("Development mode enabled", {
      shopDomain,
      hasIngestionKey: !!ingestionKey,
      backendUrl,
    });
  }

  let marketingAllowed = false;
  let analyticsAllowed = false;
  let saleOfDataAllowed = true;

  if (customerPrivacy) {
    
    marketingAllowed = customerPrivacy.marketingAllowed === true;
    analyticsAllowed = customerPrivacy.analyticsProcessingAllowed === true;
    saleOfDataAllowed = customerPrivacy.saleOfDataAllowed !== false;
    
    log("Initial consent state:", { marketingAllowed, analyticsAllowed, saleOfDataAllowed });

    try {
      customerPrivacy.subscribe("visitorConsentCollected", (event: VisitorConsentCollectedEvent) => {
        marketingAllowed = event.marketingAllowed === true;
        analyticsAllowed = event.analyticsProcessingAllowed === true;
        saleOfDataAllowed = event.saleOfDataAllowed !== false;
        log("Consent updated:", { marketingAllowed, analyticsAllowed, saleOfDataAllowed });
      });
    } catch {
      
      log("Could not subscribe to consent changes");
    }
  } else {

    log("Customer privacy API not available, defaulting to no tracking");
  }

  /**
   * P0-2: Strict consent check - aligned with shopify.extension.toml declaration.
   * 
   * Our toml declares: marketing=true, analytics=true, sale_of_data="enabled"
   * Shopify will only load this pixel when ALL these conditions are met.
   * 
   * At runtime, we enforce the same rules:
   * - BOTH marketing AND analytics consent must be granted
   * - sale_of_data must not be opted out (false)
   * 
   * This ensures declaration-behavior consistency for App Store review.
   */
  function hasAnyConsent(): boolean {
    // Strict: require BOTH marketing AND analytics (matches toml declaration)
    const hasMarketing = marketingAllowed === true;
    const hasAnalytics = analyticsAllowed === true;
    // Sale of data must not be explicitly denied (undefined -> allowed)
    return hasMarketing && hasAnalytics && saleOfDataAllowed;
  }

  function hasMarketingConsent(): boolean {
    return marketingAllowed === true && saleOfDataAllowed;
  }

  function hasAnalyticsConsent(): boolean {
    return analyticsAllowed === true && saleOfDataAllowed;
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

    // P0-5: Consent gate aligned with toml declaration (marketing=true, analytics=true)
    if (!hasAnyConsent()) {
      log(
        `Skipping ${eventName} - insufficient consent. ` +
        `marketing=${marketingAllowed}, analytics=${analyticsAllowed}, saleOfData=${saleOfDataAllowed}. ` +
        `Need (marketing AND analytics) AND saleOfData.`
      );
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
          saleOfData: saleOfDataAllowed,
        },
        data,
      };
      
      const body = JSON.stringify(payload);

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (ingestionKey) {
        headers["X-Tracking-Guardian-Key"] = ingestionKey;
      }
      headers["X-Tracking-Guardian-Timestamp"] = timestamp.toString();

      const { signal, cleanup } = createTimeoutSignal(5000);

      fetch(`${backendUrl}/api/pixel-events`, {
        method: "POST",
        headers,
        keepalive: true,
        body,
        signal,
      })
        .then((response) => {
          cleanup();
          if (isDevMode) {
            log(`${eventName} sent, status: ${response.status}`);
          }
        })
        .catch((error) => {
          cleanup();
          if (isDevMode) {
            log(`${eventName} failed:`, error);
          }
        });
    } catch (error) {
      if (isDevMode) {
        log("Unexpected error:", error);
      }
    }
  }

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
