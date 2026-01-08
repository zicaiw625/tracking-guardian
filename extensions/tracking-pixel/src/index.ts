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

  const ingestionSecret = settings.ingestion_key;
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
      hasIngestionSecret: !!ingestionSecret,
      backendUrl,
    });
  }

  const consentManager = createConsentManager(log);
  consentManager.updateFromStatus(init.customerPrivacy as CustomerPrivacyState | undefined, "init");

  if (customerPrivacy) {
    subscribeToConsentChanges(customerPrivacy, consentManager, log);
  }

  const environment = (settings.environment as "test" | "live" | undefined) || "live";

  const sendToBackend = createEventSender({
    backendUrl,
    shopDomain,
    ingestionSecret,
    isDevMode,
    consentManager,
    logger: log,
    environment,
  });

  const mode = (settings.mode === "full_funnel" ? "full_funnel" : "purchase_only") as "purchase_only" | "full_funnel";

  if (isDevMode) {
    log(`Pixel mode: ${mode}`, {
      fromSettings: settings.mode,
    });
  }

  subscribeToAnalyticsEvents(analytics, sendToBackend, log, mode);
});
