/**
 * Event Handling Module
 * 
 * Handles sending events to the backend and subscribing to Shopify analytics events.
 */

import type { CheckoutData, CartLine } from "./types";
import type { ConsentManager } from "./consent";

/**
 * Convert a value to a number, with a default fallback.
 */
export function toNumber(value: string | number | undefined | null, defaultValue = 0): number {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "number") return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Create an abort signal with timeout.
 */
function createTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId),
  };
}

export interface EventSenderConfig {
  backendUrl: string;
  shopDomain: string;
  ingestionKey?: string;
  isDevMode: boolean;
  consentManager: ConsentManager;
  logger?: (...args: unknown[]) => void;
}

/**
 * Create an event sender function.
 */
export function createEventSender(config: EventSenderConfig) {
  const { backendUrl, shopDomain, ingestionKey, isDevMode, consentManager, logger } = config;
  const log = logger || (() => {});

  return async function sendToBackend(eventName: string, data: Record<string, unknown>): Promise<void> {
    // P1-01: Changed from hasFullConsent() to allow partial consent scenarios.
    // Events are sent with consent state; server-side will filter by platform.
    // - Analytics platforms (GA4): only need analytics consent
    // - Marketing platforms (Meta, TikTok): need marketing consent + saleOfData
    const hasAnyConsent = consentManager.hasAnalyticsConsent() || consentManager.hasMarketingConsent();
    
    if (!hasAnyConsent) {
      log(
        `Skipping ${eventName} - no consent at all. ` +
        `analytics=${consentManager.analyticsAllowed}, marketing=${consentManager.marketingAllowed}`
      );
      return;
    }

    log(
      `${eventName}: Sending to backend with consent state. ` +
      `analytics=${consentManager.analyticsAllowed}, marketing=${consentManager.marketingAllowed}, saleOfData=${consentManager.saleOfDataAllowed}`
    );

    try {
      const timestamp = Date.now();
      const payload = {
        eventName,
        timestamp,
        shopDomain,
        consent: {
          marketing: consentManager.marketingAllowed,
          analytics: consentManager.analyticsAllowed,
          saleOfData: consentManager.saleOfDataAllowed,
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
  };
}

/**
 * Subscribe to all analytics events.
 */
export function subscribeToAnalyticsEvents(
  analytics: {
    subscribe: (event: string, handler: (event: any) => void) => void;
  },
  sendToBackend: (eventName: string, data: Record<string, unknown>) => Promise<void>,
  logger?: (...args: unknown[]) => void
): void {
  const log = logger || (() => {});

  // Checkout started
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

  // Contact info submitted
  analytics.subscribe("checkout_contact_info_submitted", (event) => {
    const checkout = event.data?.checkout as CheckoutData | undefined;
    if (!checkout) return;

    sendToBackend("checkout_contact_info_submitted", {
      checkoutToken: checkout.token || null,
      value: toNumber(checkout.totalPrice?.amount),
      currency: checkout.currencyCode || "USD",
    });
  });

  // Shipping info submitted
  analytics.subscribe("checkout_shipping_info_submitted", (event) => {
    const checkout = event.data?.checkout as CheckoutData | undefined;
    if (!checkout) return;

    sendToBackend("checkout_shipping_info_submitted", {
      checkoutToken: checkout.token || null,
      value: toNumber(checkout.totalPrice?.amount),
      currency: checkout.currencyCode || "USD",
    });
  });

  // Payment info submitted
  analytics.subscribe("payment_info_submitted", (event) => {
    const checkout = event.data?.checkout as CheckoutData | undefined;
    if (!checkout) return;

    sendToBackend("payment_info_submitted", {
      checkoutToken: checkout.token || null,
      value: toNumber(checkout.totalPrice?.amount),
      currency: checkout.currencyCode || "USD",
    });
  });

  // Checkout completed (purchase)
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

  // Page viewed
  analytics.subscribe("page_viewed", (event) => {
    const pageUrl = event.context?.document?.location?.href || "";
    const pageTitle = event.context?.document?.title || "";

    sendToBackend("page_viewed", {
      url: pageUrl,
      title: pageTitle,
      timestamp: Date.now(),
    });
  });

  // Product added to cart
  analytics.subscribe("product_added_to_cart", (event) => {
    const cartLine = event.data?.cartLine as CartLine | undefined;
    if (!cartLine?.merchandise?.product) return;

    sendToBackend("product_added_to_cart", {
      productId: cartLine.merchandise.product.id || "",
      productTitle: cartLine.merchandise.product.title || "",
      price: toNumber(cartLine.merchandise.price?.amount),
      quantity: cartLine.quantity || 1,
    });
  });

  log("Tracking Guardian pixel initialized with extended event subscriptions");
}

