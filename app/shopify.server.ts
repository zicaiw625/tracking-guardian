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

/**
 * P1-1: Generate a secure random ingestion secret for pixel request signing
 * The secret is 32 bytes (256 bits) encoded as hex (64 characters)
 */
function generateIngestionSecret(): string {
  return randomBytes(32).toString("hex");
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October24,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
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

      // Create or update shop record in our database
      // P1-1: Generate ingestion secret for new shops (for pixel request signing)
      await prisma.shop.upsert({
        where: { shopDomain: session.shop },
        update: {
          accessToken: session.accessToken,
          isActive: true,
          uninstalledAt: null,
          // Don't overwrite existing ingestion secret on re-auth
        },
        create: {
          shopDomain: session.shop,
          accessToken: session.accessToken,
          ingestionSecret: generateIngestionSecret(), // P1-1: Generate for new shops
        },
      });

      // If existing shop had no secret, generate one
      if (existingShop && !existingShop.ingestionSecret) {
        await prisma.shop.update({
          where: { shopDomain: session.shop },
          data: { ingestionSecret: generateIngestionSecret() },
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

