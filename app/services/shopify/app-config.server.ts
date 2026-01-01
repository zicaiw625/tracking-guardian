

import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  DeliveryMethod,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "../../db.server";
import { createEncryptedSessionStorage } from "../../utils/encrypted-session-storage";
import { validateTokenEncryptionConfig } from "../../utils/token-encryption";
import { logger } from "../../utils/logger.server";
import { handleAfterAuth } from "./shop-provisioning.server";

try {
  const encryptionValidation = validateTokenEncryptionConfig();
  if (encryptionValidation.warnings.length > 0) {
    logger.warn("[Token Encryption] Configuration warnings", {
      warnings: encryptionValidation.warnings,
    });
  }
} catch (error) {
  logger.error("[Token Encryption] Configuration error", error);
  if (process.env.NODE_ENV === "production") {
    throw error;
  }
}

const baseSessionStorage = new PrismaSessionStorage(prisma);
const encryptedSessionStorage = createEncryptedSessionStorage(baseSessionStorage);

// 验证并获取 appUrl
const appUrl = process.env.SHOPIFY_APP_URL?.trim();
if (!appUrl || appUrl === "") {
  const error = new Error(
    "SHOPIFY_APP_URL environment variable is required. Please set it in your environment variables."
  );
  logger.error("[Shopify App Config] Missing required environment variable", error);
  if (process.env.NODE_ENV === "production") {
    throw error;
  }
  // 在开发环境中，使用一个默认值以避免立即崩溃
  logger.warn("[Shopify App Config] Using fallback URL in development mode");
}

// 确保 appUrl 是有效的 URL
const finalAppUrl = (appUrl && appUrl !== "") ? appUrl : "http://localhost:3000";
try {
  // 验证 URL 格式
  new URL(finalAppUrl);
} catch (urlError) {
  const error = new Error(
    `SHOPIFY_APP_URL is not a valid URL: ${finalAppUrl}. Please set a valid URL in your environment variables.`
  );
  logger.error("[Shopify App Config] Invalid URL", error);
  if (process.env.NODE_ENV === "production") {
    throw error;
  }
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: finalAppUrl,
  authPathPrefix: "/auth",
  sessionStorage: encryptedSessionStorage,
  distribution: AppDistribution.AppStore,
  hooks: {
    afterAuth: async ({ session, admin }) => {
      await handleAfterAuth(
        { session, admin }
      );
    },
  },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;

