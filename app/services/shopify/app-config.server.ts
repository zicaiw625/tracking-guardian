

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

// 确保 apiKey 和 apiSecretKey 有值
// 在生产环境中，这些值必须存在（已在上面验证）
// 在开发环境中，如果不存在则使用空字符串作为后备值
const finalApiKey = apiKey || "";
const finalApiSecretKey = apiSecretKey || "";

// 验证所有必需的配置都存在
if (!finalApiKey || !finalApiSecretKey || !finalAppUrl) {
  const missing = [];
  if (!finalApiKey) missing.push("SHOPIFY_API_KEY");
  if (!finalApiSecretKey) missing.push("SHOPIFY_API_SECRET");
  if (!finalAppUrl) missing.push("SHOPIFY_APP_URL");
  
  const error = new Error(
    `Missing required Shopify configuration: ${missing.join(", ")}`
  );
  logger.error("[Shopify App Config] Missing required configuration", error);
  
  if (process.env.NODE_ENV === "production") {
    throw error;
  }
}

// 构建 shopifyApp 配置对象
// 使用 try-catch 来捕获初始化错误
let shopify;
try {
  const config = {
    apiKey: finalApiKey,
    apiSecretKey: finalApiSecretKey,
    apiVersion: ApiVersion.July25,
    scopes: process.env.SCOPES?.split(",").filter(Boolean),
    appUrl: finalAppUrl,
    authPathPrefix: "/auth",
    sessionStorage: encryptedSessionStorage,
    distribution: AppDistribution.AppStore,
    hooks: {
      afterAuth: async ({ session, admin }: { session: { shop: string; accessToken?: string }; admin?: any }) => {
        await handleAfterAuth(
          { session, admin }
        );
      },
    },
    future: {
      unstable_newEmbeddedAuthStrategy: true,
    },
  };

  // 只有在 SHOP_CUSTOM_DOMAIN 存在时才添加
  if (process.env.SHOP_CUSTOM_DOMAIN) {
    (config as typeof config & { customShopDomains: string[] }).customShopDomains = [
      process.env.SHOP_CUSTOM_DOMAIN,
    ];
  }

  shopify = shopifyApp(config);
} catch (error) {
  logger.error("[Shopify App Config] Failed to initialize shopifyApp", error);
  if (process.env.NODE_ENV === "production") {
    throw error;
  }
  // 在开发环境中，抛出一个更友好的错误
  throw new Error(
    `Failed to initialize Shopify app: ${error instanceof Error ? error.message : String(error)}`
  );
}

export default shopify;
export const apiVersion = ApiVersion.July25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;

