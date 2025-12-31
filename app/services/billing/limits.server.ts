
import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";
import { BILLING_PLANS, type PlanId, getPlanOrDefault, getPixelDestinationsLimit, getUiModulesLimit } from "./plans";
import { getMaxShops } from "./plans";

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
  shopId: string,
  shopPlan: PlanId
): Promise<PlanLimitResult> {
  const limit = getUiModulesLimit(shopPlan);

  if (limit === -1) {
    return { allowed: true, unlimited: true };
  }

  const currentCount = await prisma.uiExtensionSetting.count({
    where: {
      shopId,
      isEnabled: true,
    },
  });

  if (currentCount >= limit) {
    return {
      allowed: false,
      reason: `当前套餐最多支持 ${limit} 个 UI 模块，您已启用 ${currentCount} 个。请升级套餐或停用部分模块。`,
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

export async function checkMultiShopLimit(
  shopId: string,
  shopPlan: PlanId
): Promise<PlanLimitResult> {
  const limit = getMaxShops(shopPlan);

  if (limit === -1 || limit >= 50) {
    return { allowed: true, unlimited: true };
  }

  const { canManageMultipleShops } = await import("../multi-shop.server");
  const canManage = await canManageMultipleShops(shopId);

  if (!canManage) {
    return {
      allowed: false,
      reason: `多店管理功能需要 Agency 套餐。当前套餐：${getPlanOrDefault(shopPlan).name}`,
      current: 1,
      limit,
      unlimited: false,
    };
  }

  const shopGroups = await prisma.shopGroup.findMany({
    where: { ownerId: shopId },
    include: {
      members: {
        select: { shopId: true },
      },
    },
  });

  const uniqueShopIds = new Set<string>();
  shopGroups.forEach((group) => {
    group.members.forEach((member) => {
      uniqueShopIds.add(member.shopId);
    });
  });

  const currentCount = uniqueShopIds.size;

  if (currentCount >= limit) {
    return {
      allowed: false,
      reason: `当前套餐最多支持 ${limit} 个店铺，您已添加 ${currentCount} 个。请升级套餐。`,
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

