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

function mapCheckoutLineItems(checkout: CheckoutData): Array<{ id: string; quantity: number; price: number }> {
  const allItems = checkout.lineItems?.map(item => ({
    id: item.id || item.variant?.id || "",
    name: item.title || "",
    price: toNumber(item.variant?.price?.amount),
    quantity: item.quantity || 1,
    variantId: item.variant?.id || null,
    productId: item.variant?.product?.id || null,
    productTitle: item.variant?.product?.title || null,
  })) ?? [];
  return truncateItems(allItems);
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
  token: string,
  timestamp: number,
  shopDomain: string,
  bodyHash: string
): string {
  const message = `${timestamp}:${shopDomain}:${bodyHash}`;
  return bytesToHex(hmac(sha256, utf8ToBytes(token), utf8ToBytes(message)));
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
  const canAbort = typeof AbortController !== "undefined";
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let controller: InstanceType<typeof AbortController> | null = null;
    if (canAbort) {
      controller = new AbortController();
      timeoutId = setTimeout(() => controller!.abort(), REQUEST_TIMEOUT_MS);
    }
    try {
      const fetchOpts: RequestInit = {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        keepalive: true,
        body,
        ...(controller ? { signal: controller.signal } : {}),
      };
      const response = await fetch(url, fetchOpts);
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
      if (canAbort && timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    }
  }
}

const BATCH_CONFIG = {
  MAX_BATCH_SIZE: 10,
  MAX_BATCH_DELAY_MS: 1000,
  MAX_BATCH_BYTES: 60 * 1024,
  FLUSH_IMMEDIATE_EVENTS: ["checkout_completed"],
} as const;

interface QueuedEvent {
  eventName: string;
  data: Record<string, unknown>;
  timestamp: number;
  nonce: string;
}

let cryptoUnavailableWarningLogged = false;

