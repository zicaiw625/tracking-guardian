import { randomUUID } from "crypto";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { extractPlatformFromPayload } from "../utils/common";
import { BILLING_PLANS, getMaxShops } from "./billing/plans";
import type { PlanId } from "./billing/plans";

export interface ShopGroupInfo {
  id: string;
  name: string;
  ownerId: string;
  memberCount: number;
  createdAt: Date;
}

export interface ShopGroupMemberInfo {
  id: string;
  shopId: string;
  shopDomain: string;
  role: "owner" | "admin" | "member";
  canEditSettings: boolean;
  canViewReports: boolean;
  canManageBilling: boolean;
  joinedAt: Date;
}

export interface ShopGroupDetails extends ShopGroupInfo {
  members: ShopGroupMemberInfo[];
}

export interface AggregatedStats {
  totalOrders: number;
  totalRevenue: number;
  averageMatchRate: number;
  platformBreakdown: Record<string, { orders: number; revenue: number }>;
}

export async function canManageMultipleShops(shopId: string): Promise<boolean> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { plan: true },
  });
  if (!shop) return false;
  const planId = shop.plan as PlanId;
  return getMaxShops(planId) > 1;
}

export async function getMaxShopsForShop(shopId: string): Promise<number> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { plan: true },
  });
  if (!shop) return 1;
  return getMaxShops(shop.plan as PlanId);
}

export async function createShopGroup(
  ownerId: string,
  name: string
): Promise<ShopGroupInfo | null> {
  const canManage = await canManageMultipleShops(ownerId);
  if (!canManage) {
    logger.warn(`Shop ${ownerId} cannot manage multiple shops (plan limitation)`);
    return null;
  }
  const existingCount = await (prisma as any).shopGroup.count({
    where: { ownerId },
  });
  const maxShops = await getMaxShopsForShop(ownerId);
  if (existingCount >= maxShops) {
    logger.warn(`Shop ${ownerId} has reached maximum groups limit`);
    return null;
  }
  const group = await (prisma as any).shopGroup.create({
    data: {
      id: randomUUID(),
      name,
      ownerId,
      updatedAt: new Date(),
      ShopGroupMember: {
        create: {
          id: randomUUID(),
          shopId: ownerId,
          role: "owner",
          canEditSettings: true,
          canViewReports: true,
          canManageBilling: true,
        },
      },
    },
    include: {
      _count: { select: { ShopGroupMember: true } },
    },
  });
  logger.info(`Shop group created: ${group.id} by ${ownerId}`);
  return {
    id: group.id,
    name: group.name,
    ownerId: group.ownerId,
    memberCount: group._count?.ShopGroupMember ?? 0,
    createdAt: group.createdAt,
  };
}

