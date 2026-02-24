import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import type { ShopTier } from "../utils/deprecation-dates";
import { DEPRECATION_DATES, getDateDisplayLabel } from "../utils/deprecation-dates";
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
        const data = await response.json() as { data?: { shop?: { plan?: { shopifyPlus?: boolean; partnerDevelopment?: boolean; displayName?: string } } }; errors?: Array<{ message?: string }> };
        if (data.errors) {
            logger.warn("GraphQL errors in shop plan query:", { errors: data.errors });
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
        }
        else if (plan.partnerDevelopment === true) {
            tier = "non_plus";
        }
        return {
            displayName: plan.displayName || "Unknown",
            shopifyPlus: plan.shopifyPlus === true,
            partnerDevelopment: plan.partnerDevelopment === true,
            tier,
        };
    }
    catch (error) {
        logger.error("Failed to query shop plan:", error);
        return null;
    }
}
export async function refreshShopTierWithAdmin(admin: AdminApiContext, shopId: string): Promise<RefreshTierResult> {
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
        const now = new Date();
        if (oldTier !== newTier) {
            await prisma.shop.update({
                where: { id: shopId },
                data: { 
                    shopTier: newTier,
                    shopTierLastCheckedAt: now,
                },
            });
            logger.info(`Updated shopTier from ${oldTier} to ${newTier} for shop ${shopId}`);
            return {
                tier: newTier,
                updated: true,
                planInfo,
            };
        }
        await prisma.shop.update({
            where: { id: shopId },
            data: { shopTierLastCheckedAt: now },
        });
        return {
            tier: newTier,
            updated: false,
            planInfo,
        };
    }
    catch (error) {
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
                accessTokenEncrypted: true,
                shopTier: true,
            },
        });
        if (!shop || !shop.accessTokenEncrypted) {
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
    }
    catch (error) {
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
                description: "Your store is on the Shopify Plus plan",
                deadlineDate: getDateDisplayLabel(DEPRECATION_DATES.plusAdditionalScriptsReadOnly, "exact"),
                isKnown: true,
            };
        case "non_plus":
            return {
                label: "Standard Shopify",
                description: "Your store is on a standard Shopify plan",
                deadlineDate: getDateDisplayLabel(DEPRECATION_DATES.nonPlusScriptTagExecutionOff, "exact"),
                isKnown: true,
            };
        case "unknown":
        default:
            return {
                label: "Unknown",
                description: "Unable to determine store plan, using non-Plus latest deadline (conservative)",
                deadlineDate: getDateDisplayLabel(DEPRECATION_DATES.nonPlusScriptTagExecutionOff, "exact"),
                isKnown: false,
            };
    }
}
