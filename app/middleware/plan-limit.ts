
import type { Middleware } from "./types";
import { checkPixelDestinationsLimit, checkUiModulesLimit, checkMultiShopLimit } from "../services/billing/limits.server";
import { normalizePlanId, type PlanId } from "../services/billing/plans";
import prisma from "../db.server";
import { json } from "@remix-run/node";

export interface PlanLimitConfig {
  limitType: "pixel_destinations" | "ui_modules" | "multi_shop";
  redirectTo?: string;
  showUpgradePrompt?: boolean;
}

export function withPlanLimit(config: PlanLimitConfig): Middleware {
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

      let limitResult;
      switch (config.limitType) {
        case "pixel_destinations":
          limitResult = await checkPixelDestinationsLimit(shop.id, planId);
          break;
        case "ui_modules":
          limitResult = await checkUiModulesLimit(shop.id, planId);
          break;
        case "multi_shop":
          limitResult = await checkMultiShopLimit(shop.id, planId);
          break;
        default:
          return next(context);
      }

      if (!limitResult.allowed) {

        if (config.redirectTo) {
          return Response.redirect(new URL(config.redirectTo, request.url));
        }

        if (config.showUpgradePrompt) {
          return json(
            {
              error: "Plan limit exceeded",
              limitResult,
              currentPlan: planId,
              limitType: config.limitType,
            },
            { status: 403 }
          );
        }

        return json(
          {
            error: limitResult.reason || "Plan limit exceeded",
            limitResult,
          },
          { status: 403 }
        );
      }

      return next(context);
    } catch (error) {

      return next(context);
    }
  };
}

