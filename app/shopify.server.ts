import "@shopify/shopify-app-remix/adapters/node";
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
  generateEncryptedIngestionSecret,
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

const baseSessionStorage = new PrismaSessionStorage(prisma);
const encryptedSessionStorage = createEncryptedSessionStorage(baseSessionStorage);

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

    // P0-3: GDPR mandatory compliance webhooks
    // These must be registered for App Store approval
    // See: https://shopify.dev/docs/apps/webhooks/configuration/mandatory-webhooks
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
    afterAuth: async ({ session }) => {
      try {
        const webhookResult = await shopify.registerWebhooks({ session });
        
        if (webhookResult && typeof webhookResult === 'object') {
          type WebhookRegisterResult = { success: boolean; result: { message?: string } };
          const entries = Object.entries(webhookResult as Record<string, WebhookRegisterResult[]>);
          
          const registered = entries.filter(
            ([, results]) => results.some((r) => r.success)
          );
          const failed = entries.filter(
            ([, results]) => results.some((r) => !r.success)
          );
          
          if (registered.length > 0) {
            console.log(`[Webhooks] Registered for ${session.shop}:`, registered.map(([topic]) => topic).join(", "));
          }
          if (failed.length > 0) {
            console.error(`[Webhooks] Failed to register for ${session.shop}:`, 
              failed.map(([topic, results]) => 
                `${topic}: ${results.map((r) => r.result?.message || "unknown error").join(", ")}`
              ).join("; ")
            );
          }
        }
      } catch (webhookError) {
        console.error(`[Webhooks] Registration error for ${session.shop}:`, 
          webhookError instanceof Error ? webhookError.message : webhookError
        );
      }

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
