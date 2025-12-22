/**
 * Tracking Guardian Web Pixel Extension
 * 
 * Entry point for the Shopify Web Pixel that captures checkout events
 * and sends them to the backend for server-side conversion tracking.
 */

import { register } from "@shopify/web-pixels-extension";
import { BACKEND_URL } from "../../shared/config";
import { createConsentManager, subscribeToConsentChanges } from "./consent";
import { createEventSender, subscribeToAnalyticsEvents } from "./events";
import type { PixelSettings, PixelInit, CustomerPrivacyState } from "./types";

register(({ analytics, settings, init, customerPrivacy }: {
  analytics: { subscribe: (event: string, handler: (event: any) => void) => void };
  settings: PixelSettings;
  init: PixelInit;
  customerPrivacy?: { subscribe?: (event: string, handler: (e: any) => void) => void };
}) => {
  // Extract configuration
  const ingestionKey = settings.ingestion_key;
  const shopDomain = settings.shop_domain || init.data?.shop?.myshopifyDomain || "";
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

  // Initialize consent manager
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

  // Subscribe to analytics events
  subscribeToAnalyticsEvents(analytics, sendToBackend, log);
});
