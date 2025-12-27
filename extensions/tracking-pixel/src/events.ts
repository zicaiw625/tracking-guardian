

import type { CheckoutData } from "./types";
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

const RETRY_DELAYS_MS = [0, 300, 1200];
const MAX_RETRIES = RETRY_DELAYS_MS.length;

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

      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
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

      if (eventName === "checkout_completed") {
        sendCheckoutCompletedWithRetry(url, body, isDevMode, log);
      } else {

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

  log("Tracking Guardian pixel initialized - checkout_completed only (P0-02 compliant)");
}

export function subscribeToAnalyticsEvents(
  analytics: {
    subscribe: (event: string, handler: (event: unknown) => void) => void;
  },
  sendToBackend: (eventName: string, data: Record<string, unknown>) => Promise<void>,
  logger?: (...args: unknown[]) => void
): void {

  subscribeToCheckoutCompleted(analytics, sendToBackend, logger);
}

