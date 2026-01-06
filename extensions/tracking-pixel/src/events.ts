

import type { CheckoutData, CartLine } from "./types";
import type { ConsentManager } from "./consent";
// P0: 使用 @noble/hashes 替代 WebCrypto API，避免 strict sandbox 环境下的全局对象依赖
// strict sandbox 只保证 self/console/timers/fetch，不保证 crypto.subtle/TextEncoder/btoa
import { sha256 } from "@noble/hashes/sha256";
import { hmac } from "@noble/hashes/hmac";
import { utf8ToBytes, bytesToHex } from "@noble/hashes/utils";

export function toNumber(value: string | number | undefined | null, defaultValue = 0): number {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "number") return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

export interface EventSenderConfig {

  backendUrl: string | null;
  shopDomain: string;
  // P0-4: ingestionSecret 仅用于生成 HMAC 签名，不会出现在请求体中
  // 服务端通过 shopDomain 查找 shop.ingestionSecret 进行验证
  ingestionSecret?: string;
  isDevMode: boolean;
  consentManager: ConsentManager;
  logger?: (...args: unknown[]) => void;
  // P0-4: 环境（test 或 live），用于后端按环境过滤配置
  environment?: "test" | "live";
}

/**
 * P0: 使用 @noble/hashes 生成 HMAC 签名（hex 格式）
 * 
 * 原因：Shopify Web Pixel strict sandbox 环境不保证 WebCrypto API、
 * TextEncoder、btoa 等全局对象存在，可能导致签名生成失败。
 * 
 * @noble/hashes 是纯 JS 实现，零全局依赖，完全兼容 strict sandbox。
 * 使用 hex 格式而非 base64，避免需要 btoa。
 */
function generateHMACSignature(
  secret: string,
  timestamp: number,
  bodyHash: string
): string {
  const message = `${timestamp}:${bodyHash}`;
  // 使用 @noble/hashes 的 hmac 函数，返回 hex 格式
  return bytesToHex(hmac(sha256, utf8ToBytes(secret), utf8ToBytes(message)));
}

/**
 * P0: 使用 @noble/hashes 生成 SHA-256 哈希（hex 格式）
 * 
 * 替代 crypto.subtle.digest，避免 strict sandbox 环境下的全局对象依赖。
 */
function sha256Hex(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input)));
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

// P0-1: PRD 对齐 - 批量事件队列配置
// PRD 8.2 要求：POST /ingest 支持批量事件格式 { events: [...] }
// 此配置用于在客户端批量收集事件，然后一次性发送到 /ingest 端点
// 符合 PRD 的性能目标（减少网络请求数，提高并发处理能力）
const BATCH_CONFIG = {
  MAX_BATCH_SIZE: 10, // 最大批量大小
  MAX_BATCH_DELAY_MS: 1000, // 最大延迟（毫秒）
  FLUSH_IMMEDIATE_EVENTS: ["checkout_completed"], // 立即发送的事件类型
} as const;

interface QueuedEvent {
  eventName: string;
  data: Record<string, unknown>;
  timestamp: number;
  nonce: string;
}

export function createEventSender(config: EventSenderConfig) {
  const { backendUrl, shopDomain, ingestionSecret, isDevMode, consentManager, logger, environment = "live" } = config;
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

  // P0-1: PRD 对齐 - 批量事件队列
  const eventQueue: QueuedEvent[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flushQueue = async (immediate = false) => {
    if (eventQueue.length === 0) return;

    const eventsToSend = [...eventQueue];
    eventQueue.length = 0; // 清空队列

    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    if (eventsToSend.length === 0) return;

    try {
      const timestamp = Date.now();
      
      // P0-1: PRD 要求的批量格式：{ events: [...] }
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
        timestamp, // 批量请求的时间戳（用于HMAC验证）
      };

      const body = JSON.stringify(batchPayload);
      // P0-1: PRD 对齐 - 使用 /ingest 批量接口（符合 PRD 8.2 要求）
      // PRD 8.2 要求：POST /ingest, Body: { events: [...] } (批量)
      // 此实现完全符合 PRD 规范，支持批量事件发送，提高性能
      const url = `${backendUrl}/ingest`;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Tracking-Guardian-Timestamp": String(timestamp),
      };

      // P0-1: 生成批量请求的 HMAC 签名
      if (ingestionSecret) {
        try {
          const bodyHash = sha256Hex(body);
          const signature = generateHMACSignature(ingestionSecret, timestamp, bodyHash);
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

      // 对于 checkout_completed 事件，使用重试机制
      const hasCheckoutCompleted = eventsToSend.some(e => e.eventName === "checkout_completed");
      
      if (hasCheckoutCompleted && !immediate) {
        sendCheckoutCompletedWithRetry(url, body, isDevMode, log, 0, headers);
      } else {
        fetch(url, {
          method: "POST",
          headers,
          keepalive: true,
          body,
        }).catch((error) => {
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
    const hasAnyConsent = consentManager.hasAnalyticsConsent() || consentManager.hasMarketingConsent();

    if (!hasAnyConsent) {
      log(
        `Skipping ${eventName} - no consent at all. ` +
        `analytics=${consentManager.analyticsAllowed}, marketing=${consentManager.marketingAllowed}`
      );
      return;
    }

    log(
      `${eventName}: Queuing event with consent state. ` +
      `analytics=${consentManager.analyticsAllowed}, marketing=${consentManager.marketingAllowed}, saleOfData=${consentManager.saleOfDataAllowed}`
    );

    try {
      const timestamp = Date.now();
      const nonce = `${timestamp}-${Math.random().toString(36).substring(2, 10)}`;

      // 添加到队列
      eventQueue.push({
        eventName,
        data,
        timestamp,
        nonce,
      });

      // P0-1: 立即发送的事件（如 checkout_completed）或队列已满时立即刷新
      const shouldFlushImmediate = 
        BATCH_CONFIG.FLUSH_IMMEDIATE_EVENTS.includes(eventName) ||
        eventQueue.length >= BATCH_CONFIG.MAX_BATCH_SIZE;

      if (shouldFlushImmediate) {
        await flushQueue(true);
      } else {
        // 设置延迟刷新（如果还没有设置）
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

