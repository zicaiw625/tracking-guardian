
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

export function withPlanGate(config: PlanGateConfig): Middleware {
  return async (context, next) => {
    const { request } = context;

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

        if (config.redirectTo) {
          return Response.redirect(new URL(config.redirectTo, request.url));
        }

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

        return json(
          {
            error: gateResult.reason || "Feature not available in current plan",
            gateResult,
          },
          { status: 403 }
        );
      }

      return next(context);
    } catch (error) {

      logger.warn("Plan gate authentication check failed", error);
      return next(context);
    }
  };
}

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

