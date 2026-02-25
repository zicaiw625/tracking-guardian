import { register } from "@shopify/web-pixels-extension";
import { BACKEND_URL, isAllowedBackendUrl } from "../../shared/config";
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
  const placeholderDetected = BACKEND_URL && (BACKEND_URL.includes("__BACKEND_URL_PLACEHOLDER__") || BACKEND_URL.includes("PLACEHOLDER"));
  const backendUrl = !placeholderDetected && BACKEND_URL && isAllowedBackendUrl(BACKEND_URL, { shopDomain }) ? BACKEND_URL : null;
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
    const errorMsg = "严重错误：检测到 BACKEND_URL 占位符未替换。像素扩展将无法发送事件到后端，导致事件丢失。这是严重的配置错误，必须在生产环境部署前修复。请在 CI/CD 流程中运行 'pnpm ext:inject' 或 'pnpm deploy:ext'。";
    console.error("[Tracking Guardian] ❌", errorMsg);
  }
  if (backendUrl && (!ingestionKey || (typeof ingestionKey === "string" && ingestionKey.trim() === "")) && isDevMode) {
    console.error("[Tracking Guardian] 像素配置缺失 ingestion_key。生产严格模式下 /ingest 将拒绝所有像素事件，导致静默失败。请在 Admin 设置中配置 Ingestion Key，并确保 Web Pixel 的 settings 中包含 ingestion_key。");
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
      log("Backend URL resolved (硬校验)", {
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
      log("Backend URL not resolved (占位符未替换或未配置)", {
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