function generateNonce(
  isDevMode: boolean,
  log: (...args: unknown[]) => void
): { timestamp: number; nonce: string; cryptoAvailable: boolean } {
  const timestamp = Date.now();
  let randomHex = "";
  let cryptoAvailable = false;
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    try {
      const randomBytes = new Uint8Array(6);
      globalThis.crypto.getRandomValues(randomBytes);
      randomHex = Array.from(randomBytes)
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
      cryptoAvailable = true;
    } catch (error) {
      if (!cryptoUnavailableWarningLogged) {
        if (isDevMode) {
          log("Crypto.getRandomValues() failed, falling back to Math.random(). Replay protection may be disabled.", error);
        }
        cryptoUnavailableWarningLogged = true;
      }
    }
  }
  if (!randomHex) {
    if (!cryptoUnavailableWarningLogged) {
      if (isDevMode) {
        log("Crypto API not available, using Math.random(). Replay protection disabled.");
      }
      cryptoUnavailableWarningLogged = true;
    }
    randomHex = Array.from({ length: 3 }, () => Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, "0"))
      .join("");
  }
  return { timestamp, nonce: `${timestamp}-${randomHex}`, cryptoAvailable };
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
  const normalizedIngestionKey =
    typeof ingestionKey === "string" ? ingestionKey.trim() : "";
  if (!normalizedIngestionKey && !isDevMode) {
    return async function sendToBackendDisabled(
      _eventName: string,
      _data: Record<string, unknown>
    ): Promise<void> {
    };
  }
  const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  const utf8Length = (s: string): number => {
    if (encoder) return encoder.encode(s).length;
    return utf8ToBytes(s).length;
  };
  const buildEventPayload = (event: QueuedEvent): Record<string, unknown> => ({
    eventName: event.eventName,
    timestamp: event.timestamp,
    nonce: event.nonce,
    shopDomain,
    consent: {
      marketing: consentManager.marketingAllowed,
      analytics: consentManager.analyticsAllowed,
      saleOfDataAllowed: consentManager.saleOfDataAllowed,
    },
    data: {
      ...event.data,
      environment,
    },
  });
  const buildBatchBody = (events: QueuedEvent[], batchTimestamp: number): string => {
    const batchPayload = {
      events: events.map(buildEventPayload),
      timestamp: batchTimestamp,
    };
    return JSON.stringify(batchPayload);
  };
  const fitSingleEventToBytes = (event: QueuedEvent, maxBytes: number): QueuedEvent => {
    const baseTimestamp = Date.now();
    const initialBody = buildBatchBody([event], baseTimestamp);
    if (utf8Length(initialBody) <= maxBytes) {
      return event;
    }
    const data = event.data as Record<string, unknown>;
    const items = data.items;
    if (!Array.isArray(items) || items.length === 0) {
      return event;
    }
    let low = 0;
    let high = items.length;
    let best = 0;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate: QueuedEvent = {
        ...event,
        data: {
          ...data,
          items: items.slice(0, mid),
        },
      };
      const body = buildBatchBody([candidate], baseTimestamp);
      if (utf8Length(body) <= maxBytes) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (best === items.length) {
      return event;
    }
    return {
      ...event,
      data: {
        ...data,
        items: items.slice(0, best),
      },
    };
  };
  const splitIntoBatches = (events: QueuedEvent[], batchTimestamp: number): QueuedEvent[][] => {
    const batches: QueuedEvent[][] = [];
    let current: QueuedEvent[] = [];
    for (const e of events) {
      const candidate = [...current, e];
      const body = buildBatchBody(candidate, batchTimestamp);
      if (utf8Length(body) <= BATCH_CONFIG.MAX_BATCH_BYTES) {
        current = candidate;
        continue;
      }
      if (current.length > 0) {
        batches.push(current);
        current = [];
      }
      const fitted = fitSingleEventToBytes(e, BATCH_CONFIG.MAX_BATCH_BYTES);
      current = [fitted];
      const singleBody = buildBatchBody(current, batchTimestamp);
      if (utf8Length(singleBody) > BATCH_CONFIG.MAX_BATCH_BYTES) {
        batches.push(current);
        current = [];
      }
    }
    if (current.length > 0) {
      batches.push(current);
    }
    return batches;
  };
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
      const url = `${backendUrl}/ingest`;
      const batches = splitIntoBatches(eventsToSend, timestamp);
      for (const batchEvents of batches) {
        const body = buildBatchBody(batchEvents, timestamp);
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Tracking-Guardian-Timestamp": String(timestamp),
        };
        if (normalizedIngestionKey) {
          try {
            const bodyHash = sha256Hex(body);
            const signature = generateHMACSignature(normalizedIngestionKey, timestamp, shopDomain, bodyHash);
            headers["X-Tracking-Guardian-Signature"] = signature;
            if (isDevMode) {
              log(`Batch HMAC signature generated for ${batchEvents.length} events`);
            }
          } catch (hmacError) {
            if (isDevMode) {
              log(`❌ Batch HMAC signature generation failed:`, hmacError);
            }
          }
        }
        const hasCheckoutCompleted = batchEvents.some(e => e.eventName === "checkout_completed");
        if (hasCheckoutCompleted) {
          await sendCheckoutCompletedWithRetry(url, body, isDevMode, log, headers, Date.now());
        } else {
          const canAbort = typeof AbortController !== "undefined";
          if (canAbort) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
            fetch(url, {
              method: "POST",
              headers,
              keepalive: true,
              body,
              signal: controller.signal,
            })
              .then((response) => {
                if (!response.ok && isDevMode) {
                  log(`Batch send non-2xx (${batchEvents.length} events): ${response.status}`);
                }
                return response;
              })
              .finally(() => clearTimeout(timeoutId))
              .catch((error) => {
                if (isDevMode) {
                  log(`Batch send failed (${batchEvents.length} events):`, error);
                }
              });
          } else {
            fetch(url, {
              method: "POST",
              headers,
              keepalive: true,
              body,
            })
              .then((response) => {
                if (!response.ok && isDevMode) {
                  log(`Batch send non-2xx (${batchEvents.length} events): ${response.status}`);
                }
                return response;
              })
              .catch((error) => {
                if (isDevMode) {
                  log(`Batch send failed (${batchEvents.length} events):`, error);
                }
              });
          }
        }
        if (isDevMode) {
          log(`Batch sent: ${batchEvents.length} events to /ingest (bytes=${utf8Length(body)})`);
        }
      }
    } catch (error) {
      if (isDevMode) {
        log("Batch flush error:", error);
      }
    }
  };
  const getRequiredConsentForEvent = (eventName: string): "analytics" | "marketing" | "either" => {
    if (eventName === "checkout_completed") {
      return "analytics";
    }
    if (eventName === "page_viewed" || eventName === "product_viewed" || eventName === "product_added_to_cart") {
      return "analytics";
    }
    if (eventName === "checkout_started" || eventName === "checkout_contact_info_submitted" || eventName === "checkout_shipping_info_submitted" || eventName === "payment_info_submitted") {
      return "analytics";
    }
    return "either";
  };
  return async function sendToBackend(eventName: string, data: Record<string, unknown>): Promise<void> {
    const requiredConsent = getRequiredConsentForEvent(eventName);
    let hasRequiredConsent = false;
    if (requiredConsent === "marketing") {
      hasRequiredConsent = consentManager.hasMarketingConsent();
    } else if (requiredConsent === "analytics") {
      hasRequiredConsent = consentManager.hasAnalyticsConsent();
    } else {
      hasRequiredConsent = consentManager.hasAnalyticsConsent() || consentManager.hasMarketingConsent();
    }
    if (!hasRequiredConsent) {
      log(
        `Skipping ${eventName} - required consent (${requiredConsent}) not granted. ` +
        `analytics=${consentManager.analyticsAllowed}, marketing=${consentManager.marketingAllowed}`
      );
      return;
    }
    log(
      `${eventName}: Queuing event with consent state. ` +
      `analytics=${consentManager.analyticsAllowed}, marketing=${consentManager.marketingAllowed}, saleOfData=${consentManager.saleOfDataAllowed}, required=${requiredConsent}`
    );
    try {
      if (eventName === "checkout_completed") {
        if (eventQueue.length > 0) {
          await flushQueue(true);
        }
        const { timestamp, nonce, cryptoAvailable } = generateNonce(isDevMode, log);
        if (!cryptoAvailable && isDevMode) {
          log("Warning: Nonce generated without crypto API. Replay protection may be disabled.");
        }
        eventQueue.push({
          eventName,
          data,
          timestamp,
          nonce,
        });
        await flushQueue(true);
        return;
      }
      const { timestamp, nonce, cryptoAvailable: cryptoAvailable2 } = generateNonce(isDevMode, log);
      if (!cryptoAvailable2 && isDevMode) {
        log("Warning: Nonce generated without crypto API. Replay protection may be disabled.");
      }
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
    sendToBackend("checkout_completed", {
      orderId: orderId || null,
      checkoutToken: checkoutToken || null,
      value: toNumber(checkout.totalPrice?.amount),
      currency: checkout.currencyCode || null,
      items: mapCheckoutLineItems(checkout),
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
      currency: checkout.currencyCode || null,
      items: mapCheckoutLineItems(checkout),
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
    sendToBackend("checkout_contact_info_submitted", {
      checkoutToken: checkout.token || null,
      value: toNumber(checkout.totalPrice?.amount),
      currency: checkout.currencyCode || null,
      items: mapCheckoutLineItems(checkout),
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
      currency: checkout.currencyCode || null,
      items: mapCheckoutLineItems(checkout),
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
      currency: checkout.currencyCode || null,
      items: mapCheckoutLineItems(checkout),
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
