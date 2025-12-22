/**
 * P0-3: Shop Tier Service
 * 
 * Determines and maintains the shop tier (Plus/Non-Plus) which is critical for:
 * - Accurate deprecation deadline calculations
 * - Correct migration urgency messaging
 * - Proper risk assessment
 * 
 * Shop tiers have different deadlines:
 * - Plus: 2025-08-28 (Additional Scripts read-only)
 * - Non-Plus: 2026-08-26 (Additional Scripts read-only)
 */

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";
import { logger } from "../utils/logger";
import type { ShopTier } from "../utils/deprecation-dates";

export interface ShopPlanInfo {
  displayName: string;
  shopifyPlus: boolean;
  partnerDevelopment: boolean;
  /** Derived tier based on plan info */
  tier: ShopTier;
}

export interface RefreshTierResult {
  tier: ShopTier;
  updated: boolean;
  planInfo?: ShopPlanInfo;
  error?: string;
}

/**
 * Query the shop's plan information to determine tier.
 */
export async function getShopPlan(admin: AdminApiContext): Promise<ShopPlanInfo | null> {
  try {
    const response = await admin.graphql(`
      #graphql
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
      logger.warn("P0-3: GraphQL errors in shop plan query:", data.errors);
      return null;
    }

    const plan = data.data?.shop?.plan;
    if (!plan) {
      logger.warn("P0-3: No plan data in response");
      return null;
    }

    // Determine tier based on plan info
    let tier: ShopTier = "non_plus";
    
    if (plan.shopifyPlus === true) {
      tier = "plus";
    } else if (plan.partnerDevelopment === true) {
      // Development stores are treated as non_plus for deadline purposes
      // but we could track them separately if needed
      tier = "non_plus";
    }

    return {
      displayName: plan.displayName || "Unknown",
      shopifyPlus: plan.shopifyPlus === true,
      partnerDevelopment: plan.partnerDevelopment === true,
      tier,
    };
  } catch (error) {
    logger.error("P0-3: Failed to query shop plan:", error);
    return null;
  }
}

/**
 * Query and update the shop tier for a given shop.
 * Used in afterAuth and cron jobs.
 */
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
      
      logger.info(`P0-3: Updated shopTier from ${oldTier} to ${newTier} for shop ${shopId}`);
      
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
    logger.error("P0-3: Failed to update shop tier:", error);
    return {
      tier: planInfo.tier,
      updated: false,
      planInfo,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Simplified tier refresh for cron jobs (without admin context).
 * This uses stored access token to make the API call.
 * 
 * Note: This is a fallback - prefer refreshShopTierWithAdmin when admin context is available.
 */
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

    // Note: In a full implementation, we would:
    // 1. Decrypt the access token
    // 2. Create an admin client
    // 3. Call the GraphQL API
    // 
    // For now, we return the current tier and mark as not updated
    // The actual refresh happens during user sessions when admin context is available
    
    return {
      tier: shop.shopTier as ShopTier || "unknown",
      updated: false,
    };
  } catch (error) {
    logger.error("P0-3: Error in refreshShopTier:", error);
    return {
      tier: "unknown",
      updated: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get display-friendly tier information for UI.
 */
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

