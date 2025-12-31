

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
import { scanShopTracking } from "../scanner.server";
import { batchCreateAuditAssets } from "../audit-asset.server";
import { generateMigrationActions } from "../scanner/migration-actions";
import { refreshTypOspStatus } from "../checkout-profile.server";
import { generateMigrationTimeline, calculateAllAssetPriorities } from "../migration-priority.server";

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

async function runPostInstallScan(
  shopDomain: string,
  shopId: string,
  admin: AdminApiContext
): Promise<void> {
  const startTime = Date.now();
  const MAX_SCAN_TIME_MS = 10000;
  const FAST_TRACK_MS = 8000;

  try {
    logger.info(`[PostInstall] Starting automatic health check for ${shopDomain}`);

    const scanPromise = Promise.allSettled([

      (async () => {
        return await refreshTypOspStatus(admin, shopId);
      })(),

      scanShopTracking(admin, shopId, {
        force: false,
        cacheTtlMs: 0,
      }),
    ]);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Scan timeout")), MAX_SCAN_TIME_MS);
    });

    let typOspResult: PromiseSettledResult<any> | null = null;
    let scanResult: PromiseSettledResult<any> | null = null;

    try {
      const results = await Promise.race([scanPromise, timeoutPromise]);
      [typOspResult, scanResult] = results;
    } catch (timeoutError) {
      logger.warn(`[PostInstall] Scan timeout for ${shopDomain}, proceeding with partial results`, {
        elapsedMs: Date.now() - startTime,
      });

      try {
        const partialResults = await Promise.allSettled([
          Promise.resolve(typOspResult),
          Promise.resolve(scanResult),
        ]);
        if (partialResults[0].status === "fulfilled") typOspResult = partialResults[0];
        if (partialResults[1].status === "fulfilled") scanResult = partialResults[1];
      } catch {

      }
    }

    if (typOspResult?.status === "fulfilled") {
      logger.info(`[PostInstall] TypOsp status checked for ${shopDomain}`, {
        enabled: typOspResult.value.typOspPagesEnabled,
        status: typOspResult.value.status,
      });
    } else if (typOspResult?.status === "rejected") {
      logger.warn(`[PostInstall] Failed to check typOsp status for ${shopDomain}`, {
        error: typOspResult.reason instanceof Error ? typOspResult.reason.message : String(typOspResult.reason),
      });
    }

    let scanData: Awaited<ReturnType<typeof scanShopTracking>> | null = null;
    if (scanResult?.status === "fulfilled") {
      scanData = scanResult.value;
      logger.info(`[PostInstall] Scan completed for ${shopDomain}`, {
        scriptTagsFound: scanData.scriptTags.length,
        platformsIdentified: scanData.identifiedPlatforms.length,
        riskScore: scanData.riskScore,
        elapsedMs: Date.now() - startTime,
      });
    } else if (scanResult?.status === "rejected") {
      logger.warn(`[PostInstall] Scan failed for ${shopDomain}`, {
        error: scanResult.reason instanceof Error ? scanResult.reason.message : String(scanResult.reason),
      });
    }

    const elapsedMs = Date.now() - startTime;
    const hasTimeForAssets = elapsedMs < FAST_TRACK_MS;
    const hasScanData = scanData && (scanData.scriptTags.length > 0 || scanData.identifiedPlatforms.length > 0);

    if (hasTimeForAssets && hasScanData) {
      try {

        const shop = await prisma.shop.findUnique({
          where: { id: shopId },
          select: { shopTier: true },
        });

        const shopTier = (shop?.shopTier as "plus" | "non_plus" | null) || null;
        const migrationActions = generateMigrationActions(scanData, shopTier || "unknown");

        const auditAssets = migrationActions.map((action) => ({
          displayName: action.title,
          category: action.type === "pixel" ? "pixel" : "other",
          platform: action.platform || null,
          sourceType: "api_scan" as const,
          riskLevel: action.priority === "high" ? "high" : action.priority === "medium" ? "medium" : "low",
          suggestedMigration: action.type === "pixel" ? "web_pixel" : action.type === "ui_extension" ? "ui_extension" : "none",
          migrationStatus: "pending" as const,
          details: {
            scriptTagId: action.scriptTagId,
            webPixelGid: action.webPixelGid,
            description: action.description,
            estimatedTimeMinutes: action.estimatedTimeMinutes,
          },
        }));

        if (auditAssets.length > 0) {
          const latestScan = await prisma.scanReport.findFirst({
            where: { shopId },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });

          const result = await batchCreateAuditAssets(shopId, auditAssets, latestScan?.id);
          logger.info(`[PostInstall] Created ${result.created} audit assets, updated ${result.updated} for ${shopDomain}`, {
            elapsedMs: Date.now() - startTime,
          });

          if (result.created > 0 || result.updated > 0) {

            (async () => {
              try {
                await calculateAllAssetPriorities(shopId, shopTier);
                logger.info(`[PostInstall] Calculated priorities for audit assets in ${shopDomain}`);
              } catch (priorityError) {
                logger.warn(`[PostInstall] Failed to calculate priorities for ${shopDomain}`, {
                  error: priorityError instanceof Error ? priorityError.message : String(priorityError),
                });
              }
            })().catch(() => {

            });

            (async () => {
              try {
                const migrationTimeline = await generateMigrationTimeline(shopId);
                logger.info(`[PostInstall] Migration timeline calculated for ${shopDomain}`, {
                  totalEstimatedTime: migrationTimeline.totalEstimatedTime,
                  assetsCount: migrationTimeline.assets.length,
                  criticalPathLength: migrationTimeline.criticalPath.length,
                });
              } catch (error) {
                logger.warn(`[PostInstall] Failed to calculate migration timeline for ${shopDomain}`, {
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            })().catch(() => {

            });
          }
        }
      } catch (error) {
        logger.warn(`[PostInstall] Failed to create audit assets for ${shopDomain}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else if (hasScanData && !hasTimeForAssets) {

      logger.info(`[PostInstall] Time limit reached, deferring audit asset creation for ${shopDomain}`);
      (async () => {
        try {

          const shop = await prisma.shop.findUnique({
            where: { id: shopId },
            select: { shopTier: true },
          });

          const shopTier = (shop?.shopTier as "plus" | "non_plus" | null) || null;
          const migrationActions = generateMigrationActions(scanData!, shopTier || "unknown");

          const auditAssets = migrationActions.map((action) => ({
            displayName: action.title,
            category: action.type === "pixel" ? "pixel" : "other",
            platform: action.platform || null,
            sourceType: "api_scan" as const,
            riskLevel: action.priority === "high" ? "high" : action.priority === "medium" ? "medium" : "low",
            suggestedMigration: action.type === "pixel" ? "web_pixel" : action.type === "ui_extension" ? "ui_extension" : "none",
            migrationStatus: "pending" as const,
            details: {
              scriptTagId: action.scriptTagId,
              webPixelGid: action.webPixelGid,
              description: action.description,
              estimatedTimeMinutes: action.estimatedTimeMinutes,
            },
          }));

          if (auditAssets.length > 0) {
            const latestScan = await prisma.scanReport.findFirst({
              where: { shopId },
              orderBy: { createdAt: "desc" },
              select: { id: true },
            });

            await batchCreateAuditAssets(shopId, auditAssets, latestScan?.id);
            logger.info(`[PostInstall] Deferred audit assets created for ${shopDomain}`);
          }
        } catch (error) {
          logger.warn(`[PostInstall] Failed to create deferred audit assets for ${shopDomain}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })().catch(() => {

      });
    }

    const totalElapsedMs = Date.now() - startTime;
    logger.info(`[PostInstall] Health check completed for ${shopDomain}`, {
      elapsedMs: totalElapsedMs,
      withinTimeout: totalElapsedMs < MAX_SCAN_TIME_MS,
      hasScanData: !!scanData,
    });
  } catch (error) {
    logger.warn(`[PostInstall] Health check failed for ${shopDomain}`, {
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - startTime,
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

  const existingShop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true, installedAt: true },
  });

  const isNewInstall = !existingShop || !existingShop.installedAt;

  await upsertShopRecord(session.shop, session.accessToken, shopInfo);

  if (isNewInstall && admin) {
    const shop = await prisma.shop.findUnique({
      where: { shopDomain: session.shop },
      select: { id: true },
    });

    if (shop) {

      runPostInstallScan(session.shop, shop.id, admin).catch((error) => {
        logger.error(`[PostInstall] Failed to run post-install scan for ${session.shop}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }
}

