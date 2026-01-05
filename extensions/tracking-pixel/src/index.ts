

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

  // P0-4: ingestionSecret 仅用于生成 HMAC 签名，不会出现在请求体中
  // 服务端通过 shopDomain 查找 shop.ingestionSecret 进行验证
  const ingestionSecret = settings.ingestion_key; // 保持向后兼容，settings 中仍使用 ingestion_key 字段名
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

  const sendToBackend = createEventSender({
    backendUrl,
    shopDomain,
    ingestionSecret,
    isDevMode,
    consentManager,
    logger: log,
  });

  // P1-11: 不再从 settings.pixel_config 读取配置，使用默认配置
  // 完整配置由后端根据 shop_domain 提供（如果需要）
  // v1 默认 purchase_only，符合隐私最小化原则
  const mode = "purchase_only"; // 使用默认模式

  subscribeToAnalyticsEvents(analytics, sendToBackend, log, mode);
});
