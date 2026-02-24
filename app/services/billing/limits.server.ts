import prisma from "~/db.server";
import { type PlanId, getPixelDestinationsLimit } from "./plans";


export interface PlanLimitResult {
  allowed: boolean;
  reason?: string;
  current?: number;
  limit?: number;
  unlimited?: boolean;
}

export async function checkPixelDestinationsLimit(
  shopId: string,
  shopPlan: PlanId
): Promise<PlanLimitResult> {
  const limit = getPixelDestinationsLimit(shopPlan);
  if (limit === -1) {
    return { allowed: true, unlimited: true };
  }
  const currentCount = await prisma.pixelConfig.count({
    where: {
      shopId,
      isActive: true,
      serverSideEnabled: true,
    },
  });
  if (currentCount >= limit) {
    return {
      allowed: false,
      reason: `Pixel destinations limit reached: ${currentCount}/${limit}`,
      current: currentCount,
      limit,
      unlimited: false,
    };
  }
  return {
    allowed: true,
    current: currentCount,
    limit,
    unlimited: false,
  };
}

export async function checkUiModulesLimit(
  _shopId: string,
  _shopPlan: PlanId
): Promise<PlanLimitResult> {
  return {
    allowed: false,
    reason: "UI modules feature removed",
    current: 0,
    limit: 0,
    unlimited: false,
  };
}

export async function checkMultiShopLimit(
  _shopId: string,
  _shopPlan: PlanId
): Promise<PlanLimitResult> {
  return {
    allowed: false,
    reason: "Multi-shop management feature removed",
    current: 1,
    limit: 1,
    unlimited: false,
  };
}

export async function getAllLimitsSummary(
  shopId: string,
  shopPlan: PlanId
): Promise<{
  pixelDestinations: PlanLimitResult;
  uiModules: PlanLimitResult;
  multiShop: PlanLimitResult;
}> {
  const [pixelLimit, uiLimit, multiShopLimit] = await Promise.all([
    checkPixelDestinationsLimit(shopId, shopPlan),
    checkUiModulesLimit(shopId, shopPlan),
    checkMultiShopLimit(shopId, shopPlan),
  ]);
  return {
    pixelDestinations: pixelLimit,
    uiModules: uiLimit,
    multiShop: multiShopLimit,
  };
}
