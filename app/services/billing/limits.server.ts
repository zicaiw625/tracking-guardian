import prisma from "~/db.server";
import { type PlanId, getPlanOrDefault, getPixelDestinationsLimit, getUiModulesLimit } from "./plans";
import { getMaxShops } from "./plans";
import { canManageMultipleShops } from "../multi-shop.server";
import { logger } from "~/utils/logger.server";

function checkShopGroupModel() {
  const model = (prisma as any).shopGroup;
  if (!model || typeof model.findMany !== "function") {
    logger.warn("shopGroup model not available (migration not applied)");
    return null;
  }
  return model;
}

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
  return {
    allowed: false,
    reason: "UI 模块功能已移除",
    current: 0,
    limit: 0,
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
  const model = checkShopGroupModel();
  if (!model) {
    return {
      allowed: true,
      current: 0,
      limit,
      unlimited: false,
    };
  }
  const shopGroups = await model.findMany({
    where: { ownerId: shopId },
    include: {
      ShopGroupMember: {
        select: { shopId: true },
      },
    },
  });
  const uniqueShopIds = new Set<string>();
  shopGroups.forEach((group: { ShopGroupMember: { shopId: string }[] }) => {
    group.ShopGroupMember.forEach((member: { shopId: string }) => {
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
