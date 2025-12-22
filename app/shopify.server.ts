import "@shopify/shopify-app-remix/adapters/node";
import { ApiVersion, AppDistribution, DeliveryMethod, shopifyApp, type AdminApiContext, } from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { createEncryptedSessionStorage } from "./utils/encrypted-session-storage";
import { encryptAccessToken, decryptAccessToken, generateEncryptedIngestionSecret, validateTokenEncryptionConfig } from "./utils/token-encryption";
import { logger } from "./utils/logger.server";
try {
    const encryptionValidation = validateTokenEncryptionConfig();
    if (encryptionValidation.warnings.length > 0) {
        logger.warn("[Token Encryption] Configuration warnings", { warnings: encryptionValidation.warnings });
    }
}
catch (error) {
    logger.error("[Token Encryption] Configuration error", error);
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
                    type WebhookRegisterResult = {
                        success: boolean;
                        result: {
                            message?: string;
                        };
                    };
                    const entries = Object.entries(webhookResult as Record<string, WebhookRegisterResult[]>);
                    const registered = entries.filter(([, results]) => results.some((r) => r.success));
                    const failed = entries.filter(([, results]) => results.some((r) => !r.success));
                    if (registered.length > 0) {
                        logger.info(`[Webhooks] Registered for ${session.shop}`, { topics: registered.map(([topic]) => topic) });
                    }
                    if (failed.length > 0) {
                        logger.error(`[Webhooks] Failed to register for ${session.shop}`, undefined, { failures: failed.map(([topic, results]) => ({ topic, errors: results.map((r) => r.result?.message || "unknown error") })) });
                    }
                }
            }
            catch (webhookError) {
                logger.error(`[Webhooks] Registration error for ${session.shop}`, webhookError);
            }
            if (admin) {
                try {
                    await cleanupDeprecatedWebhookSubscriptions(admin, session.shop);
                }
                catch (cleanupError) {
                    logger.warn(`[Webhooks] Cleanup warning for ${session.shop}`, { error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) });
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
                    }
                    else if (plan) {
                        shopTier = "non_plus";
                    }
                    if (primaryDomainHost) {
                        logger.info(`[Shop] Fetched primary domain for ${session.shop}`, { primaryDomain: primaryDomainHost });
                    }
                    logger.info(`[Shop] Determined shopTier for ${session.shop}`, { shopTier, isPlus: plan?.shopifyPlus, isDevPartner: plan?.partnerDevelopment });
                }
            }
            catch (shopQueryError) {
                logger.warn(`[Shop] Failed to fetch shop info for ${session.shop}`, { error: shopQueryError instanceof Error ? shopQueryError.message : String(shopQueryError) });
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
async function cleanupDeprecatedWebhookSubscriptions(admin: AdminApiContext, shopDomain: string): Promise<void> {
    const DEPRECATED_TOPICS = new Set<string>([
        "CHECKOUT_AND_ACCOUNTS_CONFIGURATIONS_UPDATE",
    ]);
    try {
        type WebhookEdge = {
            node: {
                id: string;
                topic: string;
            };
            cursor: string;
        };
        const deprecatedSubs: Array<{
            id: string;
            topic: string;
        }> = [];
        let cursor: string | null = null;
        let hasNextPage = true;
        let pages = 0;
        while (hasNextPage && pages < 10) {
            const response = await admin.graphql(`
          query GetWebhookSubscriptions($cursor: String) {
            webhookSubscriptions(first: 250, after: $cursor) {
              edges {
                node {
                  id
                  topic
                }
                cursor
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `, { variables: { cursor } });
            const data = await response.json() as {
                data?: {
                    webhookSubscriptions?: {
                        edges?: WebhookEdge[];
                        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
                    };
                };
                errors?: Array<{ message?: string }>;
            };
            if (data.errors) {
                logger.warn(`[Webhooks] Failed to query subscriptions for ${shopDomain}`, { errors: data.errors });
                return;
            }
            const edges: WebhookEdge[] = data.data?.webhookSubscriptions?.edges || [];
            for (const edge of edges) {
                if (DEPRECATED_TOPICS.has(edge.node.topic)) {
                    deprecatedSubs.push({ id: edge.node.id, topic: edge.node.topic });
                }
            }
            const pageInfo = data.data?.webhookSubscriptions?.pageInfo;
            hasNextPage = pageInfo?.hasNextPage === true;
            cursor = pageInfo?.endCursor || null;
            pages++;
        }
        if (pages >= 10 && hasNextPage) {
            logger.warn(`[Webhooks] Pagination limit reached while querying webhook subscriptions for ${shopDomain}`, { pagesProcessed: pages });
        }
        if (deprecatedSubs.length === 0) {
            return;
        }
        logger.info(`[Webhooks] Found deprecated webhooks for ${shopDomain}, cleaning up`, { count: deprecatedSubs.length });
        for (const sub of deprecatedSubs) {
            const subId = sub.id;
            const subTopic = sub.topic;
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
                    logger.warn(`[Webhooks] Error deleting ${subTopic} for ${shopDomain}`, { userErrors });
                }
                else {
                    logger.info(`[Webhooks] Deleted deprecated webhook for ${shopDomain}`, { topic: subTopic });
                }
            }
            catch (deleteError) {
                logger.warn(`[Webhooks] Failed to delete webhook for ${shopDomain}`, { topic: subTopic, error: deleteError instanceof Error ? deleteError.message : String(deleteError) });
            }
        }
    }
    catch (error) {
        logger.warn(`[Webhooks] Cleanup query failed for ${shopDomain}`, { error: error instanceof Error ? error.message : String(error) });
    }
}
export async function createAdminClientForShop(shopDomain: string): Promise<AdminApiContext | null> {
    try {
        const offlineSession = await prisma.session.findFirst({
            where: {
                shop: shopDomain,
                isOnline: false,
                accessToken: { not: "" },
            },
            orderBy: { id: "desc" },
        });
        if (offlineSession?.accessToken) {
            try {
                const accessToken = decryptAccessToken(offlineSession.accessToken);
                if (accessToken) {
                    const apiUrl = `https://${shopDomain}/admin/api/${ApiVersion.July25}/graphql.json`;
                    const graphqlClient = {
                        async graphql(query: string, options?: {
                            variables?: Record<string, unknown>;
                        }) {
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
                }
            }
            catch (error) {
                logger.warn(`[Admin] Failed to decrypt offline session token for ${shopDomain}`, { error: error instanceof Error ? error.message : String(error) });
            }
        }
        const shopRecord = await prisma.shop.findUnique({
            where: { shopDomain },
            select: { accessToken: true },
        });
        let accessToken: string | null = null;
        if (shopRecord?.accessToken) {
            try {
                accessToken = decryptAccessToken(shopRecord.accessToken);
            }
            catch {
                logger.warn(`[Admin] Failed to decrypt shop-level token for ${shopDomain}`);
            }
        }
        if (!accessToken) {
            logger.info(`[Admin] No usable offline token for ${shopDomain}`);
            return null;
        }
        const apiUrl = `https://${shopDomain}/admin/api/${ApiVersion.July25}/graphql.json`;
        const graphqlClient = {
            async graphql(query: string, options?: {
                variables?: Record<string, unknown>;
            }) {
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
    }
    catch (error) {
        logger.error(`[Admin] Failed to create client for ${shopDomain}`, error);
        return null;
    }
}
