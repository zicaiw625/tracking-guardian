import type { Middleware, MiddlewareContext, MiddlewareResult } from "./types";
import { checkPixelDestinationsLimit, checkUiModulesLimit, checkMultiShopLimit } from "../services/billing/limits.server";
import { normalizePlanId, type PlanId } from "../services/billing/plans";
import prisma from "../db.server";
import { json, redirect } from "@remix-run/node";
import { isSafeRedirectPath } from "../utils/redirect-validation.server";
import { logger } from "../utils/logger.server";

export interface PlanLimitConfig {
  limitType: "pixel_destinations" | "ui_modules" | "multi_shop";
  redirectTo?: string;
  showUpgradePrompt?: boolean;
}

export function withPlanLimit(config: PlanLimitConfig): Middleware {
  return async (context: MiddlewareContext): Promise<MiddlewareResult> => {
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
        return { continue: false, response: json({ error: "Shop not found" }, { status: 404 }) };
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
          return { continue: true, context };
      }
      if (!limitResult.allowed) {
        if (config.redirectTo) {
          if (!isSafeRedirectPath(config.redirectTo)) {
            throw new Error("redirectTo must be a safe relative path");
          }
          const redirectUrl = new URL(config.redirectTo, request.url).toString();
          return { continue: false, response: redirect(redirectUrl) };
        }
        if (config.showUpgradePrompt) {
          return { continue: false, response: json(
            {
              error: "Plan limit exceeded",
              limitResult,
              currentPlan: planId,
              limitType: config.limitType,
            },
            { status: 403 }
          ) };
        }
        return { continue: false, response: json(
          {
            error: limitResult.reason || "Plan limit exceeded",
            limitResult,
          },
          { status: 403 }
        ) };
      }
      return { continue: true, context };
    } catch (error) {
      logger.warn("Plan limit check failed", {
        error: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : "Unknown",
      });
      return { continue: true, context };
    }
  };
}
