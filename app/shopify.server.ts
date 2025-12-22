import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  DeliveryMethod,
  shopifyApp,
  type AdminApiContext,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { createEncryptedSessionStorage } from "./utils/encrypted-session-storage";
import { 
  encryptAccessToken, 
  decryptAccessToken,
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

      if (admin) {
        try {
          await cleanupDeprecatedWebhookSubscriptions(admin, session.shop);
        } catch (cleanupError) {
          console.warn(`[Webhooks] Cleanup warning for ${session.shop}:`,
            cleanupError instanceof Error ? cleanupError.message : cleanupError
          );
        }
      }

      let primaryDomainHost: string | null = null;
      let shopTier: "plus" | "non_plus" | "unknown" = "unknown";
      
      try {
        if (admin) {
          const shopQuery = await admin.graphql(`
            query {
              shop {
                primaryDomain {
                  host
                }
                plan {
                  displayName
                  partnerDevelopment
                  shopifyPlus
                }
                checkoutApiSupported
              }
            }
          `);
          
          const shopData = await shopQuery.json();
          primaryDomainHost = shopData?.data?.shop?.primaryDomain?.host || null;
          
          const plan = shopData?.data?.shop?.plan;
          if (plan?.shopifyPlus === true) {
            shopTier = "plus";
          } else if (plan) {
            shopTier = "non_plus";
          }
          
          if (primaryDomainHost) {
            console.log(`[Shop] Fetched primary domain for ${session.shop}: ${primaryDomainHost}`);
          }
          console.log(`[Shop] Determined shopTier for ${session.shop}: ${shopTier} (Plus: ${plan?.shopifyPlus}, Dev: ${plan?.partnerDevelopment})`);
        }
      } catch (shopQueryError) {
        console.warn(`[Shop] Failed to fetch shop info for ${session.shop}:`, 
          shopQueryError instanceof Error ? shopQueryError.message : shopQueryError
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
          ...(primaryDomainHost && { primaryDomain: primaryDomainHost }),
          ...(shopTier !== "unknown" && { shopTier }),
        },
        create: {
          shopDomain: session.shop,
          accessToken: encryptedAccessToken,
          ingestionSecret: newIngestionSecret.encrypted,
          primaryDomain: primaryDomainHost,
          storefrontDomains: [],
          shopTier,
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

async function cleanupDeprecatedWebhookSubscriptions(
  admin: AdminApiContext,
  shopDomain: string
): Promise<void> {
  const DEPRECATED_TOPICS = [
    "CHECKOUT_AND_ACCOUNTS_CONFIGURATIONS_UPDATE",
  ];

  try {
    const response = await admin.graphql(`
      query GetWebhookSubscriptions {
        webhookSubscriptions(first: 50) {
          edges {
            node {
              id
              topic
            }
          }
        }
      }
    `);

    const data = await response.json();
    
    if (data.errors) {
      console.warn(`[Webhooks] Failed to query subscriptions for ${shopDomain}:`, data.errors);
      return;
    }

    const subscriptions = data.data?.webhookSubscriptions?.edges || [];
    const deprecatedSubs = subscriptions.filter((edge: { node: { topic: string } }) => 
      DEPRECATED_TOPICS.includes(edge.node.topic)
    );

    if (deprecatedSubs.length === 0) {
      return;
    }

    console.log(`[Webhooks] Found ${deprecatedSubs.length} deprecated webhook(s) for ${shopDomain}, cleaning up...`);

    for (const sub of deprecatedSubs) {
      const subId = sub.node.id;
      const subTopic = sub.node.topic;

      try {
        const deleteResponse = await admin.graphql(`
          mutation DeleteWebhookSubscription($id: ID!) {
            webhookSubscriptionDelete(id: $id) {
              deletedWebhookSubscriptionId
              userErrors {
                field
                message
              }
            }
          }
        `, {
          variables: { id: subId },
        });

        const deleteData = await deleteResponse.json();
        const userErrors = deleteData.data?.webhookSubscriptionDelete?.userErrors || [];

        if (userErrors.length > 0) {
          console.warn(`[Webhooks] Error deleting ${subTopic} for ${shopDomain}:`, userErrors);
        } else {
          console.log(`[Webhooks] Deleted deprecated ${subTopic} webhook for ${shopDomain}`);
        }
      } catch (deleteError) {
        console.warn(`[Webhooks] Failed to delete ${subTopic} for ${shopDomain}:`,
          deleteError instanceof Error ? deleteError.message : deleteError
        );
      }
    }
  } catch (error) {
    console.warn(`[Webhooks] Cleanup query failed for ${shopDomain}:`,
      error instanceof Error ? error.message : error
    );
  }
}

export async function createAdminClientForShop(
  shopDomain: string
): Promise<AdminApiContext | null> {
  try {
    const session = await prisma.session.findFirst({
      where: {
        shop: shopDomain,
        isOnline: false,
        accessToken: { not: "" },
      },
      orderBy: { id: "desc" },
    });

    if (!session?.accessToken) {
      console.log(`[Admin] No offline session for ${shopDomain}`);
      return null;
    }

    let accessToken: string;
    try {
      accessToken = decryptAccessToken(session.accessToken);
    } catch {
      console.warn(`[Admin] Failed to decrypt token for ${shopDomain}`);
      return null;
    }

    const apiUrl = `https://${shopDomain}/admin/api/${ApiVersion.July25}/graphql.json`;
    
    const graphqlClient = {
      async graphql(query: string, options?: { variables?: Record<string, unknown> }) {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": accessToken,
          },
          body: JSON.stringify({
            query,
            variables: options?.variables,
          }),
        });
        
        return {
          json: async () => response.json(),
        };
      },
    };

    return graphqlClient as unknown as AdminApiContext;
  } catch (error) {
    console.error(`[Admin] Failed to create client for ${shopDomain}:`, error);
    return null;
  }
}
