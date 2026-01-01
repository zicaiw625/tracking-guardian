

import type { CheckoutData, CartLine } from "./types";
import type { ConsentManager } from "./consent";

export function toNumber(value: string | number | undefined | null, defaultValue = 0): number {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "number") return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

export interface EventSenderConfig {

  backendUrl: string | null;
  shopDomain: string;
  ingestionKey?: string;
  isDevMode: boolean;
  consentManager: ConsentManager;
  logger?: (...args: unknown[]) => void;
}

/**
 * Generate HMAC signature for pixel event
 * Format: HMAC(secret, timestamp + body_hash)
 * 
 * Note: In pixel extension, we use ingestionKey as the secret for HMAC generation.
 * The server will verify using ingestionSecret (which should match ingestionKey).
 * 
 * @param secret - The ingestion key (used as secret for HMAC)
 * @param timestamp - Event timestamp (milliseconds)
 * @param bodyHash - SHA256 hash of the request body
 * @returns Base64-encoded HMAC signature
 */
async function generateHMACSignature(
  secret: string,
  timestamp: number,
  bodyHash: string
): Promise<string> {
  // Use Web Crypto API for HMAC (available in modern browsers and Web Pixels sandbox)
  const message = `${timestamp}:${bodyHash}`;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);

  // Import key for HMAC-SHA256
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  // Generate signature
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);

  // Convert to base64
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

const RETRY_DELAYS_MS = [0, 300, 1200];
const MAX_RETRIES = RETRY_DELAYS_MS.length;

async function sendCheckoutCompletedWithRetry(
  url: string,
  body: string,
  isDevMode: boolean,
  log: (...args: unknown[]) => void,
  retryIndex = 0,
  headers: Record<string, string> = {}
): Promise<void> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        ...headers,
      },
      keepalive: true,
      body,
    });

    if (isDevMode) {
      log(`checkout_completed sent, status: ${response.status}, attempt: ${retryIndex + 1}/${MAX_RETRIES}`);
    }

    if (response.ok) {
      if (isDevMode && retryIndex > 0) {
        log(`checkout_completed succeeded on retry attempt ${retryIndex + 1}`);
      }
      return;
    }

    if (response.status >= 400 && response.status < 500) {

      if (isDevMode) {
        log(`checkout_completed client error ${response.status}, not retrying`);
      }
      return;
    }

    if (retryIndex < MAX_RETRIES - 1) {
      const delay = RETRY_DELAYS_MS[retryIndex + 1];
      if (isDevMode) {
        log(`checkout_completed server error ${response.status}, retrying in ${delay}ms (attempt ${retryIndex + 2}/${MAX_RETRIES})`);
      }
      setTimeout(() => {
        sendCheckoutCompletedWithRetry(url, body, isDevMode, log, retryIndex + 1);
      }, delay);
    } else if (isDevMode) {
      log(`checkout_completed failed after ${MAX_RETRIES} attempts with server error ${response.status}`);
    }
  } catch (error) {

    if (retryIndex < MAX_RETRIES - 1) {
      const delay = RETRY_DELAYS_MS[retryIndex + 1];
      if (isDevMode) {
        log(`checkout_completed network error, retrying in ${delay}ms (attempt ${retryIndex + 2}/${MAX_RETRIES}):`, error);
      }
      setTimeout(() => {
        sendCheckoutCompletedWithRetry(url, body, isDevMode, log, retryIndex + 1);
      }, delay);
    } else if (isDevMode) {
      log(`checkout_completed failed after ${MAX_RETRIES} attempts with network error:`, error);
    }
  }
}

export function createEventSender(config: EventSenderConfig) {
  const { backendUrl, shopDomain, ingestionKey, isDevMode, consentManager, logger } = config;
  const log = logger || (() => {});

  if (!backendUrl) {
    if (isDevMode) {
      log("⚠️ BACKEND_URL not configured - event sending disabled. " +
          "Run pnpm ext:inject to inject the backend URL at build time.");
    }
    return async function sendToBackendDisabled(
      _eventName: string,
      _data: Record<string, unknown>
    ): Promise<void> {

    };
  }

  return async function sendToBackend(eventName: string, data: Record<string, unknown>): Promise<void> {

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

      const nonce = `${timestamp}-${Math.random().toString(36).substring(2, 10)}`;

      const payload = {
        eventName,
        timestamp,
        nonce,
        shopDomain,

        ingestionKey: ingestionKey || null,
        consent: {
          marketing: consentManager.marketingAllowed,
          analytics: consentManager.analyticsAllowed,
          saleOfData: consentManager.saleOfDataAllowed,
        },
        data,
      };

      const body = JSON.stringify(payload);
      const url = `${backendUrl}/api/pixel-events`;

      // P0-03: Generate HMAC signature if ingestionKey is available
      const headers: Record<string, string> = {
        "Content-Type": "text/plain;charset=UTF-8",
        "X-Tracking-Guardian-Timestamp": String(timestamp),
      };

      if (ingestionKey) {
        try {
          // Calculate body hash (SHA256)
          const bodyHashBuffer = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(body)
          );
          const bodyHash = Array.from(new Uint8Array(bodyHashBuffer))
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");

          // Generate HMAC signature
          const signature = await generateHMACSignature(ingestionKey, timestamp, bodyHash);
          headers["X-Tracking-Guardian-Signature"] = signature;
        } catch (hmacError) {
          if (isDevMode) {
            log(`HMAC signature generation failed:`, hmacError);
          }
          // Continue without signature in case of error (server will handle gracefully)
        }
      }

      if (eventName === "checkout_completed") {
        sendCheckoutCompletedWithRetry(url, body, isDevMode, log, 0, headers);
      } else {

        fetch(url, {
          method: "POST",
          headers,
          keepalive: true,
          body,
        }).catch((error) => {
          if (isDevMode) {
            log(`${eventName} failed:`, error);
          }
        });
      }
    } catch (error) {
      if (isDevMode) {
        log("Unexpected error:", error);
      }
    }
  };
}

