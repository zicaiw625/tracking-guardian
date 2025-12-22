import { register } from "@shopify/web-pixels-extension";
import { BACKEND_URL } from "../../shared/config";

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
  // P0-1: Read from unified settings schema
  const ingestionKey = settings.ingestion_key as string | undefined;
  // Prefer shop_domain from settings (set by app), fallback to init data
  const shopDomain = (settings.shop_domain as string | undefined) || init.data?.shop?.myshopifyDomain || "";
  // Prefer backend_url from settings (set by app), fallback to build-time config
  const backendUrl = (settings.backend_url as string | undefined) || BACKEND_URL;
  
  const isDevMode = (() => {
    if (shopDomain.includes(".myshopify.dev") || /-(dev|staging|test)\./i.test(shopDomain)) {
      return true;
    }
    return false;
  })();

  function log(...args: unknown[]): void {
    if (isDevMode) {
      console.log("[Tracking Guardian]", ...args);
    }
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
    
    log("Initial consent state (from customerPrivacy object):", { 
      marketingAllowed, 
      analyticsAllowed, 
      saleOfDataAllowed 
    });

    try {
      customerPrivacy.subscribe("visitorConsentCollected", (event: VisitorConsentCollectedEvent) => {
        marketingAllowed = event.marketingAllowed === true;
        analyticsAllowed = event.analyticsProcessingAllowed === true;
        saleOfDataAllowed = event.saleOfDataAllowed !== false;
        log("Consent updated (via visitorConsentCollected event):", { 
          marketingAllowed, 
          analyticsAllowed, 
          saleOfDataAllowed 
        });
      });
    } catch {
      log("Could not subscribe to consent changes, using initial state only");
    }
  } else {
    log("Customer privacy object not available, defaulting to no tracking");
  }

  // P1-2: Consent requirements by destination type
  // - Analytics destinations (GA4 for analytics-only): analyticsProcessingAllowed
  // - Marketing destinations (Meta, TikTok, Google Ads): marketingAllowed + saleOfDataAllowed
  //
  // Our App Pixel sends to a backend that forwards to multiple platforms.
  // The backend will filter per-platform based on consent state sent with the event.
  // Here we only send if at least analytics is allowed.
  
  function hasAnalyticsConsent(): boolean {
    return analyticsAllowed === true;
  }
  
  function hasMarketingConsent(): boolean {
    return marketingAllowed === true && saleOfDataAllowed;
  }
  
  function hasAnyConsent(): boolean {
    // For App Pixel: we send if analytics is allowed
    // Marketing platforms will be filtered server-side based on consent.marketing flag
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
    // P1-2: Refined consent check
    // We send if analytics is allowed (for GA4/analytics purposes)
    // The backend will filter marketing platforms based on the consent flags we send
    if (!hasAnyConsent()) {
      log(
        `Skipping ${eventName} - no consent. ` +
        `analytics=${analyticsAllowed}. Need at least analytics consent.`
      );
      return;
    }
    
    // Log marketing status for debugging
    if (!hasMarketingConsent()) {
      log(
        `${eventName}: Analytics consent only. ` +
        `Marketing platforms will be filtered server-side. ` +
        `(marketing=${marketingAllowed}, saleOfData=${saleOfDataAllowed})`
      );
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

  // P1-1: Subscribe to checkout funnel events for better tracking
  // These events form a funnel that helps identify where conversions are lost
  
  // 1. Checkout Started - user begins checkout
  analytics.subscribe("checkout_started", (event) => {
    const checkout = event.data?.checkout as CheckoutData | undefined;
    if (!checkout) return;

    const checkoutToken = checkout.token;
    if (!checkoutToken) {
      log("checkout_started: No checkoutToken, skipping");
      return;
    }

    sendToBackend("checkout_started", {
      checkoutToken,
      value: toNumber(checkout.totalPrice?.amount),
      currency: checkout.currencyCode || "USD",
      itemCount: (checkout.lineItems || []).reduce((sum, item) => sum + (item.quantity || 1), 0),
    });
  });

  // 2. Contact Info Submitted - user provided email/phone
  analytics.subscribe("checkout_contact_info_submitted", (event) => {
    const checkout = event.data?.checkout as CheckoutData | undefined;
    if (!checkout) return;

    sendToBackend("checkout_contact_info_submitted", {
      checkoutToken: checkout.token || null,
      value: toNumber(checkout.totalPrice?.amount),
      currency: checkout.currencyCode || "USD",
    });
  });

  // 3. Shipping Info Submitted - user provided address
  analytics.subscribe("checkout_shipping_info_submitted", (event) => {
    const checkout = event.data?.checkout as CheckoutData | undefined;
    if (!checkout) return;

    sendToBackend("checkout_shipping_info_submitted", {
      checkoutToken: checkout.token || null,
      value: toNumber(checkout.totalPrice?.amount),
      currency: checkout.currencyCode || "USD",
    });
  });

  // 4. Payment Info Submitted - user provided payment
  analytics.subscribe("payment_info_submitted", (event) => {
    const checkout = event.data?.checkout as CheckoutData | undefined;
    if (!checkout) return;

    sendToBackend("payment_info_submitted", {
      checkoutToken: checkout.token || null,
      value: toNumber(checkout.totalPrice?.amount),
      currency: checkout.currencyCode || "USD",
    });
  });

  // 5. Checkout Completed - the main conversion event
  // This is the PRIMARY event for purchase tracking
  // Even if this fails, orders/paid webhook provides a fallback
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

  // Optional: Page viewed - for broader analytics (analytics-only consent)
  analytics.subscribe("page_viewed", (event) => {
    // Only send if analytics is allowed (less restrictive than marketing)
    if (!analyticsAllowed) return;
    
    const pageUrl = event.context?.document?.location?.href || "";
    const pageTitle = event.context?.document?.title || "";
    
    // Skip if marketing not allowed - we only track page views for analytics purposes
    // and don't need to send to backend for CAPI (which requires marketing consent)
    if (!marketingAllowed) {
      log("page_viewed: Marketing not allowed, only logging locally");
      return;
    }
    
    sendToBackend("page_viewed", {
      url: pageUrl,
      title: pageTitle,
      timestamp: Date.now(),
    });
  });

  // Optional: Product added to cart - for funnel tracking
  analytics.subscribe("product_added_to_cart", (event) => {
    const cartLine = event.data?.cartLine as {
      merchandise?: {
        product?: { id?: string; title?: string };
        price?: { amount?: string | number };
      };
      quantity?: number;
    } | undefined;
    
    if (!cartLine?.merchandise?.product) return;

    sendToBackend("product_added_to_cart", {
      productId: cartLine.merchandise.product.id || "",
      productTitle: cartLine.merchandise.product.title || "",
      price: toNumber(cartLine.merchandise.price?.amount),
      quantity: cartLine.quantity || 1,
    });
  });

  log("Tracking Guardian pixel initialized with extended event subscriptions");
});
