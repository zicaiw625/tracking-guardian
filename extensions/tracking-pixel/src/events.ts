/**
 * Event Handling Module
 * 
 * P0-02: Handles sending ONLY checkout_completed events to the backend.
 * 
 * COMPLIANCE: This module ONLY subscribes to checkout_completed.
 * - NO page_viewed events are collected or sent
 * - NO product_added_to_cart events are collected or sent
 * - NO checkout_started/funnel events are collected or sent
 * 
 * See COMPLIANCE.md for details.
 */

import type { CheckoutData } from "./types";
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

export interface EventSenderConfig {
  backendUrl: string;
  shopDomain: string;
  ingestionKey?: string;
  isDevMode: boolean;
  consentManager: ConsentManager;
  logger?: (...args: unknown[]) => void;
}

/**
 * Retry configuration for checkout_completed events.
 * Short delays to maximize chance of delivery before page unload.
 */
const RETRY_DELAYS_MS = [0, 300, 1200];
const MAX_RETRIES = RETRY_DELAYS_MS.length;

/**
 * P0.1: Send checkout_completed event with retry mechanism.
 * 
 * Uses text/plain Content-Type to avoid CORS preflight.
 * Authentication moved to body (no custom headers).
 * Retries on network failure with exponential backoff.
 */
async function sendCheckoutCompletedWithRetry(
  url: string,
  body: string,
  isDevMode: boolean,
  log: (...args: unknown[]) => void,
  retryIndex = 0
): Promise<void> {
  try {
    const response = await fetch(url, {
      method: "POST",
      // P0.1: Use text/plain to avoid CORS preflight (simple request)
      // No custom headers - all auth data is in the body
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
      },
      // keepalive ensures the request survives page unload
      keepalive: true,
      body,
    });

    if (isDevMode) {
      log(`checkout_completed sent, status: ${response.status}, attempt: ${retryIndex + 1}`);
    }

    // 2xx = success, 4xx = client error (don't retry), 5xx = server error (retry)
    if (response.ok || (response.status >= 400 && response.status < 500)) {
      return;
    }

    // Server error - retry if we have attempts left
    if (retryIndex < MAX_RETRIES - 1) {
      const delay = RETRY_DELAYS_MS[retryIndex + 1];
      if (isDevMode) {
        log(`checkout_completed server error, retrying in ${delay}ms`);
      }
      setTimeout(() => {
        sendCheckoutCompletedWithRetry(url, body, isDevMode, log, retryIndex + 1);
      }, delay);
    }
  } catch (error) {
    // Network error - retry if we have attempts left
    if (retryIndex < MAX_RETRIES - 1) {
      const delay = RETRY_DELAYS_MS[retryIndex + 1];
      if (isDevMode) {
        log(`checkout_completed network error, retrying in ${delay}ms:`, error);
      }
      setTimeout(() => {
        sendCheckoutCompletedWithRetry(url, body, isDevMode, log, retryIndex + 1);
      }, delay);
    } else if (isDevMode) {
      log(`checkout_completed failed after ${MAX_RETRIES} attempts:`, error);
    }
  }
}

/**
 * Create an event sender function.
 */
export function createEventSender(config: EventSenderConfig) {
  const { backendUrl, shopDomain, ingestionKey, isDevMode, consentManager, logger } = config;
  const log = logger || (() => {});

  return async function sendToBackend(eventName: string, data: Record<string, unknown>): Promise<void> {
    // P0-02: Only checkout_completed is sent, but we still check consent
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
      // Generate a simple nonce for replay protection
      const nonce = `${timestamp}-${Math.random().toString(36).substring(2, 10)}`;
      
      // P0.1: All auth/tracking data in body (no custom headers)
      // This avoids CORS preflight for maximum delivery reliability
      const payload = {
        eventName,
        timestamp,
        nonce,
        shopDomain,
        // P0.1: ingestionKey moved to body (was in header)
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

      // P0.1: Use unified fetch path with retry for checkout_completed
      // No sendBeacon fallback (unreliable in strict sandbox, can't set headers)
      if (eventName === "checkout_completed") {
        sendCheckoutCompletedWithRetry(url, body, isDevMode, log);
      } else {
        // For any other events (should not happen after P0-02), use regular fetch
        fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "text/plain;charset=UTF-8",
          },
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

/**
 * P0-02: Subscribe ONLY to checkout_completed event.
 * 
 * COMPLIANCE: This is the ONLY event we subscribe to.
 * All other events (page_viewed, product_added_to_cart, checkout_started, etc.)
 * are NOT subscribed to, NOT collected, and NOT sent to the backend.
 * 
 * The backend (api.pixel-events.tsx) also enforces this by only accepting
 * checkout_completed in PRIMARY_EVENTS, returning 204 for anything else.
 */
export function subscribeToCheckoutCompleted(
  analytics: {
    subscribe: (event: string, handler: (event: unknown) => void) => void;
  },
  sendToBackend: (eventName: string, data: Record<string, unknown>) => Promise<void>,
  logger?: (...args: unknown[]) => void
): void {
  const log = logger || (() => {});

  // P0-02: ONLY subscribe to checkout_completed
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

    // P1-03: Minimal payload - only fields needed for matching and basic attribution
    // Order value/items details come from webhook (ORDERS_PAID), not pixel
    sendToBackend("checkout_completed", {
      orderId: orderId || null,
      checkoutToken: checkoutToken || null,
      // P1-03: Basic value for receipt, detailed data from webhook
      value: toNumber(checkout.totalPrice?.amount),
      currency: checkout.currencyCode || "USD",
    });
  });

  log("Tracking Guardian pixel initialized - checkout_completed only (P0-02 compliant)");
}

/**
 * @deprecated P0-02: Use subscribeToCheckoutCompleted instead.
 * This function is kept for backward compatibility but should not be used.
 */
export function subscribeToAnalyticsEvents(
  analytics: {
    subscribe: (event: string, handler: (event: unknown) => void) => void;
  },
  sendToBackend: (eventName: string, data: Record<string, unknown>) => Promise<void>,
  logger?: (...args: unknown[]) => void
): void {
  // P0-02: Redirect to minimal subscription
  subscribeToCheckoutCompleted(analytics, sendToBackend, logger);
}

