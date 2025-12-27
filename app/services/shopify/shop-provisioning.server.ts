

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

  if (existingShop && !existingShop.ingestionSecret) {
    const secretForExisting = generateEncryptedIngestionSecret();
    await prisma.shop.update({
      where: { shopDomain },
      data: { ingestionSecret: secretForExisting.encrypted },
    });
  }
}

export async function handleAfterAuth(
  params: AfterAuthParams
): Promise<void> {
  const { session, admin } = params;

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

  const shopInfo = admin
    ? await fetchShopInfo(admin, session.shop)
    : { primaryDomain: null, shopTier: "unknown" as ShopTierValue };

  await upsertShopRecord(session.shop, session.accessToken, shopInfo);
}

