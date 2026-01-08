import prisma from "../../db.server";
import { refreshTypOspStatusWithOfflineToken } from "../../services/checkout-profile.server";
import { refreshShopTier } from "../../services/shop-tier.server";
import type { ShopStatusRefreshResult, CronLogger } from "../types";

export async function refreshAllShopsStatus(
  cronLogger: CronLogger
): Promise<ShopStatusRefreshResult> {
  let tierUpdates = 0;
  let typOspUpdates = 0;
  let typOspUnknown = 0;
  const typOspUnknownReasons: Record<string, number> = {};
  let errors = 0;

  const staleThreshold = new Date(Date.now() - 6 * 60 * 60 * 1000);

  const shopsToRefresh = await prisma.shop.findMany({
    where: {
      isActive: true,
      OR: [
        { typOspLastCheckedAt: null },
        { typOspLastCheckedAt: { lt: staleThreshold } },
        { typOspUpdatedAt: null },
        { typOspUpdatedAt: { lt: staleThreshold } },
        { shopTier: "unknown" },
        { shopTier: null },
      ],
    },
    select: {
      id: true,
      shopDomain: true,
      shopTier: true,
      typOspPagesEnabled: true,
      typOspLastCheckedAt: true,
      typOspUpdatedAt: true,
    },
    take: 50,
  });

  cronLogger.info(`Found ${shopsToRefresh.length} shops needing status refresh`);

  for (const shop of shopsToRefresh) {
    try {

      const tierResult = await refreshShopTier(shop.id);
      if (tierResult.updated) {
        tierUpdates++;
        cronLogger.info(`Updated shopTier for ${shop.shopDomain}`, {
          oldTier: shop.shopTier,
          newTier: tierResult.tier,
        });
      }

      const typOspResult = await refreshTypOspStatusWithOfflineToken(shop.id, shop.shopDomain);

      if (typOspResult.status === "unknown") {
        typOspUnknown++;
        const reason = typOspResult.unknownReason || "UNKNOWN";
        typOspUnknownReasons[reason] = (typOspUnknownReasons[reason] || 0) + 1;

        cronLogger.debug(`TYP/OSP unknown for ${shop.shopDomain}`, {
          reason: typOspResult.unknownReason,
          error: typOspResult.error,
        });
      } else if (typOspResult.typOspPagesEnabled !== shop.typOspPagesEnabled) {
        typOspUpdates++;
        cronLogger.info(`Updated typOspPagesEnabled for ${shop.shopDomain}`, {
          oldValue: shop.typOspPagesEnabled,
          newValue: typOspResult.typOspPagesEnabled,
          status: typOspResult.status,
        });
      }
    } catch (error) {
      errors++;
      cronLogger.warn(`Failed to refresh status for ${shop.shopDomain}:`, {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  if (Object.keys(typOspUnknownReasons).length > 0) {
    cronLogger.info(`TYP/OSP unknown reasons distribution:`, typOspUnknownReasons);
  }

  return {
    shopsProcessed: shopsToRefresh.length,
    tierUpdates,
    typOspUpdates,
    typOspUnknown,
    typOspUnknownReasons,
    errors,
  };
}
