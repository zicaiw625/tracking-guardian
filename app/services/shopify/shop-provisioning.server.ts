/**
 * Shop Provisioning Service
 *
 * Handles shop setup and provisioning after OAuth authentication.
 */

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../../db.server";
import {
  encryptAccessToken,
  generateEncryptedIngestionSecret,
} from "../../utils/token-encryption";
import { logger } from "../../utils/logger.server";
import type { ShopQueryResponse, ShopTierValue } from "../../types/shopify";
import type { WebhookRegisterResults } from "../../types/shopify";
import { cleanupDeprecatedWebhookSubscriptions } from "./webhook-cleanup.server";

// =============================================================================
// Types
// =============================================================================

interface AfterAuthParams {
  session: {
    shop: string;
    accessToken?: string;
  };
  admin?: AdminApiContext;
}

interface ShopInfo {
  primaryDomain: string | null;
  shopTier: ShopTierValue;
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard for WebhookRegisterResults
 */
export function isWebhookRegisterResults(
  result: unknown
): result is WebhookRegisterResults {
  return (
    typeof result === "object" &&
    result !== null &&
    !Array.isArray(result)
  );
}

// =============================================================================
// Shop Info Fetching
// =============================================================================

/**
 * Fetch shop info from Shopify Admin API
 */
async function fetchShopInfo(
  admin: AdminApiContext,
  shopDomain: string
): Promise<ShopInfo> {
  let primaryDomainHost: string | null = null;
  let shopTier: ShopTierValue = "unknown";

  try {
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

    const shopData = (await shopQuery.json()) as ShopQueryResponse;
    primaryDomainHost = shopData?.data?.shop?.primaryDomain?.host || null;

    const plan = shopData?.data?.shop?.plan;
    if (plan?.shopifyPlus === true) {
      shopTier = "plus";
    } else if (plan) {
      shopTier = "non_plus";
    }

    if (primaryDomainHost) {
      logger.info(`[Shop] Fetched primary domain for ${shopDomain}`, {
        primaryDomain: primaryDomainHost,
      });
    }

    logger.info(`[Shop] Determined shopTier for ${shopDomain}`, {
      shopTier,
      isPlus: plan?.shopifyPlus,
      isDevPartner: plan?.partnerDevelopment,
    });
  } catch (error) {
    logger.warn(`[Shop] Failed to fetch shop info for ${shopDomain}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { primaryDomain: primaryDomainHost, shopTier };
}

// =============================================================================
// Webhook Registration
// =============================================================================

/**
 * Register webhooks and log results
 */
export async function registerAndLogWebhooks(
  registerWebhooks: (params: { session: { shop: string } }) => Promise<unknown>,
  session: { shop: string }
): Promise<void> {
  try {
    const webhookResult = await registerWebhooks({ session });

    if (isWebhookRegisterResults(webhookResult)) {
      const entries = Object.entries(webhookResult);
      const registered = entries.filter(([, results]) =>
        results.some((r) => r.success)
      );
      const failed = entries.filter(([, results]) =>
        results.some((r) => !r.success)
      );

      if (registered.length > 0) {
        logger.info(`[Webhooks] Registered for ${session.shop}`, {
          topics: registered.map(([topic]) => topic),
        });
      }

      if (failed.length > 0) {
        logger.error(
          `[Webhooks] Failed to register for ${session.shop}`,
          undefined,
          {
            failures: failed.map(([topic, results]) => ({
              topic,
              errors: results.map((r) => r.result?.message || "unknown error"),
            })),
          }
        );
      }
    }
  } catch (webhookError) {
    logger.error(
      `[Webhooks] Registration error for ${session.shop}`,
      webhookError
    );
  }
}

// =============================================================================
// Shop Database Operations
// =============================================================================

/**
 * Upsert shop record in database
 */
async function upsertShopRecord(
  shopDomain: string,
  accessToken: string | undefined,
  shopInfo: ShopInfo
): Promise<void> {
  const existingShop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { ingestionSecret: true },
  });

  const encryptedAccessToken = accessToken
    ? encryptAccessToken(accessToken)
    : null;

  const newIngestionSecret = generateEncryptedIngestionSecret();

  await prisma.shop.upsert({
    where: { shopDomain },
    update: {
      accessToken: encryptedAccessToken,
      isActive: true,
      uninstalledAt: null,
      ...(shopInfo.primaryDomain && { primaryDomain: shopInfo.primaryDomain }),
      ...(shopInfo.shopTier !== "unknown" && { shopTier: shopInfo.shopTier }),
    },
    create: {
      shopDomain,
      accessToken: encryptedAccessToken,
      ingestionSecret: newIngestionSecret.encrypted,
      primaryDomain: shopInfo.primaryDomain,
      storefrontDomains: [],
      shopTier: shopInfo.shopTier,
    },
  });

  // Generate ingestion secret for existing shops without one
  if (existingShop && !existingShop.ingestionSecret) {
    const secretForExisting = generateEncryptedIngestionSecret();
    await prisma.shop.update({
      where: { shopDomain },
      data: { ingestionSecret: secretForExisting.encrypted },
    });
  }
}

// =============================================================================
// Main After Auth Handler
// =============================================================================

/**
 * Handle shop provisioning after successful OAuth authentication.
 *
 * This function:
 * 1. Registers required webhooks
 * 2. Cleans up deprecated webhook subscriptions
 * 3. Fetches shop info (primary domain, tier)
 * 4. Creates or updates shop record in database
 * 5. Generates ingestion secret if needed
 */
export async function handleAfterAuth(
  params: AfterAuthParams,
  registerWebhooks: (params: { session: { shop: string } }) => Promise<unknown>
): Promise<void> {
  const { session, admin } = params;

  // Register webhooks
  await registerAndLogWebhooks(registerWebhooks, session);

  // Cleanup deprecated webhooks
  if (admin) {
    try {
      await cleanupDeprecatedWebhookSubscriptions(admin, session.shop);
    } catch (cleanupError) {
      logger.warn(`[Webhooks] Cleanup warning for ${session.shop}`, {
        error:
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError),
      });
    }
  }

  // Fetch shop info
  const shopInfo = admin
    ? await fetchShopInfo(admin, session.shop)
    : { primaryDomain: null, shopTier: "unknown" as ShopTierValue };

  // Upsert shop record
  await upsertShopRecord(session.shop, session.accessToken, shopInfo);
}

