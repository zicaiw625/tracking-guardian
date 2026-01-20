import type { CheckoutData, CartLine } from "./types";
import type { ConsentManager } from "./consent";

import { sha256 } from "@noble/hashes/sha256";
import { hmac } from "@noble/hashes/hmac";
import { utf8ToBytes, bytesToHex } from "@noble/hashes/utils";

export function toNumber(value: string | number | undefined | null, defaultValue = 0): number {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "number") return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

const MAX_ITEMS_PER_EVENT = 50;

function truncateItems(items: Array<{
  id?: string;
  name?: string;
  price?: number;
  quantity?: number;
  variantId?: string | null;
  productId?: string | null;
  productTitle?: string | null;
}>): Array<{
  id: string;
  quantity: number;
  price: number;
}> {
  return items
    .slice(0, MAX_ITEMS_PER_EVENT)
    .map(item => ({
      id: item.id || "",
      quantity: item.quantity || 1,
      price: item.price || 0,
    }))
    .filter(item => item.id);
}

export interface EventSenderConfig {
  backendUrl: string | null;
  shopDomain: string;
  ingestionKey?: string;
  isDevMode: boolean;
  consentManager: ConsentManager;
  logger?: (...args: unknown[]) => void;
  environment?: "test" | "live";
}

function generateHMACSignature(
  secret: string,
  timestamp: number,
  shopDomain: string,
  bodyHash: string
): string {
  const message = `${timestamp}:${shopDomain}:${bodyHash}`;
  return bytesToHex(hmac(sha256, utf8ToBytes(secret), utf8ToBytes(message)));
}

function sha256Hex(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input)));
}

const REQUEST_TIMEOUT_MS = 4000;
const MAX_TOTAL_RETRY_MS = 5000;
const RETRY_DELAYS_MS = [0, 300, 1200];
const MAX_RETRIES = RETRY_DELAYS_MS.length;

async function sendCheckoutCompletedWithRetry(
  url: string,
  body: string,
  isDevMode: boolean,
  log: (...args: unknown[]) => void,
  headers: Record<string, string>,
  startTime: number
): Promise<void> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        keepalive: true,
        body,
        signal: controller.signal,
      });
      if (isDevMode) {
        log(`checkout_completed sent, status: ${response.status}, attempt: ${attempt + 1}/${MAX_RETRIES}`);
      }
      if (response.ok) {
        if (isDevMode && attempt > 0) {
          log(`checkout_completed succeeded on retry attempt ${attempt + 1}`);
        }
        return;
      }
      if (response.status >= 400 && response.status < 500) {
        if (isDevMode) {
          log(`checkout_completed client error ${response.status}, not retrying`);
        }
        return;
      }
      if (attempt < MAX_RETRIES - 1 && Date.now() - startTime <= MAX_TOTAL_RETRY_MS) {
        const delay = RETRY_DELAYS_MS[attempt + 1];
        if (isDevMode) {
          log(`checkout_completed server error ${response.status}, retrying in ${delay}ms (attempt ${attempt + 2}/${MAX_RETRIES})`);
        }
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      if (isDevMode) {
        log(`checkout_completed failed after ${MAX_RETRIES} attempts with server error ${response.status}`);
      }
      return;
    } catch (error) {
      if (attempt < MAX_RETRIES - 1 && Date.now() - startTime <= MAX_TOTAL_RETRY_MS) {
        const delay = RETRY_DELAYS_MS[attempt + 1];
        if (isDevMode) {
          log(`checkout_completed network error, retrying in ${delay}ms (attempt ${attempt + 2}/${MAX_RETRIES}):`, error);
        }
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      if (isDevMode) {
        log(`checkout_completed failed after ${MAX_RETRIES} attempts with network error:`, error);
      }
      return;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

const BATCH_CONFIG = {
  MAX_BATCH_SIZE: 10,
  MAX_BATCH_DELAY_MS: 1000,
  FLUSH_IMMEDIATE_EVENTS: ["checkout_completed"],
} as const;

interface QueuedEvent {
  eventName: string;
  data: Record<string, unknown>;
  timestamp: number;
  nonce: string;
}

function generateNonce(): { timestamp: number; nonce: string } {
  const timestamp = Date.now();
  let randomHex = "";
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    const randomBytes = new Uint8Array(6);
    globalThis.crypto.getRandomValues(randomBytes);
    randomHex = Array.from(randomBytes)
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
  }
  if (!randomHex) {
    randomHex = Array.from({ length: 3 }, () => Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, "0"))
      .join("");
  }
  return { timestamp, nonce: `${timestamp}-${randomHex}` };
}

