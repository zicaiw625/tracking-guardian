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

interface CustomerPrivacyState {
  analyticsProcessingAllowed: boolean;
  marketingAllowed: boolean;
  preferencesProcessingAllowed: boolean;
  saleOfDataAllowed: boolean;
}

interface VisitorConsentCollectedEvent {
  customerPrivacy: CustomerPrivacyState;
}

function toNumber(value: string | number | undefined | null, defaultValue = 0): number {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "number") return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

register(({ analytics, settings, init, customerPrivacy }: any) => {
  const ingestionKey = settings.ingestion_key as string | undefined;
  const shopDomain = (settings.shop_domain as string | undefined) || init.data?.shop?.myshopifyDomain || "";
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

  function updateConsentFromStatus(status: CustomerPrivacyState | null | undefined, source: "init" | "event"): void {
    if (!status) {
      log(`${source} customerPrivacy not available, consent state unknown`);
      return;
    }

    marketingAllowed = status.marketingAllowed === true;
    analyticsAllowed = status.analyticsProcessingAllowed === true;
    saleOfDataAllowed = status.saleOfDataAllowed !== false;

    log(`Consent state updated from ${source}.customerPrivacy:`, {
      marketingAllowed,
      analyticsAllowed,
      saleOfDataAllowed,
    });
  }

  updateConsentFromStatus(init.customerPrivacy as CustomerPrivacyState | undefined, "init");

  if (customerPrivacy && typeof customerPrivacy.subscribe === "function") {
    try {
      customerPrivacy.subscribe("visitorConsentCollected", (event: VisitorConsentCollectedEvent) => {
        updateConsentFromStatus(event.customerPrivacy, "event");
      });
      log("Subscribed to visitorConsentCollected");
    } catch (err) {
      log("Could not subscribe to consent changes:", err);
    }
  } else {
    log("customerPrivacy.subscribe not available, using initial state only");
  }

  function hasAnalyticsConsent(): boolean {
    return analyticsAllowed === true;
  }
  
  function hasMarketingConsent(): boolean {
    return marketingAllowed === true && saleOfDataAllowed;
  }
  
  function hasFullConsent(): boolean {
    return analyticsAllowed === true && marketingAllowed === true && saleOfDataAllowed;
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
    if (!hasFullConsent()) {
      log(
        `Skipping ${eventName} - insufficient consent. ` +
        `analytics=${analyticsAllowed}, marketing=${marketingAllowed}, saleOfData=${saleOfDataAllowed}`
      );
      return;
    }
    
    log(
      `${eventName}: Sending to backend. ` +
      `Consent state: analytics=${analyticsAllowed}, marketing=${marketingAllowed}, saleOfData=${saleOfDataAllowed}`
    );

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

  analytics.subscribe("checkout_contact_info_submitted", (event) => {
    const checkout = event.data?.checkout as CheckoutData | undefined;
    if (!checkout) return;

    sendToBackend("checkout_contact_info_submitted", {
      checkoutToken: checkout.token || null,
      value: toNumber(checkout.totalPrice?.amount),
      currency: checkout.currencyCode || "USD",
    });
  });

  analytics.subscribe("checkout_shipping_info_submitted", (event) => {
    const checkout = event.data?.checkout as CheckoutData | undefined;
    if (!checkout) return;

    sendToBackend("checkout_shipping_info_submitted", {
      checkoutToken: checkout.token || null,
      value: toNumber(checkout.totalPrice?.amount),
      currency: checkout.currencyCode || "USD",
    });
  });

  analytics.subscribe("payment_info_submitted", (event) => {
    const checkout = event.data?.checkout as CheckoutData | undefined;
    if (!checkout) return;

    sendToBackend("payment_info_submitted", {
      checkoutToken: checkout.token || null,
      value: toNumber(checkout.totalPrice?.amount),
      currency: checkout.currencyCode || "USD",
    });
  });

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

  analytics.subscribe("page_viewed", (event) => {
    const pageUrl = event.context?.document?.location?.href || "";
    const pageTitle = event.context?.document?.title || "";
    
    sendToBackend("page_viewed", {
      url: pageUrl,
      title: pageTitle,
      timestamp: Date.now(),
    });
  });

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
