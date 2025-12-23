/**
 * Shopify App Configuration
 *
 * Core Shopify app configuration and initialization.
 */

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

// =============================================================================
// Token Encryption Validation
// =============================================================================

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

// =============================================================================
// Session Storage
// =============================================================================

const baseSessionStorage = new PrismaSessionStorage(prisma);
const encryptedSessionStorage = createEncryptedSessionStorage(baseSessionStorage);

// =============================================================================
// Shopify App Instance
// =============================================================================

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: encryptedSessionStorage,
  distribution: AppDistribution.AppStore,
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks",
    },
    ORDERS_PAID: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks",
    },
    ORDERS_UPDATED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks",
    },
    CUSTOMERS_DATA_REQUEST: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks",
    },
    CUSTOMERS_REDACT: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks",
    },
    SHOP_REDACT: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks",
    },
  },
  hooks: {
    afterAuth: async ({ session, admin }) => {
      await handleAfterAuth(
        { session, admin },
        // Type assertion needed due to Shopify SDK types being more specific
        ((params: { session: { shop: string } }) => 
          shopify.registerWebhooks(params as Parameters<typeof shopify.registerWebhooks>[0])
        ) as (params: { session: { shop: string } }) => Promise<unknown>
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

// =============================================================================
// Exports
// =============================================================================

export default shopify;
export const apiVersion = ApiVersion.July25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;

