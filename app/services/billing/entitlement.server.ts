

import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";
import {
  type PlanId,
  getPlanOrDefault,
  getPixelDestinationsLimit,
  getUiModulesLimit,
  planSupportsFeature,
  BILLING_PLANS,
} from "./plans";
import {
  checkPixelDestinationsLimit,
  checkUiModulesLimit,
  checkFeatureAccess,
} from "./feature-gates.server";

export type Entitlement =
  | "full_funnel"
  | "alerts"
  | "report_export"
  | "reconciliation"
  | "agency"
  | "pixel_destinations"
  | "ui_modules"
  | "verification"
  | "audit_unlimited";

export interface EntitlementCheckResult {
  allowed: boolean;
  reason?: string;
  current?: number;
  limit?: number;
  requiredPlan?: string;
}

async function getShopPlan(shopId: string): Promise<PlanId> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { plan: true },
  });

  if (!shop) {
    throw new Error(`Shop not found: ${shopId}`);
  }

  return (shop.plan || "free") as PlanId;
}

export async function checkEntitlement(
  shopId: string,
  entitlement: Entitlement
): Promise<EntitlementCheckResult> {
  const shopPlan = await getShopPlan(shopId);
  const planConfig = getPlanOrDefault(shopPlan);

  switch (entitlement) {
    case "full_funnel":

      if (shopPlan === "free" || shopPlan === "starter") {
        return {
          allowed: false,
          reason: "Full Funnel 模式需要 Growth 及以上套餐",
          requiredPlan: "Growth",
        };
      }
      return { allowed: true };

    case "alerts":
      return checkFeatureAccess(shopPlan, "alerts");

    case "report_export": {

      const planCheck = checkFeatureAccess(shopPlan, "report_export");
      if (planCheck.allowed) {
        return planCheck;
      }

      try {
        const shop = await prisma.shop.findUnique({
          where: { id: shopId },
          select: { shopDomain: true },
        });

        if (shop) {

          if (shopPlan === "growth") {
            return { allowed: true };
          }
        }
      } catch (error) {

        logger.warn("Failed to check one-time purchase status (backward compatibility)", {
          shopId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return planCheck;
    }

    case "reconciliation":
      return checkFeatureAccess(shopPlan, "reconciliation");

    case "agency":
      return checkFeatureAccess(shopPlan, "agency");

    case "pixel_destinations": {
      const result = await checkPixelDestinationsLimit(shopId, shopPlan);
      return {
        ...result,
        requiredPlan: result.allowed ? undefined : "Starter",
      };
    }

    case "ui_modules": {
      const result = await checkUiModulesLimit(shopId, shopPlan);
      return {
        ...result,
        requiredPlan: result.allowed ? undefined : "Starter",
      };
    }

    case "verification":
      return checkFeatureAccess(shopPlan, "verification");

    case "audit_unlimited":

      return { allowed: true };

    default:
      logger.warn(`Unknown entitlement: ${entitlement}`);
      return {
        allowed: false,
        reason: `Unknown entitlement: ${entitlement}`,
      };
  }
}

export async function requireEntitlementOrThrow(
  shopId: string,
  entitlement: Entitlement
): Promise<void> {
  const result = await checkEntitlement(shopId, entitlement);

  if (!result.allowed) {
    const shopPlan = await getShopPlan(shopId);
    const planConfig = getPlanOrDefault(shopPlan);

    logger.warn(`Entitlement check failed`, {
      shopId,
      entitlement,
      currentPlan: planConfig.name,
      reason: result.reason,
      requiredPlan: result.requiredPlan,
    });

    throw new Response(
      JSON.stringify({
        error: "Feature not available",
        message: result.reason || `此功能需要 ${result.requiredPlan || "更高"} 套餐`,
        currentPlan: planConfig.name,
        requiredPlan: result.requiredPlan,
        entitlement,
      }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

export async function checkMultipleEntitlements(
  shopId: string,
  entitlements: Entitlement[]
): Promise<EntitlementCheckResult> {
  for (const entitlement of entitlements) {
    const result = await checkEntitlement(shopId, entitlement);
    if (!result.allowed) {
      return result;
    }
  }
  return { allowed: true };
}

export async function requireMultipleEntitlementsOrThrow(
  shopId: string,
  entitlements: Entitlement[]
): Promise<void> {
  const result = await checkMultipleEntitlements(shopId, entitlements);
  if (!result.allowed) {
    await requireEntitlementOrThrow(shopId, entitlements[0]);
  }
}

export async function getEntitlementsSummary(shopId: string): Promise<{
  [K in Entitlement]: boolean;
}> {
  const shopPlan = await getShopPlan(shopId);

  return {
    full_funnel: shopPlan !== "free" && shopPlan !== "starter",
    alerts: planSupportsFeature(shopPlan, "alerts"),
    report_export: planSupportsFeature(shopPlan, "report_export"),
    reconciliation: planSupportsFeature(shopPlan, "reconciliation"),
    agency: planSupportsFeature(shopPlan, "agency"),
    pixel_destinations: (await checkPixelDestinationsLimit(shopId, shopPlan)).allowed,
    ui_modules: (await checkUiModulesLimit(shopId, shopPlan)).allowed,
    verification: planSupportsFeature(shopPlan, "verification"),
    audit_unlimited: true,
  };
}
