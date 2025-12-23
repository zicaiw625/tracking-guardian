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
 * P1-02: Send event using sendBeacon (preferred) with fetch keepalive fallback.
 * This ensures checkout_completed events are reliably sent even when page unloads.
 */
function sendWithBeaconFallback(
  url: string,
  body: string,
  headers: Record<string, string>,
  isDevMode: boolean,
  log: (...args: unknown[]) => void
): void {
  // P1-02: Try sendBeacon first for checkout_completed (most reliable during page unload)
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    try {
      // sendBeacon with Blob allows setting Content-Type
      const blob = new Blob([body], { type: "application/json" });
      const sent = navigator.sendBeacon(url, blob);
      if (sent) {
        if (isDevMode) {
          log("checkout_completed sent via sendBeacon");
        }
        return;
      }
      // sendBeacon returned false (queue full), fall through to fetch
      if (isDevMode) {
        log("sendBeacon returned false, falling back to fetch");
      }
    } catch (e) {
      if (isDevMode) {
        log("sendBeacon failed, falling back to fetch:", e);
      }
    }
  }

  // P1-02: Fallback to fetch with keepalive
  fetch(url, {
    method: "POST",
    headers,
    keepalive: true,
    body,
  })
    .then((response) => {
      if (isDevMode) {
        log(`checkout_completed sent via fetch, status: ${response.status}`);
      }
    })
    .catch((error) => {
      if (isDevMode) {
        log("checkout_completed fetch failed:", error);
      }
    });
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
      
      // P1-03: Minimal payload - only essential fields for matching and consent
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

      const url = `${backendUrl}/api/pixel-events`;

      // P1-02: Use sendBeacon + fetch keepalive for checkout_completed
      if (eventName === "checkout_completed") {
        sendWithBeaconFallback(url, body, headers, isDevMode, log);
      } else {
        // For any other events (should not happen after P0-02), use regular fetch
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

