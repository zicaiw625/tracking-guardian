import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";
import { logger } from "../utils/logger";
import type { ShopTier } from "../utils/deprecation-dates";

export interface ShopPlanInfo {
  displayName: string;
  shopifyPlus: boolean;
  partnerDevelopment: boolean;
  tier: ShopTier;
}

export interface RefreshTierResult {
  tier: ShopTier;
  updated: boolean;
  planInfo?: ShopPlanInfo;
  error?: string;
}

export async function getShopPlan(admin: AdminApiContext): Promise<ShopPlanInfo | null> {
  try {
    const response = await admin.graphql(`
      query GetShopPlan {
        shop {
          plan {
            displayName
            partnerDevelopment
            shopifyPlus
          }
        }
      }
    `);

    const data = await response.json();
    
    if (data.errors) {
      logger.warn("GraphQL errors in shop plan query:", data.errors);
      return null;
    }

    const plan = data.data?.shop?.plan;
    if (!plan) {
      logger.warn("No plan data in response");
      return null;
    }

    let tier: ShopTier = "non_plus";
    
    if (plan.shopifyPlus === true) {
      tier = "plus";
    } else if (plan.partnerDevelopment === true) {
      tier = "non_plus";
    }

    return {
      displayName: plan.displayName || "Unknown",
      shopifyPlus: plan.shopifyPlus === true,
      partnerDevelopment: plan.partnerDevelopment === true,
      tier,
    };
  } catch (error) {
    logger.error("Failed to query shop plan:", error);
    return null;
  }
}

export async function refreshShopTierWithAdmin(
  admin: AdminApiContext,
  shopId: string
): Promise<RefreshTierResult> {
  const planInfo = await getShopPlan(admin);
  
  if (!planInfo) {
    return {
      tier: "unknown",
      updated: false,
      error: "Failed to query shop plan",
    };
  }

  try {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { shopTier: true },
    });

    const oldTier = shop?.shopTier || "unknown";
    const newTier = planInfo.tier;
    
    if (oldTier !== newTier) {
      await prisma.shop.update({
        where: { id: shopId },
        data: { shopTier: newTier },
      });
      
      logger.info(`Updated shopTier from ${oldTier} to ${newTier} for shop ${shopId}`);
      
      return {
        tier: newTier,
        updated: true,
        planInfo,
      };
    }

    return {
      tier: newTier,
      updated: false,
      planInfo,
    };
  } catch (error) {
    logger.error("Failed to update shop tier:", error);
    return {
      tier: planInfo.tier,
      updated: false,
      planInfo,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function refreshShopTier(shopId: string): Promise<RefreshTierResult> {
  try {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: {
        shopDomain: true,
        accessToken: true,
        shopTier: true,
      },
    });

    if (!shop || !shop.accessToken) {
      return {
        tier: shop?.shopTier as ShopTier || "unknown",
        updated: false,
        error: "No access token available",
      };
    }

    return {
      tier: shop.shopTier as ShopTier || "unknown",
      updated: false,
    };
  } catch (error) {
    logger.error("Error in refreshShopTier:", error);
    return {
      tier: "unknown",
      updated: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export function getTierDisplayInfo(tier: ShopTier): {
  label: string;
  description: string;
  deadlineDate: string;
  isKnown: boolean;
} {
  switch (tier) {
    case "plus":
      return {
        label: "Shopify Plus",
        description: "您的店铺使用 Shopify Plus 计划",
        deadlineDate: "2025-08-28",
        isKnown: true,
      };
    case "non_plus":
      return {
        label: "Standard Shopify",
        description: "您的店铺使用标准 Shopify 计划",
        deadlineDate: "2026-08-26",
        isKnown: true,
      };
    case "unknown":
    default:
      return {
        label: "未知",
        description: "无法确认店铺版本，按非 Plus 最晚日期提示（保守）",
        deadlineDate: "2026-08-26",
        isKnown: false,
      };
  }
}