export function createEventSender(config: EventSenderConfig) {
  const { backendUrl, shopDomain, ingestionKey, isDevMode, consentManager, logger, environment = "live" } = config;
  const log = logger || (() => {});
  if (!backendUrl) {
    if (isDevMode) {
      log("⚠️ BACKEND_URL not configured - event sending disabled. " +
          "Run pnpm ext:inject to inject the backend URL at build time. " +
          "If placeholder was not replaced, pixel extension will silently fail and events will be lost.");
    }
    return async function sendToBackendDisabled(
      _eventName: string,
      _data: Record<string, unknown>
    ): Promise<void> {
    };
  }
  const eventQueue: QueuedEvent[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flushQueue = async (_immediate = false) => {
    if (eventQueue.length === 0) return;
    const eventsToSend = [...eventQueue];
    eventQueue.length = 0;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (eventsToSend.length === 0) return;
    try {
      const timestamp = Date.now();
      const batchPayload = {
        events: eventsToSend.map(event => ({
          eventName: event.eventName,
          timestamp: event.timestamp,
          nonce: event.nonce,
          shopDomain,
          consent: {
            marketing: consentManager.marketingAllowed,
            analytics: consentManager.analyticsAllowed,
            saleOfData: consentManager.saleOfDataAllowed,
          },
          data: {
            ...event.data,
            environment,
          },
        })),
        timestamp,
      };
      const body = JSON.stringify(batchPayload);
      const url = `${backendUrl}/ingest`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Tracking-Guardian-Timestamp": String(timestamp),
      };
      if (ingestionKey) {
        try {
          const bodyHash = sha256Hex(body);
          const signature = generateHMACSignature(ingestionKey, timestamp, shopDomain, bodyHash);
          headers["X-Tracking-Guardian-Signature"] = signature;
          if (isDevMode) {
            log(`Batch HMAC signature generated for ${eventsToSend.length} events`);
          }
        } catch (hmacError) {
          if (isDevMode) {
            log(`❌ Batch HMAC signature generation failed:`, hmacError);
          }
        }
      }
      const hasCheckoutCompleted = eventsToSend.some(e => e.eventName === "checkout_completed");
      if (hasCheckoutCompleted) {
        await sendCheckoutCompletedWithRetry(url, body, isDevMode, log, headers, Date.now());
      } else {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        fetch(url, {
          method: "POST",
          headers,
          keepalive: true,
          body,
          signal: controller.signal,
        })
          .finally(() => clearTimeout(timeoutId))
          .catch((error) => {
            if (isDevMode) {
              log(`Batch send failed (${eventsToSend.length} events):`, error);
            }
          });
      }
      if (isDevMode) {
        log(`Batch sent: ${eventsToSend.length} events to /ingest`);
      }
    } catch (error) {
      if (isDevMode) {
        log("Batch flush error:", error);
      }
    }
  };
  return async function sendToBackend(eventName: string, data: Record<string, unknown>): Promise<void> {
    if (!consentManager.hasAnalyticsConsent() && !consentManager.hasMarketingConsent()) {
      log(
        `Skipping ${eventName} - neither analytics nor marketing consent granted. ` +
        `analytics=${consentManager.analyticsAllowed}, marketing=${consentManager.marketingAllowed}`
      );
      return;
    }
    log(
      `${eventName}: Queuing event with consent state. ` +
      `analytics=${consentManager.analyticsAllowed}, marketing=${consentManager.marketingAllowed}, saleOfData=${consentManager.saleOfDataAllowed}`
    );
    try {
      if (eventName === "checkout_completed") {
        if (eventQueue.length > 0) {
          await flushQueue(true);
        }
        const { timestamp, nonce } = generateNonce();
        eventQueue.push({
          eventName,
          data,
          timestamp,
          nonce,
        });
        await flushQueue(true);
        return;
      }
      const { timestamp, nonce } = generateNonce();
      eventQueue.push({
        eventName,
        data,
        timestamp,
        nonce,
      });
      const shouldFlushImmediate =
        (BATCH_CONFIG.FLUSH_IMMEDIATE_EVENTS as readonly string[]).includes(eventName) ||
        eventQueue.length >= BATCH_CONFIG.MAX_BATCH_SIZE;
      if (shouldFlushImmediate) {
        await flushQueue(true);
      } else {
        if (!flushTimer) {
          flushTimer = setTimeout(() => {
            flushQueue(false);
          }, BATCH_CONFIG.MAX_BATCH_DELAY_MS);
        }
      }
    } catch (error) {
      if (isDevMode) {
        log("Event queue error:", error);
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
    const allItems = checkout.lineItems?.map(item => ({
      id: item.id || item.variant?.id || "",
      name: item.title || "",
      price: toNumber(item.variant?.price?.amount),
      quantity: item.quantity || 1,
      variantId: item.variant?.id || null,
      productId: item.variant?.product?.id || null,
      productTitle: item.variant?.product?.title || null,
    })) || [];
    sendToBackend("checkout_completed", {
      orderId: orderId || null,
      checkoutToken: checkoutToken || null,
      value: toNumber(checkout.totalPrice?.amount),
      currency: checkout.currencyCode || null,
      items: truncateItems(allItems),
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
    const allItems = checkout.lineItems?.map(item => ({
      id: item.id || item.variant?.id || "",
      name: item.title || "",
      price: toNumber(item.variant?.price?.amount),
      quantity: item.quantity || 1,
      variantId: item.variant?.id || null,
      productId: item.variant?.product?.id || null,
      productTitle: item.variant?.product?.title || null,
    })) || [];
    sendToBackend("checkout_started", {
      checkoutToken: checkout.token || null,
      value: toNumber(checkout.totalPrice?.amount),
      currency: checkout.currencyCode || null,
      items: truncateItems(allItems),
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
    const typedEvent = event as { data?: { cartLine?: CartLine; cart?: { currencyCode?: string } } };
    const cartLine = typedEvent.data?.cartLine;
    if (!cartLine) return;
    const price = toNumber(cartLine.merchandise?.price?.amount);
    const quantity = cartLine.quantity || 1;
    const currency = typedEvent.data?.cart?.currencyCode || null;
    const merchandise = cartLine.merchandise;
    const variantId = merchandise?.variant?.id || merchandise?.id || null;
    const productId = merchandise?.product?.id || null;
    const itemId = variantId || productId || "";
    sendToBackend("product_added_to_cart", {
      value: price * quantity,
      currency: currency,
      items: [{
        id: itemId,
        name: cartLine.merchandise?.product?.title || "",
        price: price,
        quantity: quantity,
        variantId: variantId,
        productId: productId,
        productTitle: cartLine.merchandise?.product?.title || null,
      }],
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
    const typedEvent = event as {
      data?: {
        page?: { url?: string; title?: string; currencyCode?: string };
        cart?: { currencyCode?: string };
      }
    };
    const page = typedEvent.data?.page;
    if (!page) return;
    const currency = page.currencyCode || typedEvent.data?.cart?.currencyCode || null;
    sendToBackend("page_viewed", {
      url: page.url || null,
      title: page.title || null,
      value: 0,
      currency: currency,
      items: [],
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
    const typedEvent = event as {
      data?: {
        productVariant?: {
          id?: string;
          product?: { id?: string; title?: string };
          price?: { amount?: string | number; currencyCode?: string };
        };
      };
    };
    const productVariant = typedEvent.data?.productVariant;
    if (!productVariant) return;
    const price = toNumber(productVariant.price?.amount);
    const currency = (productVariant.price as { currencyCode?: string } | undefined)?.currencyCode || null;
    const variantId = productVariant.id || null;
    const productId = productVariant.product?.id || null;
    const itemId = variantId || productId || "";
    sendToBackend("product_viewed", {
      value: price,
      currency: currency,
      items: [{
        id: itemId,
        name: productVariant.product?.title || "",
        price: price,
        quantity: 1,
        variantId: variantId,
        productId: productId,
        productTitle: productVariant.product?.title || null,
      }],
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
    const allItems = checkout.lineItems?.map(item => ({
      id: item.id || item.variant?.id || "",
      name: item.title || "",
      price: toNumber(item.variant?.price?.amount),
      quantity: item.quantity || 1,
      variantId: item.variant?.id || null,
      productId: item.variant?.product?.id || null,
      productTitle: item.variant?.product?.title || null,
    })) || [];
    sendToBackend("checkout_contact_info_submitted", {
      checkoutToken: checkout.token || null,
      value: toNumber(checkout.totalPrice?.amount),
      currency: checkout.currencyCode || null,
      items: truncateItems(allItems),
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
    const allItems = checkout.lineItems?.map(item => ({
      id: item.id || item.variant?.id || "",
      name: item.title || "",
      price: toNumber(item.variant?.price?.amount),
      quantity: item.quantity || 1,
      variantId: item.variant?.id || null,
      productId: item.variant?.product?.id || null,
      productTitle: item.variant?.product?.title || null,
    })) || [];
    sendToBackend("checkout_shipping_info_submitted", {
      checkoutToken: checkout.token || null,
      value: toNumber(checkout.totalPrice?.amount),
      currency: checkout.currencyCode || null,
      items: truncateItems(allItems),
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
    const allItems = checkout.lineItems?.map(item => ({
      id: item.id || item.variant?.id || "",
      name: item.title || "",
      price: toNumber(item.variant?.price?.amount),
      quantity: item.quantity || 1,
      variantId: item.variant?.id || null,
      productId: item.variant?.product?.id || null,
      productTitle: item.variant?.product?.title || null,
    })) || [];
    sendToBackend("payment_info_submitted", {
      checkoutToken: checkout.token || null,
      value: toNumber(checkout.totalPrice?.amount),
      currency: checkout.currencyCode || null,
      items: truncateItems(allItems),
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
  subscribeToCheckoutCompleted(analytics, sendToBackend, logger);
  if (mode === "full_funnel") {
    subscribeToCheckoutStarted(analytics, sendToBackend, logger);
    subscribeToCheckoutContactInfoSubmitted(analytics, sendToBackend, logger);
    subscribeToCheckoutShippingInfoSubmitted(analytics, sendToBackend, logger);
    subscribeToPaymentInfoSubmitted(analytics, sendToBackend, logger);
    subscribeToProductAddedToCart(analytics, sendToBackend, logger);
    subscribeToProductViewed(analytics, sendToBackend, logger);
    subscribeToPageViewed(analytics, sendToBackend, logger);
    const log = logger || (() => {});
    log("Tracking Guardian pixel initialized - full_funnel mode enabled with all standard events");
  }
}
