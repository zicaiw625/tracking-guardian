
import type { Middleware } from "./types";
import { checkFeatureAccess } from "../services/billing/feature-gates.server";
import { normalizePlanId, type PlanId } from "../services/billing/plans";
import prisma from "../db.server";
import { json } from "@remix-run/node";

export interface PlanGateConfig {
  feature: "verification" | "alerts" | "reconciliation" | "agency";
  redirectTo?: string;
  showUpgradePrompt?: boolean;
}

/**
 * 套餐权限中间件
 * 在路由级别检查用户是否有权限访问特定功能
 */
export function withPlanGate(config: PlanGateConfig): Middleware {
  return async (context, next) => {
    const { request } = context;

    // 从 session 中获取 shop 信息
    try {
      const { authenticate } = await import("../shopify.server");
      const { session } = await authenticate.admin(request);
      const shopDomain = session.shop;

      const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: { id: true, plan: true },
      });

      if (!shop) {
        return json({ error: "Shop not found" }, { status: 404 });
      }

      const planId = normalizePlanId(shop.plan || "free") as PlanId;
      const gateResult = checkFeatureAccess(planId, config.feature);

      if (!gateResult.allowed) {
        // 如果需要重定向
        if (config.redirectTo) {
          return Response.redirect(new URL(config.redirectTo, request.url));
        }

        // 如果需要显示升级提示，返回特殊响应
        if (config.showUpgradePrompt) {
          return json(
            {
              error: "Feature requires upgrade",
              gateResult,
              currentPlan: planId,
              requiredFeature: config.feature,
            },
            { status: 403 }
          );
        }

        // 默认返回 403
        return json(
          {
            error: gateResult.reason || "Feature not available in current plan",
            gateResult,
          },
          { status: 403 }
        );
      }

      // 权限通过，继续执行
      return next(context);
    } catch (error) {
      // 认证失败等错误，继续执行（由其他中间件处理）
      return next(context);
    }
  };
}

/**
 * 检查功能访问权限（用于在 loader/action 中使用）
 */
export async function checkPlanGate(
  shopId: string,
  feature: "verification" | "alerts" | "reconciliation" | "agency"
): Promise<{ allowed: boolean; reason?: string; currentPlan?: PlanId }> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { plan: true },
  });

  if (!shop) {
    return { allowed: false, reason: "Shop not found" };
  }

  const planId = normalizePlanId(shop.plan || "free") as PlanId;
  const gateResult = checkFeatureAccess(planId, feature);

  return {
    allowed: gateResult.allowed,
    reason: gateResult.reason,
    currentPlan: planId,
  };
}

