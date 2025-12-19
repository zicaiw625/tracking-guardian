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

// P0-1: Validate token encryption configuration at startup
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

/**
 * P1-1: Generate a secure random ingestion secret for pixel request signing
 * The secret is 32 bytes (256 bits) encoded as hex (64 characters)
 */
function generateIngestionSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * P0-1: Generate and encrypt ingestion secret for new shops
 * Returns the encrypted version for storage
 */
function generateEncryptedIngestionSecret(): { plain: string; encrypted: string } {
  const plain = generateIngestionSecret();
  const encrypted = encryptIngestionSecret(plain);
  return { plain, encrypted };
}

// P0-1: Create encrypted session storage wrapper
const baseSessionStorage = new PrismaSessionStorage(prisma);
const encryptedSessionStorage = createEncryptedSessionStorage(baseSessionStorage);

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October24,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  // P0-1: Use encrypted session storage for accessToken protection
  sessionStorage: encryptedSessionStorage,
  distribution: AppDistribution.AppStore,
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks",
    },
    // NOTE: Only using ORDERS_PAID for conversion tracking
    // ORDERS_PAID is more accurate for "purchase" semantics (payment confirmed)
    // Using both ORDERS_CREATE and ORDERS_PAID would cause duplicate events
    ORDERS_PAID: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks",
    },
    // ORDERS_UPDATED is kept for handling refunds and order changes
    ORDERS_UPDATED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks",
    },
  },
  hooks: {
    afterAuth: async ({ session }) => {
      // Register webhooks after authentication
      shopify.registerWebhooks({ session });

      // Check if shop already exists
      const existingShop = await prisma.shop.findUnique({
        where: { shopDomain: session.shop },
        select: { ingestionSecret: true },
      });

      // P0-1: Encrypt accessToken before storing in Shop table
      // Note: The Session table accessToken is already encrypted by the session storage wrapper
      const encryptedAccessToken = session.accessToken 
        ? encryptAccessToken(session.accessToken) 
        : null;

      // P0-2: Generate encrypted ingestion secret for new shops
      const newIngestionSecret = generateEncryptedIngestionSecret();

      // Create or update shop record in our database
      // P0-1: Store encrypted accessToken
      // P0-2: Store encrypted ingestionSecret
      await prisma.shop.upsert({
        where: { shopDomain: session.shop },
        update: {
          accessToken: encryptedAccessToken,
          isActive: true,
          uninstalledAt: null,
          // Don't overwrite existing ingestion secret on re-auth
        },
        create: {
          shopDomain: session.shop,
          accessToken: encryptedAccessToken,
          // P0-2: Store encrypted ingestion secret for new shops
          ingestionSecret: newIngestionSecret.encrypted,
        },
      });

      // If existing shop had no secret, generate one
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
export const apiVersion = ApiVersion.October24;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;

