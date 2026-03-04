import prisma from "~/db.server";
import { normalizePlanId, type PlanId } from "./plans";

export function resolveEffectivePlan(
  plan: string | null | undefined,
  entitledUntil: Date | null | undefined,
  now: Date = new Date()
): PlanId {
  const normalizedPlan = normalizePlanId(plan || "free");
  if (entitledUntil && entitledUntil <= now) {
    return "free";
  }
  return normalizedPlan;
}

export async function getEffectivePlanByShopId(shopId: string, now: Date = new Date()): Promise<PlanId> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { plan: true, entitledUntil: true },
  });
  if (!shop) {
    return "free";
  }
  return resolveEffectivePlan(shop.plan, shop.entitledUntil, now);
}

export async function getEffectivePlanByShopDomain(
  shopDomain: string,
  now: Date = new Date()
): Promise<PlanId> {
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { plan: true, entitledUntil: true },
  });
  if (!shop) {
    return "free";
  }
  return resolveEffectivePlan(shop.plan, shop.entitledUntil, now);
}
