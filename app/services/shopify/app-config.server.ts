import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
  type AdminApiContext,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "../../db.server";
import { createEncryptedSessionStorage } from "../../utils/encrypted-session-storage";
import { validateTokenEncryptionConfig } from "../../utils/token-encryption.server";
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

const apiKey = process.env.SHOPIFY_API_KEY;
const apiSecretKey = process.env.SHOPIFY_API_SECRET;
const appUrl = process.env.SHOPIFY_APP_URL?.trim();

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

let finalAppUrl: string;
if (!appUrl || appUrl === "") {
  logger.warn("[Shopify App Config] SHOPIFY_APP_URL not set, using fallback URL");
  finalAppUrl = "http://localhost:3000";
} else {
  finalAppUrl = appUrl;
}

try {
  new URL(finalAppUrl);
} catch {
  const error = new Error(
    `SHOPIFY_APP_URL is not a valid URL: ${finalAppUrl}. Please set a valid URL in your environment variables.`
  );
  logger.error("[Shopify App Config] Invalid URL", error);
  if (process.env.NODE_ENV === "production") {
    throw error;
  }
  finalAppUrl = "http://localhost:3000";
}

const finalApiKey = apiKey || "";
const finalApiSecretKey = apiSecretKey || "";

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

let shopify: ReturnType<typeof shopifyApp>;
try {
  const config = {
    apiKey: finalApiKey,
    apiSecretKey: finalApiSecretKey,
    apiVersion: ApiVersion.January26,
    scopes: process.env.SCOPES?.split(",").map((s) => s.trim()).filter(Boolean),
    appUrl: finalAppUrl,
    authPathPrefix: "/auth",
    sessionStorage: encryptedSessionStorage,
    distribution: AppDistribution.AppStore,
    hooks: {
      afterAuth: async ({ session, admin }: { session: { shop: string; accessToken?: string }; admin?: AdminApiContext }) => {
        if (shopify) {
          try {
            await (shopify.registerWebhooks as (opts: { session: { shop: string; accessToken?: string } }) => Promise<unknown>)({ session });
          } catch (webhookError) {
            logger.error("[Webhooks] Failed to register webhooks", {
              shop: session.shop,
              error: webhookError instanceof Error ? webhookError.message : String(webhookError),
            });
          }
        }
        await handleAfterAuth(
          { session, admin }
        );
      },
    },
    future: {
      unstable_newEmbeddedAuthStrategy: true,
    },
  };
  if (process.env.SHOP_CUSTOM_DOMAIN) {
    (config as typeof config & { customShopDomains: string[] }).customShopDomains = [
      process.env.SHOP_CUSTOM_DOMAIN,
    ];
  }
  logger.info("[Shopify App Config] Initializing shopifyApp", {
    hasApiKey: !!finalApiKey,
    hasApiSecretKey: !!finalApiSecretKey,
    appUrl: finalAppUrl,
    hasSessionStorage: !!encryptedSessionStorage,
  });
  shopify = shopifyApp(config);
  if (!shopify) {
    throw new Error("shopifyApp returned undefined");
  }
  logger.info("[Shopify App Config] shopifyApp initialized successfully");
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;
  logger.error("[Shopify App Config] Failed to initialize shopifyApp", {
    error: errorMessage,
    stack: errorStack,
    config: {
      hasApiKey: !!finalApiKey,
      hasApiSecretKey: !!finalApiSecretKey,
      appUrl: finalAppUrl,
      hasSessionStorage: !!encryptedSessionStorage,
    },
  });
  if (process.env.NODE_ENV === "production") {
    throw error;
  }
  throw new Error(
    `Failed to initialize Shopify app: ${errorMessage}`
  );
}

if (!shopify) {
  const error = new Error("Shopify app not initialized");
  logger.error("[Shopify App Config] Shopify app is undefined", error);
  throw error;
}

export default shopify;
export const apiVersion = ApiVersion.January26;

export function addDocumentResponseHeaders(request: Request, headers: Headers): void {
  if (!shopify?.addDocumentResponseHeaders) {
    throw new Error("addDocumentResponseHeaders is not available");
  }
  return shopify.addDocumentResponseHeaders(request, headers);
}

export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
