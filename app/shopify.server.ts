import "@shopify/shopify-app-remix/adapters/node";
import { randomBytes } from "crypto";
import {
  ApiVersion,
  AppDistribution,
  DeliveryMethod,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { createEncryptedSessionStorage } from "./utils/encrypted-session-storage";
import { 
  encryptAccessToken, 
  encryptIngestionSecret,
  validateTokenEncryptionConfig 
} from "./utils/token-encryption";

try {
  const encryptionValidation = validateTokenEncryptionConfig();
  if (encryptionValidation.warnings.length > 0) {
    console.warn("[Token Encryption] Configuration warnings:", encryptionValidation.warnings);
  }
} catch (error) {
  console.error("[Token Encryption] Configuration error:", error);
  if (process.env.NODE_ENV === "production") {
    throw error;
  }
}

function generateIngestionSecret(): string {
  return randomBytes(32).toString("hex");
}

function generateEncryptedIngestionSecret(): { plain: string; encrypted: string } {
  const plain = generateIngestionSecret();
  const encrypted = encryptIngestionSecret(plain);
  return { plain, encrypted };
}

const baseSessionStorage = new PrismaSessionStorage(prisma);
const encryptedSessionStorage = createEncryptedSessionStorage(baseSessionStorage);

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  // P0-1: Updated from October24 (2024-10) to July25 (2025-07)
  // 2024-10 was no longer supported as of 2025-10-01
  apiVersion: ApiVersion.July25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  
  sessionStorage: encryptedSessionStorage,
  distribution: AppDistribution.AppStore,
  // P0-1 (Review Fix): Only register BUSINESS webhooks here
  // Mandatory compliance webhooks (customers/data_request, customers/redact, shop/redact)
  // are subscribed via shopify.app.toml [webhooks.subscriptions] compliance_topics
  // to avoid duplicate deliveries
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
    // NOTE: CUSTOMERS_DATA_REQUEST, CUSTOMERS_REDACT, SHOP_REDACT
    // are NOT registered here - they come from shopify.app.toml compliance_topics
    // to prevent duplicate webhook deliveries and GDPRJob creation
  },
  hooks: {
    afterAuth: async ({ session }) => {
      
      shopify.registerWebhooks({ session });

      const existingShop = await prisma.shop.findUnique({
        where: { shopDomain: session.shop },
        select: { ingestionSecret: true },
      });

      const encryptedAccessToken = session.accessToken 
        ? encryptAccessToken(session.accessToken) 
        : null;

      const newIngestionSecret = generateEncryptedIngestionSecret();

      await prisma.shop.upsert({
        where: { shopDomain: session.shop },
        update: {
          accessToken: encryptedAccessToken,
          isActive: true,
          uninstalledAt: null,
          
        },
        create: {
          shopDomain: session.shop,
          accessToken: encryptedAccessToken,
          
          ingestionSecret: newIngestionSecret.encrypted,
        },
      });

      if (existingShop && !existingShop.ingestionSecret) {
        const secretForExisting = generateEncryptedIngestionSecret();
        await prisma.shop.update({
          where: { shopDomain: session.shop },
          data: { ingestionSecret: secretForExisting.encrypted },
        });
      }
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

