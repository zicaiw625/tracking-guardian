

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

async function generateHMACSignature(
  secret: string,
  timestamp: number,
  bodyHash: string
): Promise<string> {

  const message = `${timestamp}:${bodyHash}`;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);

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
      // P0-1: 使用 PRD 定义的 /ingest 端点（而非 /api/pixel-events）
      // /ingest 是 PRD 中定义的主要端点，/api/pixel-events 作为内部实现端点
      const url = `${backendUrl}/ingest`;

      const headers: Record<string, string> = {
        "Content-Type": "text/plain;charset=UTF-8",
        "X-Tracking-Guardian-Timestamp": String(timestamp),
      };

      if (!ingestionKey) {
        if (isDevMode) {
          log(`⚠️ Missing ingestionKey - HMAC signature cannot be generated. Event will be rejected in production.`);
        }

      } else {
        try {

          const bodyHashBuffer = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(body)
          );
          const bodyHash = Array.from(new Uint8Array(bodyHashBuffer))
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");

          const signature = await generateHMACSignature(ingestionKey, timestamp, bodyHash);
          headers["X-Tracking-Guardian-Signature"] = signature;

          if (isDevMode) {
            log(`HMAC signature generated successfully for ${eventName}`);
          }
        } catch (hmacError) {

          if (isDevMode) {
            log(`❌ HMAC signature generation failed:`, hmacError);
            log(`Event ${eventName} will be rejected by server in production without valid signature`);
          }

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
      currency: checkout.currencyCode || null,
      items: checkout.lineItems?.map(item => ({
        id: item.id || "", // checkout.lineItems 的 id 通常是 variant_id
        name: item.title || "",
        price: toNumber(item.variant?.price?.amount),
        quantity: item.quantity || 1,
        variantId: item.id || null, // 明确标记 variantId
        productId: item.variant?.product?.id || null,
        productTitle: item.variant?.product?.title || null,
      })) || [],
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
      items: checkout.lineItems?.map(item => ({
        id: item.id || "", // checkout.lineItems 的 id 通常是 variant_id
        name: item.title || "",
        price: toNumber(item.variant?.price?.amount),
        quantity: item.quantity || 1,
        variantId: item.id || null, // 明确标记 variantId
        productId: item.variant?.product?.id || null,
        productTitle: item.variant?.product?.title || null,
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
    const typedEvent = event as { data?: { cartLine?: CartLine; cart?: { currencyCode?: string } } };
    const cartLine = typedEvent.data?.cartLine;
    if (!cartLine) return;

    const price = toNumber(cartLine.merchandise?.price?.amount);
    const quantity = cartLine.quantity || 1;
    const currency = typedEvent.data?.cart?.currencyCode || null;

    // 统一为 value/currency/items[] 格式
    // items[].id 优先使用 variantId（与 checkout 事件保持一致），如果没有则使用 productId
    // 注意：cartLine.merchandise 可能包含 variant 信息，但类型定义可能不完整
    const merchandise = cartLine.merchandise as { id?: string; variant?: { id?: string }; product?: { id?: string; title?: string } } | undefined;
    const variantId = merchandise?.variant?.id || merchandise?.id || null;
    const productId = merchandise?.product?.id || null;
    const itemId = variantId || productId || "";

    sendToBackend("product_added_to_cart", {
      value: price * quantity,
      currency: currency,
      items: [{
        id: itemId, // 统一使用 variantId 优先，如果没有则使用 productId
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

    // 统一为 value/currency/items[] 格式（page_viewed 事件 value 为 0，items 为空数组）
    // 注意：page_viewed 事件可能没有 currency，但为了保持一致性，我们尝试从页面或购物车获取
    // 如果确实没有，后端会使用 USD 作为后备（这是合理的，因为 page_viewed 事件不需要货币信息）
    const currency = page.currencyCode || typedEvent.data?.cart?.currencyCode || null;

    sendToBackend("page_viewed", {
      url: page.url || null,
      title: page.title || null,
      value: 0, // page_viewed 事件没有交易价值
      currency: currency, // 从页面或购物车获取货币代码（可能为 null，后端会处理）
      items: [], // page_viewed 事件没有商品信息
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
          id?: string; // variant id
          product?: { id?: string; title?: string }; 
          price?: { amount?: string | number; currencyCode?: string };
        };
      };
    };
    const productVariant = typedEvent.data?.productVariant;
    if (!productVariant) return;

    const price = toNumber(productVariant.price?.amount);
    const currency = (productVariant.price as { currencyCode?: string } | undefined)?.currencyCode || null;

    // 统一为 value/currency/items[] 格式
    // items[].id 优先使用 variantId（与 checkout 事件保持一致），如果没有则使用 productId
    const variantId = productVariant.id || null;
    const productId = productVariant.product?.id || null;
    const itemId = variantId || productId || "";

    sendToBackend("product_viewed", {
      value: price,
      currency: currency,
      items: [{
        id: itemId, // 统一使用 variantId 优先，如果没有则使用 productId
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
      items: checkout.lineItems?.map(item => ({
        id: item.id || "", // checkout.lineItems 的 id 通常是 variant_id
        name: item.title || "",
        price: toNumber(item.variant?.price?.amount),
        quantity: item.quantity || 1,
        variantId: item.id || null, // 明确标记 variantId
        productId: item.variant?.product?.id || null,
        productTitle: item.variant?.product?.title || null,
      })) || [],
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
      items: checkout.lineItems?.map(item => ({
        id: item.id || "", // checkout.lineItems 的 id 通常是 variant_id
        name: item.title || "",
        price: toNumber(item.variant?.price?.amount),
        quantity: item.quantity || 1,
        variantId: item.id || null, // 明确标记 variantId
        productId: item.variant?.product?.id || null,
        productTitle: item.variant?.product?.title || null,
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
      currency: checkout.currencyCode || null,
      items: checkout.lineItems?.map(item => ({
        id: item.id || "", // checkout.lineItems 的 id 通常是 variant_id
        name: item.title || "",
        price: toNumber(item.variant?.price?.amount),
        quantity: item.quantity || 1,
        variantId: item.id || null, // 明确标记 variantId
        productId: item.variant?.product?.id || null,
        productTitle: item.variant?.product?.title || null,
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
  mode: "purchase_only" | "full_funnel" = "purchase_only" // v1 默认 purchase_only，符合隐私最小化原则
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