export function subscribeToCheckoutCompleted(
  analytics: {
    subscribe: (event: string, handler: (event: unknown) => void) => void;
  },
  sendToBackend: (eventName: string, data: Record<string, unknown>) => Promise<void>,
  logger?: (...args: unknown[]) => void
): void {
  const log = logger || (() => {});

  analytics.subscribe("checkout_completed", (event: unknown) => {
    const typedEvent = event as { data?: { checkout?: CheckoutData } };
    const checkout = typedEvent.data?.checkout;
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

    sendToBackend("checkout_completed", {
      orderId: orderId || null,
      checkoutToken: checkoutToken || null,

      value: toNumber(checkout.totalPrice?.amount),
      currency: checkout.currencyCode || "USD",
    });
  });

  log("Tracking Guardian pixel initialized - checkout_completed subscribed");
}

function subscribeToCheckoutStarted(
  analytics: {
    subscribe: (event: string, handler: (event: unknown) => void) => void;
  },
  sendToBackend: (eventName: string, data: Record<string, unknown>) => Promise<void>,
  logger?: (...args: unknown[]) => void
): void {
  const log = logger || (() => {});

  analytics.subscribe("checkout_started", (event: unknown) => {
    const typedEvent = event as { data?: { checkout?: CheckoutData } };
    const checkout = typedEvent.data?.checkout;
    if (!checkout) return;

    sendToBackend("checkout_started", {
      checkoutToken: checkout.token || null,
      value: toNumber(checkout.totalPrice?.amount),
      currency: checkout.currencyCode || "USD",
      items: checkout.lineItems?.map(item => ({
        id: item.id || "",
        name: item.title || "",
        price: toNumber(item.variant?.price?.amount),
        quantity: item.quantity || 1,
      })) || [],
    });
  });

  log("checkout_started event subscribed");
}

function subscribeToProductAddedToCart(
  analytics: {
    subscribe: (event: string, handler: (event: unknown) => void) => void;
  },
  sendToBackend: (eventName: string, data: Record<string, unknown>) => Promise<void>,
  logger?: (...args: unknown[]) => void
): void {
  const log = logger || (() => {});

  analytics.subscribe("product_added_to_cart", (event: unknown) => {
    const typedEvent = event as { data?: { cartLine?: CartLine } };
    const cartLine = typedEvent.data?.cartLine;
    if (!cartLine) return;

    sendToBackend("product_added_to_cart", {
      productId: cartLine.merchandise?.product?.id || null,
      productTitle: cartLine.merchandise?.product?.title || null,
      price: toNumber(cartLine.merchandise?.price?.amount),
      quantity: cartLine.quantity || 1,
      currency: "USD", // Default, will be enriched by backend if available
    });
  });

  log("product_added_to_cart event subscribed");
}

function subscribeToPageViewed(
  analytics: {
    subscribe: (event: string, handler: (event: unknown) => void) => void;
  },
  sendToBackend: (eventName: string, data: Record<string, unknown>) => Promise<void>,
  logger?: (...args: unknown[]) => void
): void {
  const log = logger || (() => {});

  analytics.subscribe("page_viewed", (event: unknown) => {
    const typedEvent = event as { data?: { page?: { url?: string; title?: string } } };
    const page = typedEvent.data?.page;
    if (!page) return;

    sendToBackend("page_viewed", {
      url: page.url || null,
      title: page.title || null,
    });
  });

  log("page_viewed event subscribed");
}

