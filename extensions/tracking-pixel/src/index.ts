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
import { BACKEND_URL, isAllowedBackendUrl } from "../../shared/config";
import { createConsentManager, subscribeToConsentChanges } from "./consent";
import { createEventSender, subscribeToCheckoutCompleted } from "./events";
import type { PixelSettings, PixelInit, CustomerPrivacyState } from "./types";

/**
 * P0-03: Resolve backend URL from settings with allowlist validation.
 * Uses settings.backend_url if provided and allowed, otherwise falls back to BACKEND_URL constant.
 */
function resolveBackendUrl(settingsBackendUrl: string | undefined, log: (...args: unknown[]) => void): string {
  // If settings.backend_url is provided and valid
  if (settingsBackendUrl && typeof settingsBackendUrl === "string" && settingsBackendUrl.length > 0) {
    if (isAllowedBackendUrl(settingsBackendUrl)) {
      log("Using backend_url from settings:", settingsBackendUrl);
      return settingsBackendUrl;
    } else {
      log("Settings backend_url not in allowlist, falling back to default:", settingsBackendUrl);
    }
  }
  
  // Fallback to build-time constant
  return BACKEND_URL;
}

register(({ analytics, settings, init, customerPrivacy }: {
  analytics: { subscribe: (event: string, handler: (event: unknown) => void) => void };
  settings: PixelSettings;
  init: PixelInit;
  customerPrivacy?: { subscribe?: (event: string, handler: (e: unknown) => void) => void };
}) => {
  // Extract configuration
  const ingestionKey = settings.ingestion_key;
  const shopDomain = settings.shop_domain || init.data?.shop?.myshopifyDomain || "";

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

  // P0-03: Resolve backend URL with allowlist validation
  const backendUrl = resolveBackendUrl(settings.backend_url, log);

  if (isDevMode) {
    log("Development mode enabled", {
      shopDomain,
      hasIngestionKey: !!ingestionKey,
      backendUrl,
      settingsBackendUrl: settings.backend_url,
      schemaVersion: settings.schema_version,
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

  // P0-02: Subscribe ONLY to checkout_completed
  subscribeToCheckoutCompleted(analytics, sendToBackend, log);
});
