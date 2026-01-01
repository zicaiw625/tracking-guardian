

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

// 验证并获取必需的环境变量
const apiKey = process.env.SHOPIFY_API_KEY;
const apiSecretKey = process.env.SHOPIFY_API_SECRET;
const appUrl = process.env.SHOPIFY_APP_URL?.trim();

// 在生产环境中，所有必需的环境变量都必须存在
if (process.env.NODE_ENV === "production") {
  if (!apiKey) {
    throw new Error("SHOPIFY_API_KEY environment variable is required in production");
  }
  if (!apiSecretKey) {
    throw new Error("SHOPIFY_API_SECRET environment variable is required in production");
  }
  if (!appUrl || appUrl === "") {
    throw new Error("SHOPIFY_APP_URL environment variable is required in production");
  }
}

// 验证并获取 appUrl
let finalAppUrl: string;
if (!appUrl || appUrl === "") {
  logger.warn("[Shopify App Config] SHOPIFY_APP_URL not set, using fallback URL");
  finalAppUrl = "http://localhost:3000";
} else {
  finalAppUrl = appUrl;
}

// 确保 appUrl 是有效的 URL
try {
  new URL(finalAppUrl);
} catch (urlError) {
  const error = new Error(
    `SHOPIFY_APP_URL is not a valid URL: ${finalAppUrl}. Please set a valid URL in your environment variables.`
  );
  logger.error("[Shopify App Config] Invalid URL", error);
  if (process.env.NODE_ENV === "production") {
    throw error;
  }
  // 在开发环境中，使用默认值
  finalAppUrl = "http://localhost:3000";
}

// 确保 apiKey 和 apiSecretKey 有值（即使是空字符串，也要确保不是 undefined）
const finalApiKey = apiKey || "";
const finalApiSecretKey = apiSecretKey || "";

const shopify = shopifyApp({
  apiKey: finalApiKey,
  apiSecretKey: finalApiSecretKey,
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