function subscribeToProductViewed(
  analytics: {
    subscribe: (event: string, handler: (event: unknown) => void) => void;
  },
  sendToBackend: (eventName: string, data: Record<string, unknown>) => Promise<void>,
  logger?: (...args: unknown[]) => void
): void {
  const log = logger || (() => {});

  analytics.subscribe("product_viewed", (event: unknown) => {
    const typedEvent = event as { data?: { productVariant?: { product?: { id?: string; title?: string }; price?: { amount?: string | number } } } };
    const productVariant = typedEvent.data?.productVariant;
    if (!productVariant) return;

    sendToBackend("product_viewed", {
      productId: productVariant.product?.id || null,
      productTitle: productVariant.product?.title || null,
      price: toNumber(productVariant.price?.amount),
      currency: "USD", // Default, will be enriched by backend if available
    });
  });

  log("product_viewed event subscribed");
}

function subscribeToCheckoutContactInfoSubmitted(
  analytics: {
    subscribe: (event: string, handler: (event: unknown) => void) => void;
  },
  sendToBackend: (eventName: string, data: Record<string, unknown>) => Promise<void>,
  logger?: (...args: unknown[]) => void
): void {
  const log = logger || (() => {});

  analytics.subscribe("checkout_contact_info_submitted", (event: unknown) => {
    const typedEvent = event as { data?: { checkout?: CheckoutData } };
    const checkout = typedEvent.data?.checkout;
    if (!checkout) return;

    sendToBackend("checkout_contact_info_submitted", {
      checkoutToken: checkout.token || null,
      value: toNumber(checkout.totalPrice?.amount),
      currency: checkout.currencyCode || "USD",
    });
  });

  log("checkout_contact_info_submitted event subscribed");
}

function subscribeToCheckoutShippingInfoSubmitted(
  analytics: {
    subscribe: (event: string, handler: (event: unknown) => void) => void;
  },
  sendToBackend: (eventName: string, data: Record<string, unknown>) => Promise<void>,
  logger?: (...args: unknown[]) => void
): void {
  const log = logger || (() => {});

  analytics.subscribe("checkout_shipping_info_submitted", (event: unknown) => {
    const typedEvent = event as { data?: { checkout?: CheckoutData } };
    const checkout = typedEvent.data?.checkout;
    if (!checkout) return;

    sendToBackend("checkout_shipping_info_submitted", {
      checkoutToken: checkout.token || null,
      value: toNumber(checkout.totalPrice?.amount),
      currency: checkout.currencyCode || "USD",
      items: checkout.lineItems?.map(item => ({
        id: item.id || "",
        name: item.title || "",
        price: toNumber(item.variant?.price?.amount),
        quantity: item.quantity || 1,
      })) || [],
    });
  });

  log("checkout_shipping_info_submitted event subscribed");
}

function subscribeToPaymentInfoSubmitted(
  analytics: {
    subscribe: (event: string, handler: (event: unknown) => void) => void;
  },
  sendToBackend: (eventName: string, data: Record<string, unknown>) => Promise<void>,
  logger?: (...args: unknown[]) => void
): void {
  const log = logger || (() => {});

  analytics.subscribe("payment_info_submitted", (event: unknown) => {
    const typedEvent = event as { data?: { checkout?: CheckoutData } };
    const checkout = typedEvent.data?.checkout;
    if (!checkout) return;

    sendToBackend("payment_info_submitted", {
      checkoutToken: checkout.token || null,
      value: toNumber(checkout.totalPrice?.amount),
      currency: checkout.currencyCode || "USD",
      items: checkout.lineItems?.map(item => ({
        id: item.id || "",
        name: item.title || "",
        price: toNumber(item.variant?.price?.amount),
        quantity: item.quantity || 1,
      })) || [],
    });
  });

  log("payment_info_submitted event subscribed");
}


export function subscribeToAnalyticsEvents(
  analytics: {
    subscribe: (event: string, handler: (event: unknown) => void) => void;
  },
  sendToBackend: (eventName: string, data: Record<string, unknown>) => Promise<void>,
  logger?: (...args: unknown[]) => void,
  mode: "purchase_only" | "full_funnel" = "purchase_only"
): void {
  // Always subscribe to checkout_completed (primary event)
  subscribeToCheckoutCompleted(analytics, sendToBackend, logger);

  // Subscribe to full funnel events if mode is full_funnel
  if (mode === "full_funnel") {
    // Checkout funnel events
    subscribeToCheckoutStarted(analytics, sendToBackend, logger);
    subscribeToCheckoutContactInfoSubmitted(analytics, sendToBackend, logger);
    subscribeToCheckoutShippingInfoSubmitted(analytics, sendToBackend, logger);
    subscribeToPaymentInfoSubmitted(analytics, sendToBackend, logger);
    
    // Product & cart events
    subscribeToProductAddedToCart(analytics, sendToBackend, logger);
    subscribeToProductViewed(analytics, sendToBackend, logger);
    
    // Page navigation
    subscribeToPageViewed(analytics, sendToBackend, logger);
    
    const log = logger || (() => {});
    log("Tracking Guardian pixel initialized - full_funnel mode enabled with all standard events");
  }
}

