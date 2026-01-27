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
      reason: `当前套餐最多支持 ${limit} 个像素目的地，您已配置 ${currentCount} 个。请升级套餐或停用部分配置。`,
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
    reason: "UI 模块功能已移除",
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
    reason: "多店管理功能已移除",
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
