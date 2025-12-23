/**
 * Tracking Guardian Web Pixel Extension
 * 
 * P0-02: Entry point for the Shopify Web Pixel that captures ONLY checkout_completed events
 * and sends them to the backend for server-side conversion tracking.
 * 
 * COMPLIANCE: This pixel ONLY subscribes to checkout_completed.
 * See COMPLIANCE.md for details.
 */

import { register } from "@shopify/web-pixels-extension";
import { BACKEND_URL } from "../../shared/config";
import { createConsentManager, subscribeToConsentChanges } from "./consent";
import { createEventSender, subscribeToCheckoutCompleted } from "./events";
import type { PixelSettings, PixelInit, CustomerPrivacyState } from "./types";

register(({ analytics, settings, init, customerPrivacy }: {
  analytics: { subscribe: (event: string, handler: (event: unknown) => void) => void };
  settings: PixelSettings;
  init: PixelInit;
  customerPrivacy?: { subscribe?: (event: string, handler: (e: unknown) => void) => void };
}) => {
  // Extract configuration from settings (matches shopify.extension.toml schema)
  const ingestionKey = settings.ingestion_key;
  const shopDomain = settings.shop_domain || init.data?.shop?.myshopifyDomain || "";

  // Backend URL is a build-time constant, NOT from settings
  // This is intentional: we don't want merchants to configure arbitrary backend URLs
  const backendUrl = BACKEND_URL;

  // Detect development mode
  const isDevMode = (() => {
    if (shopDomain.includes(".myshopify.dev") || /-(dev|staging|test)\./i.test(shopDomain)) {
      return true;
    }
    return false;
  })();

  // Create logger (only logs in dev mode)
  function log(...args: unknown[]): void {
    if (isDevMode) {
      console.log("[Tracking Guardian]", ...args);
    }
  }

  if (isDevMode) {
    log("Development mode enabled", {
      shopDomain,
      hasIngestionKey: !!ingestionKey,
      backendUrl,
    });
  }

  // Initialize consent manager with P0-04 strict defaults (all false)
  const consentManager = createConsentManager(log);
  consentManager.updateFromStatus(init.customerPrivacy as CustomerPrivacyState | undefined, "init");

  // Subscribe to consent changes
  if (customerPrivacy) {
    subscribeToConsentChanges(customerPrivacy, consentManager, log);
  }

  // Create event sender
  const sendToBackend = createEventSender({
    backendUrl,
    shopDomain,
    ingestionKey,
    isDevMode,
    consentManager,
    logger: log,
  });

  // P0-02: Subscribe ONLY to checkout_completed
  subscribeToCheckoutCompleted(analytics, sendToBackend, log);
});
