import { register } from "@shopify/web-pixels-extension";

// P1-4: Default backend URL, can be overridden via extension settings
const DEFAULT_BACKEND_URL = "https://tracking-guardian.onrender.com";

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
  email?: string;
  phone?: string;
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
  
  // P1-4: Use backend_url from settings, fallback to default
  const backendUrl = (settings.backend_url as string | undefined)?.trim() || DEFAULT_BACKEND_URL;
  
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
   * P0-3: Check if we have any consent that allows data collection.
   * 
   * Changed from requiring BOTH marketing AND analytics to requiring EITHER.
   * The backend will filter events per-platform based on the consent state we send.
   * 
   * Previous (too restrictive): marketing && analytics && saleOfData
   * New (correct): (marketing || analytics) && saleOfData
   * 
   * This ensures:
   * - User who only consents to marketing → marketing platforms get data
   * - User who only consents to analytics → analytics platforms get data
   * - User who denies sale of data → no data sent at all
   */
  function hasAnyConsent(): boolean {
    // At least one tracking type must be allowed
    const hasTrackingConsent = marketingAllowed === true || analyticsAllowed === true;
    // Sale of data must not be explicitly denied (defaults to true)
    return hasTrackingConsent && saleOfDataAllowed;
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

    if (!hasAnyConsent()) {
      log(
        `Skipping ${eventName} - insufficient consent. ` +
        `marketing=${marketingAllowed}, analytics=${analyticsAllowed}, saleOfData=${saleOfDataAllowed}. ` +
        `Need (marketing OR analytics) AND saleOfData.`
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
