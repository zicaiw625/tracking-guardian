import { register } from "@shopify/web-pixels-extension";
import {
  BACKEND_URL,
  RAW_BACKEND_URL,
  BACKEND_URL_PLACEHOLDER_DETECTED,
  isAllowedBackendUrl,
} from "../../shared/config";
import { createConsentManager, subscribeToConsentChanges } from "./consent";
import { createEventSender, subscribeToAnalyticsEvents } from "./events";
import type { PixelSettings, PixelInit, CustomerPrivacyState, VisitorConsentCollectedEvent } from "./types";

register(({ analytics, settings, init, customerPrivacy }: {
  analytics: { subscribe: (event: string, handler: (event: unknown) => void) => void };
  settings: PixelSettings;
  init: PixelInit;
  customerPrivacy?: { subscribe?: (event: string, handler: (e: VisitorConsentCollectedEvent) => void) => void };
}) => {
  const ingestionKey = settings.ingestion_key;
  const shopDomain = settings.shop_domain || init.data?.shop?.myshopifyDomain || "";
  const placeholderDetected = BACKEND_URL_PLACEHOLDER_DETECTED;
  const backendUrl = !placeholderDetected && BACKEND_URL && isAllowedBackendUrl(BACKEND_URL, { shopDomain }) ? BACKEND_URL : null;
  const diagnosticBackendUrl =
    typeof RAW_BACKEND_URL === "string" && /^https?:\/\//i.test(RAW_BACKEND_URL) ? RAW_BACKEND_URL : null;
  const backendDisabledReason =
    !backendUrl && placeholderDetected ? "backend_url_not_injected" : undefined;
  const environment = (settings.environment as "test" | "live" | undefined) || "live";
  const isDevMode = (() => {
    if (shopDomain.includes(".myshopify.dev") || /-(dev|staging|test)\./i.test(shopDomain)) {
      return true;
    }
    return false;
  })();
  function log(...args: unknown[]): void {
    // Enable logging if in dev mode OR if debug setting is explicitly enabled
    const debugEnabled = isDevMode || (settings as any).debug === true || (settings as any).debug === "true";
    if (debugEnabled) {
      console.log("[Tracking Guardian]", ...args);
    }
  }
  if (placeholderDetected && isDevMode) {
    const errorMsg = "Critical error: detected unresolved BACKEND_URL placeholder. The pixel extension cannot send events to the backend, so events will be lost. This must be fixed before production deployment. Run 'pnpm ext:inject' or 'pnpm deploy:ext' in CI/CD.";
    console.error("[Tracking Guardian] ❌", errorMsg);
  }
  if (backendUrl && (!ingestionKey || (typeof ingestionKey === "string" && ingestionKey.trim() === "")) && isDevMode) {
    console.error("[Tracking Guardian] Missing ingestion_key in pixel settings. In strict production mode, /ingest will reject all pixel events and cause silent data loss. Configure Ingestion Key in Admin and ensure Web Pixel settings include ingestion_key.");
  }
  if (isDevMode) {
    log("Development mode enabled", {
      shopDomain,
      hasIngestionKey: !!ingestionKey,
      backendUrl,
      placeholderDetected,
    });
    
    const missingFeatures: string[] = [];
    if (typeof TextEncoder === "undefined") missingFeatures.push("TextEncoder");
    if (typeof URL === "undefined") missingFeatures.push("URL");
    if (typeof crypto === "undefined" || !crypto.getRandomValues) missingFeatures.push("crypto.getRandomValues");
    if (typeof crypto !== "undefined" && !crypto.subtle) missingFeatures.push("crypto.subtle");

    if (missingFeatures.length > 0) {
      log(`⚠️ Environment warning: Missing features [${missingFeatures.join(", ")}]. Pixel may run in degraded mode or fail signature generation.`);
    }

    if (backendUrl) {
      log("Backend URL resolved (strict validation)", {
        backendUrl,
        hostname: (() => {
          try {
            return new URL(backendUrl).hostname;
          } catch {
            return "invalid";
          }
        })(),
      });
    } else {
      log("Backend URL not resolved (placeholder unresolved or not configured)", {
        rawBackendUrl: BACKEND_URL,
        isAllowed: BACKEND_URL ? isAllowedBackendUrl(BACKEND_URL, { shopDomain }) : false,
        placeholderDetected,
      });
    }
  }
  const consentManager = createConsentManager(log);
  consentManager.updateFromStatus(init.customerPrivacy as CustomerPrivacyState | undefined, "init");
  if (customerPrivacy) {
    subscribeToConsentChanges(customerPrivacy, consentManager, log);
  }
  const sendToBackend = createEventSender({
    backendUrl,
    diagnosticBackendUrl,
    backendDisabledReason,
    shopDomain,
    ingestionKey,
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
