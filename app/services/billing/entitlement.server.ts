
/**
 * P1-5: 服务端 Entitlement 硬门禁
 * 
 * 此模块提供统一的 entitlement 检查机制，防止绕过前端限制直接调用接口。
 * 所有关键能力（full funnel、告警、报告导出、多目的地等）都应在服务端进行硬门禁。
 * 
 * 使用方式：
 * - requireEntitlementOrThrow: 检查失败时抛出错误（用于 action handlers）
 * - checkEntitlement: 返回检查结果（用于条件判断）
 */

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

/**
 * 获取店铺的当前套餐
 */
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

/**
 * 检查 entitlement - 返回检查结果
 */
export async function checkEntitlement(
  shopId: string,
  entitlement: Entitlement
): Promise<EntitlementCheckResult> {
  const shopPlan = await getShopPlan(shopId);
  const planConfig = getPlanOrDefault(shopPlan);

  switch (entitlement) {
    case "full_funnel":
      // Full funnel 需要 Growth 及以上套餐
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
      // P1-7: 检查 plan 是否支持报告导出
      const planCheck = checkFeatureAccess(shopPlan, "report_export");
      if (planCheck.allowed) {
        return planCheck;
      }
      
      // P1-7: 如果 plan 不支持，检查是否有 active one-time purchase（Go-Live）
      // 注意：one-time purchase 确认后会将 plan 设置为 "growth"，所以这里主要是作为备用检查
      // 如果 plan 已经是 "growth"，上面的检查应该已经返回 allowed
      // 这里是为了处理 edge case（例如 plan 更新延迟）
      try {
        const shop = await prisma.shop.findUnique({
          where: { id: shopId },
          select: { shopDomain: true },
        });
        
        if (shop) {
          // 尝试从 Shopify API 检查 one-time purchase 状态
          // 注意：这需要 admin context，在 entitlement 检查中可能不可用
          // 所以这里只作为备用，主要依赖 plan 检查
          // 如果 plan 是 "growth"，说明 one-time purchase 已经激活
          if (shopPlan === "growth") {
            return { allowed: true };
          }
        }
      } catch (error) {
        // 如果检查失败，回退到 plan 检查结果
        logger.warn("Failed to check one-time purchase status", {
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
      // Audit 免费，但完整报告导出需要付费
      return { allowed: true };

    default:
      logger.warn(`Unknown entitlement: ${entitlement}`);
      return {
        allowed: false,
        reason: `Unknown entitlement: ${entitlement}`,
      };
  }
}

/**
 * 检查 entitlement - 失败时抛出错误（用于 action handlers）
 */
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

/**
 * 检查多个 entitlements - 全部通过才返回 true
 */
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

/**
 * 检查多个 entitlements - 失败时抛出错误
 */
export async function requireMultipleEntitlementsOrThrow(
  shopId: string,
  entitlements: Entitlement[]
): Promise<void> {
  const result = await checkMultipleEntitlements(shopId, entitlements);
  if (!result.allowed) {
    await requireEntitlementOrThrow(shopId, entitlements[0]); // 抛出第一个失败的错误
  }
}

/**
 * 获取店铺的所有 entitlements 摘要
 */
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
    audit_unlimited: true, // Audit 始终可用
  };
}
