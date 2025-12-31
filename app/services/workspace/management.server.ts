

import prisma from "../db.server";
import { logger } from "../utils/logger.server";

export interface CreateWorkspaceInput {
  ownerPartnerId?: string;
  ownerEmail?: string;
  name: string;
  settings?: Record<string, unknown>;
}

export interface WorkspaceMemberInput {
  userId: string;
  email: string;
  role: "owner" | "admin" | "viewer";
}

export interface AddShopToWorkspaceInput {
  workspaceId: string;
  shopId: string;
  alias?: string;
  addedBy?: string;
}

export async function createWorkspace(
  input: CreateWorkspaceInput
): Promise<{ success: boolean; workspaceId?: string; error?: string }> {
  try {
    const workspace = await prisma.workspace.create({
      data: {
        name: input.name,
        ownerPartnerId: input.ownerPartnerId || null,
        ownerEmail: input.ownerEmail || null,
        settingsJson: input.settings || {},
      },
    });

    logger.info("Workspace created", { workspaceId: workspace.id, name: input.name });

    return {
      success: true,
      workspaceId: workspace.id,
    };
  } catch (error) {
    logger.error("Failed to create workspace", { error, input });
    return {
      success: false,
      error: error instanceof Error ? error.message : "创建失败",
    };
  }
}

export async function getWorkspace(
  workspaceId: string
): Promise<{
  id: string;
  name: string;
  ownerPartnerId: string | null;
  ownerEmail: string | null;
  settings: Record<string, unknown>;
  members: Array<{
    id: string;
    userId: string;
    email: string;
    role: string;
    inviteStatus: string;
  }>;
  shops: Array<{
    id: string;
    shopId: string;
    alias: string | null;
    addedAt: Date;
  }>;
  createdAt: Date;
} | null> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      members: true,
      shops: true,
    },
  });

  if (!workspace) return null;

  return {
    id: workspace.id,
    name: workspace.name,
    ownerPartnerId: workspace.ownerPartnerId,
    ownerEmail: workspace.ownerEmail,
    settings: (workspace.settingsJson as Record<string, unknown>) || {},
    members: workspace.members.map((m) => ({
      id: m.id,
      userId: m.userId,
      email: m.email,
      role: m.role,
      inviteStatus: m.inviteStatus,
    })),
    shops: workspace.shops.map((s) => ({
      id: s.id,
      shopId: s.shopId,
      alias: s.alias,
      addedAt: s.addedAt,
    })),
    createdAt: workspace.createdAt,
  };
}

export async function addWorkspaceMember(
  workspaceId: string,
  member: WorkspaceMemberInput
): Promise<{ success: boolean; error?: string }> {
  try {
    const existing = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: member.userId,
        },
      },
    });

    if (existing) {
      return {
        success: false,
        error: "成员已存在",
      };
    }

    await prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId: member.userId,
        email: member.email,
        role: member.role,
        inviteStatus: "pending",
      },
    });

    logger.info("Workspace member added", { workspaceId, userId: member.userId, role: member.role });

    return { success: true };
  } catch (error) {
    logger.error("Failed to add workspace member", { workspaceId, error, member });
    return {
      success: false,
      error: error instanceof Error ? error.message : "添加失败",
    };
  }
}

export async function updateWorkspaceMemberRole(
  workspaceId: string,
  userId: string,
  newRole: "owner" | "admin" | "viewer"
): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.workspaceMember.update({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId,
        },
      },
      data: {
        role: newRole,
      },
    });

    logger.info("Workspace member role updated", { workspaceId, userId, newRole });

    return { success: true };
  } catch (error) {
    logger.error("Failed to update workspace member role", { workspaceId, userId, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "更新失败",
    };
  }
}

export async function removeWorkspaceMember(
  workspaceId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.workspaceMember.delete({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId,
        },
      },
    });

    logger.info("Workspace member removed", { workspaceId, userId });

    return { success: true };
  } catch (error) {
    logger.error("Failed to remove workspace member", { workspaceId, userId, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "移除失败",
    };
  }
}

export async function addShopToWorkspace(
  input: AddShopToWorkspaceInput
): Promise<{ success: boolean; error?: string }> {
  try {
    const existing = await prisma.workspaceShop.findUnique({
      where: {
        workspaceId_shopId: {
          workspaceId: input.workspaceId,
          shopId: input.shopId,
        },
      },
    });

    if (existing) {
      return {
        success: false,
        error: "店铺已在该工作区中",
      };
    }

    await prisma.workspaceShop.create({
      data: {
        workspaceId: input.workspaceId,
        shopId: input.shopId,
        alias: input.alias || null,
        addedBy: input.addedBy || null,
      },
    });

    logger.info("Shop added to workspace", {
      workspaceId: input.workspaceId,
      shopId: input.shopId,
    });

    return { success: true };
  } catch (error) {
    logger.error("Failed to add shop to workspace", { input, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "添加失败",
    };
  }
}

export async function removeShopFromWorkspace(
  workspaceId: string,
  shopId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.workspaceShop.delete({
      where: {
        workspaceId_shopId: {
          workspaceId,
          shopId,
        },
      },
    });

    logger.info("Shop removed from workspace", { workspaceId, shopId });

    return { success: true };
  } catch (error) {
    logger.error("Failed to remove shop from workspace", { workspaceId, shopId, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "移除失败",
    };
  }
}

export async function getUserWorkspaces(
  userId: string
): Promise<Array<{
  workspaceId: string;
  name: string;
  role: string;
  shopCount: number;
}>> {
  const memberships = await prisma.workspaceMember.findMany({
    where: {
      userId,
      inviteStatus: "accepted",
    },
    include: {
      workspace: {
        include: {
          shops: true,
        },
      },
    },
  });

  return memberships.map((m) => ({
    workspaceId: m.workspace.id,
    name: m.workspace.name,
    role: m.role,
    shopCount: m.workspace.shops.length,
  }));
}

export async function checkWorkspacePermission(
  workspaceId: string,
  userId: string,
  requiredRole: "owner" | "admin" | "viewer"
): Promise<{ allowed: boolean; currentRole?: string }> {
  const member = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId,
      },
    },
  });

  if (!member || member.inviteStatus !== "accepted") {
    return { allowed: false };
  }

  const roleHierarchy = { owner: 3, admin: 2, viewer: 1 };
  const userLevel = roleHierarchy[member.role as keyof typeof roleHierarchy] || 0;
  const requiredLevel = roleHierarchy[requiredRole];

  return {
    allowed: userLevel >= requiredLevel,
    currentRole: member.role,
  };
}

export async function getWorkspaceShops(
  workspaceId: string
): Promise<Array<{
  shopId: string;
  alias: string | null;
  shopDomain?: string;
  shopName?: string;
  addedAt: Date;
}>> {
  const workspaceShops = await prisma.workspaceShop.findMany({
    where: { workspaceId },
    orderBy: { addedAt: "desc" },
  });

  const shopIds = workspaceShops.map((ws) => ws.shopId);
  const shops = await prisma.shop.findMany({
    where: {
      id: { in: shopIds },
    },
    select: {
      id: true,
      shopDomain: true,
      name: true,
    },
  });

  const shopMap = new Map(shops.map((s) => [s.id, s]));

  return workspaceShops.map((ws) => {
    const shop = shopMap.get(ws.shopId);
    return {
      shopId: ws.shopId,
      alias: ws.alias,
      shopDomain: shop?.shopDomain,
      shopName: shop?.name || null,
      addedAt: ws.addedAt,
    };
  });
}