export async function getShopGroups(ownerId: string): Promise<ShopGroupInfo[]> {
  const groups = await (prisma as any).shopGroup.findMany({
    where: { ownerId },
    include: {
      _count: { select: { ShopGroupMember: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return groups.map((group: { id: string; name: string; ownerId: string; _count: { ShopGroupMember: number }; createdAt: Date }) => ({
    id: group.id,
    name: group.name,
    ownerId: group.ownerId,
    memberCount: group._count.ShopGroupMember,
    createdAt: group.createdAt,
  }));
}

export async function getGroupMemberships(shopId: string): Promise<ShopGroupInfo[]> {
  const memberships = await (prisma as any).shopGroupMember.findMany({
    where: { shopId },
    include: {
      ShopGroup: {
        include: {
          _count: { select: { ShopGroupMember: true } },
        },
      },
    },
  });
  return memberships.map((m: { ShopGroup: { id: string; name: string; ownerId: string; _count: { ShopGroupMember: number }; createdAt: Date } }) => ({
    id: m.ShopGroup.id,
    name: m.ShopGroup.name,
    ownerId: m.ShopGroup.ownerId,
    memberCount: m.ShopGroup._count.ShopGroupMember,
    createdAt: m.ShopGroup.createdAt,
  }));
}

export async function getShopGroupDetails(
  groupId: string,
  requesterId: string
): Promise<ShopGroupDetails | null> {
  const group = await (prisma as any).shopGroup.findUnique({
    where: { id: groupId },
    include: {
      _count: { select: { ShopGroupMember: true } },
      ShopGroupMember: {
        include: {
        },
      },
    },
  });
  if (!group) return null;
  const requesterMembership = group.ShopGroupMember.find((m: { shopId: string }) => m.shopId === requesterId);
  if (!requesterMembership && group.ownerId !== requesterId) {
    return null;
  }
  const memberShopIds = group.ShopGroupMember.map((m: { shopId: string }) => m.shopId);
  const shops = await prisma.shop.findMany({
    where: { id: { in: memberShopIds } },
    select: { id: true, shopDomain: true },
  });
  const shopMap = new Map(shops.map(s => [s.id, s.shopDomain]));
  const members: ShopGroupMemberInfo[] = group.ShopGroupMember.map((m: { id: string; shopId: string; role?: string; canEditSettings?: boolean; canViewReports?: boolean; canManageBilling?: boolean; createdAt: Date }) => ({
    id: m.id,
    shopId: m.shopId,
    shopDomain: shopMap.get(m.shopId) || "Unknown",
    role: m.role as "owner" | "admin" | "member",
    canEditSettings: m.canEditSettings,
    canViewReports: m.canViewReports,
    canManageBilling: m.canManageBilling,
    joinedAt: m.createdAt,
  }));
  return {
    id: group.id,
    name: group.name,
    ownerId: group.ownerId,
    memberCount: group._count.ShopGroupMember,
    createdAt: group.createdAt,
    members,
  };
}

export async function addShopToGroup(
  groupId: string,
  shopId: string,
  addedBy: string,
  options: {
    role?: "admin" | "member";
    canEditSettings?: boolean;
    canViewReports?: boolean;
    canManageBilling?: boolean;
  } = {}
): Promise<boolean> {
  const group = await (prisma as any).shopGroup.findUnique({
    where: { id: groupId },
    include: {
      ShopGroupMember: true,
      _count: { select: { ShopGroupMember: true } },
    },
  });
  if (!group) return false;
  const adderMembership = group.ShopGroupMember.find((m: { shopId: string; role?: string }) => m.shopId === addedBy);
  if (!adderMembership || (adderMembership.role !== "owner" && adderMembership.role !== "admin")) {
    if (group.ownerId !== addedBy) {
      logger.warn(`Shop ${addedBy} cannot add members to group ${groupId}`);
      return false;
    }
  }
  const maxShops = await getMaxShopsForShop(group.ownerId);
  if (group._count.ShopGroupMember >= maxShops) {
    logger.warn(`Group ${groupId} has reached maximum members limit`);
    return false;
  }
  const existingMember = group.ShopGroupMember.find((m: { shopId: string }) => m.shopId === shopId);
  if (existingMember) {
    logger.info(`Shop ${shopId} is already in group ${groupId}`);
    return true;
  }
  await (prisma as any).shopGroupMember.create({
    data: {
      id: randomUUID(),
      groupId,
      shopId,
      role: options.role || "member",
      canEditSettings: options.canEditSettings ?? false,
      canViewReports: options.canViewReports ?? true,
      canManageBilling: options.canManageBilling ?? false,
    },
  });
  logger.info(`Shop ${shopId} added to group ${groupId} by ${addedBy}`);
  return true;
}

export async function removeShopFromGroup(
  groupId: string,
  shopId: string,
  removedBy: string
): Promise<boolean> {
  const group = await (prisma as any).shopGroup.findUnique({
    where: { id: groupId },
    include: { ShopGroupMember: true },
  });
  if (!group) return false;
  const removerMembership = group.ShopGroupMember.find((m: { shopId: string; role?: string }) => m.shopId === removedBy);
  const isOwner = group.ownerId === removedBy;
  if (!isOwner && (!removerMembership || removerMembership.role !== "admin")) {
    if (shopId !== removedBy) {
      logger.warn(`Shop ${removedBy} cannot remove members from group ${groupId}`);
      return false;
    }
  }
  if (shopId === group.ownerId) {
    logger.warn(`Cannot remove owner from group ${groupId}`);
    return false;
  }
  await (prisma as any).shopGroupMember.deleteMany({
    where: { groupId, shopId },
  });
  logger.info(`Shop ${shopId} removed from group ${groupId} by ${removedBy}`);
  return true;
}

export async function updateMemberPermissions(
  groupId: string,
  memberId: string,
  updatedBy: string,
  permissions: {
    role?: "admin" | "member";
    canEditSettings?: boolean;
    canViewReports?: boolean;
    canManageBilling?: boolean;
  }
): Promise<boolean> {
  const group = await (prisma as any).shopGroup.findUnique({
    where: { id: groupId },
    include: { ShopGroupMember: true },
  });
  if (!group) return false;
  if (group.ownerId !== updatedBy) {
    logger.warn(`Shop ${updatedBy} cannot update permissions in group ${groupId}`);
    return false;
  }
  await (prisma as any).shopGroupMember.update({
    where: { id: memberId },
    data: {
      role: permissions.role,
      canEditSettings: permissions.canEditSettings,
      canViewReports: permissions.canViewReports,
      canManageBilling: permissions.canManageBilling,
    },
  });
  return true;
}

export async function deleteShopGroup(
  groupId: string,
  deletedBy: string
): Promise<boolean> {
  const group = await (prisma as any).shopGroup.findUnique({
    where: { id: groupId },
  });
  if (!group || group.ownerId !== deletedBy) {
    return false;
  }
  await (prisma as any).shopGroup.delete({
    where: { id: groupId },
  });
  logger.info(`Shop group ${groupId} deleted by ${deletedBy}`);
  return true;
}

export async function getGroupAggregatedStats(
  groupId: string,
  requesterId: string,
  days: number = 7
): Promise<AggregatedStats | null> {
  const group = await (prisma as any).shopGroup.findUnique({
    where: { id: groupId },
    include: { ShopGroupMember: true },
  });
  if (!group) return null;
  const hasAccess = group.ShopGroupMember.some((m: { shopId: string; canViewReports?: boolean }) => m.shopId === requesterId && m.canViewReports);
  if (!hasAccess && group.ownerId !== requesterId) {
    return null;
  }
  const memberShopIds = group.ShopGroupMember.map((m: { shopId: string }) => m.shopId);
  const since = new Date();
  since.setDate(since.getDate() - days);
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId: { in: memberShopIds },
      createdAt: { gte: since },
      eventType: { in: ["purchase", "checkout_completed"] },
    },
    select: {
      orderKey: true,
      payloadJson: true,
    },
  });
  const platformBreakdown: Record<string, { orders: number; revenue: number }> = {};
  let totalOrders = 0;
  let totalRevenue = 0;
  const orderIds = new Set<string>();
  for (const receipt of receipts) {
    if (receipt.orderKey) {
      orderIds.add(receipt.orderKey);
    }
    const payload = receipt.payloadJson as Record<string, unknown> | null;
    const platform = extractPlatformFromPayload(payload) || "unknown";
    const data = payload?.data as Record<string, unknown> | undefined;
    const value = typeof data?.value === "number" ? data.value : 0;
    if (value > 0) {
      totalRevenue += value;
      if (!platformBreakdown[platform]) {
        platformBreakdown[platform] = { orders: 0, revenue: 0 };
      }
      platformBreakdown[platform].revenue += value;
    }
  }
  totalOrders = orderIds.size;
  for (const platform in platformBreakdown) {
    platformBreakdown[platform].orders = receipts.filter(r => {
      const payload = r.payloadJson as Record<string, unknown> | null;
      return extractPlatformFromPayload(payload) === platform && r.orderKey;
    }).length;
  }
  const averageMatchRate = totalOrders > 0
    ? (totalOrders / totalOrders) * 100
    : 100;
  return {
    totalOrders,
    totalRevenue,
    averageMatchRate,
    platformBreakdown,
  };
}

export async function getGroupShopBreakdown(
  groupId: string,
  requesterId: string,
  days: number = 7
): Promise<Array<{
  shopId: string;
  shopDomain: string;
  orders: number;
  revenue: number;
  matchRate: number;
}> | null> {
  const group = await (prisma as any).shopGroup.findUnique({
    where: { id: groupId },
    include: { ShopGroupMember: true },
  });
  if (!group) return null;
  const hasAccess = group.ShopGroupMember.some((m: { shopId: string; canViewReports?: boolean }) => m.shopId === requesterId && m.canViewReports);
  if (!hasAccess && group.ownerId !== requesterId) {
    return null;
  }
  const memberShopIds = group.ShopGroupMember.map((m: { shopId: string }) => m.shopId);
  const since = new Date();
  since.setDate(since.getDate() - days);
  const shops = await prisma.shop.findMany({
    where: { id: { in: memberShopIds } },
    select: { id: true, shopDomain: true },
  });
  const shopMap = new Map(shops.map(s => [s.id, s.shopDomain]));
  const breakdown: Map<string, { orders: number; revenue: number }> = new Map();
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId: { in: memberShopIds },
      createdAt: { gte: since },
      eventType: { in: ["purchase", "checkout_completed"] },
    },
    select: {
      shopId: true,
      orderKey: true,
      payloadJson: true,
    },
  });
  const shopReceipts = new Map<string, typeof receipts>();
  for (const receipt of receipts) {
    const existing = shopReceipts.get(receipt.shopId) || [];
    existing.push(receipt);
    shopReceipts.set(receipt.shopId, existing);
  }
  for (const [shopId, shopReceiptList] of shopReceipts) {
    const orderIds = new Set(shopReceiptList.map(r => r.orderKey).filter(Boolean));
    let revenue = 0;
    for (const receipt of shopReceiptList) {
      const payload = receipt.payloadJson as Record<string, unknown> | null;
      const data = payload?.data as Record<string, unknown> | undefined;
      const value = typeof data?.value === "number" ? data.value : 0;
      if (value > 0) {
        revenue += value;
      }
    }
    breakdown.set(shopId, {
      orders: orderIds.size,
      revenue,
    });
  }
  return memberShopIds.map((shopId: string) => {
    const stats = breakdown.get(shopId) || { orders: 0, revenue: 0 };
    const matchRate = stats.orders > 0 ? 100 : 0;
    return {
      shopId,
      shopDomain: shopMap.get(shopId) || "Unknown",
      orders: stats.orders,
      revenue: stats.revenue,
      matchRate,
    };
  });
}
