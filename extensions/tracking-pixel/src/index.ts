

import { register } from "@shopify/web-pixels-extension";
import { BACKEND_URL, isAllowedBackendUrl } from "../../shared/config";
import { createConsentManager, subscribeToConsentChanges } from "./consent";
import { createEventSender, subscribeToAnalyticsEvents } from "./events";
import { parsePixelConfig } from "./types";
import type { PixelSettings, PixelInit, CustomerPrivacyState } from "./types";

register(({ analytics, settings, init, customerPrivacy }: {
  analytics: { subscribe: (event: string, handler: (event: unknown) => void) => void };
  settings: PixelSettings;
  init: PixelInit;
  customerPrivacy?: { subscribe?: (event: string, handler: (e: unknown) => void) => void };
}) => {

  const ingestionKey = settings.ingestion_key;
  const shopDomain = settings.shop_domain || init.data?.shop?.myshopifyDomain || "";

  const backendUrl = BACKEND_URL && isAllowedBackendUrl(BACKEND_URL) ? BACKEND_URL : null;

  const isDevMode = (() => {
    if (shopDomain.includes(".myshopify.dev") || /-(dev|staging|test)\./i.test(shopDomain)) {
      return true;
    }
    return false;
  })();

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

  const consentManager = createConsentManager(log);
  consentManager.updateFromStatus(init.customerPrivacy as CustomerPrivacyState | undefined, "init");

  if (customerPrivacy) {
    subscribeToConsentChanges(customerPrivacy, consentManager, log);
  }

  const sendToBackend = createEventSender({
    backendUrl,
    shopDomain,
    ingestionKey,
    isDevMode,
    consentManager,
    logger: log,
  });

  const pixelConfig = parsePixelConfig(settings.pixel_config);
  const mode = pixelConfig.mode || "full_funnel";

  subscribeToAnalyticsEvents(analytics, sendToBackend, log, mode);
});
