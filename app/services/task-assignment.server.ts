
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { canManageMultipleShops, getShopGroupDetails } from "./multi-shop.server";

export interface CreateTaskInput {
  shopId: string;
  assetId?: string;
  title: string;
  description?: string;
  assignedToShopId?: string;
  priority?: number;
  dueDate?: Date;
  groupId?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  assignedToShopId?: string;
  status?: "pending" | "in_progress" | "completed" | "blocked" | "cancelled";
  priority?: number;
  dueDate?: Date;
}

export interface TaskWithDetails {
  id: string;
  shopId: string;
  shopDomain: string;
  assetId: string | null;
  assetDisplayName: string | null;
  title: string;
  description: string | null;
  assignedToShopId: string | null;
  assignedToShopDomain: string | null;
  assignedByShopId: string;
  assignedByShopDomain: string;
  status: string;
  priority: number;
  dueDate: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  groupId: string | null;
  groupName: string | null;
  commentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export async function createMigrationTask(
  input: CreateTaskInput,
  assignedByShopId: string
): Promise<{ id: string } | { error: string }> {
  try {

    if (input.groupId) {
      const group = await getShopGroupDetails(input.groupId, assignedByShopId);
      if (!group) {
        return { error: "分组不存在或无权访问" };
      }

      const isMember = group.members.some((m) => m.shopId === assignedByShopId);
      if (!isMember && group.ownerId !== assignedByShopId) {
        return { error: "无权在此分组中创建任务" };
      }

      if (input.assignedToShopId) {
        const canAssign = group.members.some((m) => m.shopId === input.assignedToShopId);
        if (!canAssign) {
          return { error: "分配对象不在分组中" };
        }
      }
    }

    if (input.assetId) {
      const asset = await prisma.auditAsset.findUnique({
        where: { id: input.assetId },
        select: { shopId: true },
      });
      if (!asset || asset.shopId !== input.shopId) {
        return { error: "资产不存在或不属于该店铺" };
      }
    }

    const task = await prisma.migrationTask.create({
      data: {
        shopId: input.shopId,
        assetId: input.assetId,
        title: input.title,
        description: input.description,
        assignedToShopId: input.assignedToShopId,
        assignedByShopId,
        priority: input.priority ?? 5,
        dueDate: input.dueDate,
        groupId: input.groupId,
        status: "pending",
      },
    });

    logger.info(`Migration task created: ${task.id} by ${assignedByShopId}`);

    return { id: task.id };
  } catch (error) {
    logger.error("Failed to create migration task:", error);
    return { error: error instanceof Error ? error.message : "创建任务失败" };
  }
}

export async function updateMigrationTask(
  taskId: string,
  input: UpdateTaskInput,
  updatedByShopId: string
): Promise<boolean | { error: string }> {
  try {
    const task = await prisma.migrationTask.findUnique({
      where: { id: taskId },
      include: {
        group: {
          include: { members: true },
        },
      },
    });

    if (!task) {
      return { error: "任务不存在" };
    }

    const isOwner = task.shopId === updatedByShopId;
    const isAssignedTo = task.assignedToShopId === updatedByShopId;
    const isGroupAdmin = task.group?.members.some(
      (m) => m.shopId === updatedByShopId && (m.role === "admin" || m.role === "owner")
    );
    const isGroupOwner = task.group?.ownerId === updatedByShopId;

    if (!isOwner && !isAssignedTo && !isGroupAdmin && !isGroupOwner) {
      return { error: "无权修改此任务" };
    }

    const updateData: any = {};
    if (input.title !== undefined) updateData.title = input.title;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.assignedToShopId !== undefined) updateData.assignedToShopId = input.assignedToShopId;
    if (input.status !== undefined) {
      updateData.status = input.status;
      if (input.status === "in_progress" && !task.startedAt) {
        updateData.startedAt = new Date();
      }
      if (input.status === "completed" && !task.completedAt) {
        updateData.completedAt = new Date();
      }
    }
    if (input.priority !== undefined) updateData.priority = input.priority;
    if (input.dueDate !== undefined) updateData.dueDate = input.dueDate;

    await prisma.migrationTask.update({
      where: { id: taskId },
      data: updateData,
    });

    logger.info(`Migration task updated: ${taskId} by ${updatedByShopId}`);
    return true;
  } catch (error) {
    logger.error("Failed to update migration task:", error);
    return { error: error instanceof Error ? error.message : "更新任务失败" };
  }
}

export async function getMigrationTasks(
  shopId: string,
  options?: {
    groupId?: string;
    assignedToShopId?: string;
    status?: string;
    includeCompleted?: boolean;
  }
): Promise<TaskWithDetails[]> {
  const where: any = {
    shopId,
  };

  if (options?.groupId) {
    where.groupId = options.groupId;
  }

  if (options?.assignedToShopId) {
    where.assignedToShopId = options.assignedToShopId;
  }

  if (options?.status) {
    where.status = options.status;
  } else if (!options?.includeCompleted) {
    where.status = { not: "completed" };
  }

  const tasks = await prisma.migrationTask.findMany({
    where,
    include: {
      asset: {
        select: {
          displayName: true,
        },
      },
      group: {
        select: {
          name: true,
        },
      },
      _count: {
        select: {
          comments: true,
        },
      },
    },
    orderBy: [
      { priority: "desc" },
      { createdAt: "desc" },
    ],
  });

  const shopIds = new Set<string>();
  tasks.forEach((t) => {
    shopIds.add(t.shopId);
    if (t.assignedToShopId) shopIds.add(t.assignedToShopId);
    if (t.assignedByShopId) shopIds.add(t.assignedByShopId);
  });

  const shops = await prisma.shop.findMany({
    where: { id: { in: Array.from(shopIds) } },
    select: { id: true, shopDomain: true },
  });

  const shopMap = new Map(shops.map((s) => [s.id, s.shopDomain]));

  return tasks.map((t) => ({
    id: t.id,
    shopId: t.shopId,
    shopDomain: shopMap.get(t.shopId) || "Unknown",
    assetId: t.assetId,
    assetDisplayName: t.asset?.displayName || null,
    title: t.title,
    description: t.description,
    assignedToShopId: t.assignedToShopId,
    assignedToShopDomain: t.assignedToShopId ? shopMap.get(t.assignedToShopId) || null : null,
    assignedByShopId: t.assignedByShopId,
    assignedByShopDomain: shopMap.get(t.assignedByShopId) || "Unknown",
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate,
    startedAt: t.startedAt,
    completedAt: t.completedAt,
    groupId: t.groupId,
    groupName: t.group?.name || null,
    commentCount: t._count.comments,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));
}

export async function getMigrationTask(
  taskId: string,
  requesterShopId: string
): Promise<TaskWithDetails | null> {
  const task = await prisma.migrationTask.findUnique({
    where: { id: taskId },
    include: {
      asset: {
        select: {
          displayName: true,
        },
      },
      group: {
        include: {
          members: true,
        },
        select: {
          name: true,
          ownerId: true,
          members: {
            select: {
              shopId: true,
            },
          },
        },
      },
      _count: {
        select: {
          comments: true,
        },
      },
    },
  });

  if (!task) {
    return null;
  }

  const isOwner = task.shopId === requesterShopId;
  const isAssignedTo = task.assignedToShopId === requesterShopId;
  const isGroupMember = task.group?.members.some((m) => m.shopId === requesterShopId);
  const isGroupOwner = task.group?.ownerId === requesterShopId;

  if (!isOwner && !isAssignedTo && !isGroupMember && !isGroupOwner) {
    return null;
  }

  const shopIds = [task.shopId, task.assignedByShopId];
  if (task.assignedToShopId) shopIds.push(task.assignedToShopId);

  const shops = await prisma.shop.findMany({
    where: { id: { in: shopIds } },
    select: { id: true, shopDomain: true },
  });

  const shopMap = new Map(shops.map((s) => [s.id, s.shopDomain]));

  return {
    id: task.id,
    shopId: task.shopId,
    shopDomain: shopMap.get(task.shopId) || "Unknown",
    assetId: task.assetId,
    assetDisplayName: task.asset?.displayName || null,
    title: task.title,
    description: task.description,
    assignedToShopId: task.assignedToShopId,
    assignedToShopDomain: task.assignedToShopId ? shopMap.get(task.assignedToShopId) || null : null,
    assignedByShopId: task.assignedByShopId,
    assignedByShopDomain: shopMap.get(task.assignedByShopId) || "Unknown",
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    groupId: task.groupId,
    groupName: task.group?.name || null,
    commentCount: task._count.comments,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export async function deleteMigrationTask(
  taskId: string,
  deletedByShopId: string
): Promise<boolean | { error: string }> {
  try {
    const task = await prisma.migrationTask.findUnique({
      where: { id: taskId },
      include: {
        group: {
          include: { members: true },
        },
      },
    });

    if (!task) {
      return { error: "任务不存在" };
    }

    const isCreator = task.assignedByShopId === deletedByShopId;
    const isGroupOwner = task.group?.ownerId === deletedByShopId;
    const isGroupAdmin = task.group?.members.some(
      (m) => m.shopId === deletedByShopId && m.role === "admin"
    );

    if (!isCreator && !isGroupOwner && !isGroupAdmin) {
      return { error: "无权删除此任务" };
    }

    await prisma.migrationTask.delete({
      where: { id: taskId },
    });

    logger.info(`Migration task deleted: ${taskId} by ${deletedByShopId}`);
    return true;
  } catch (error) {
    logger.error("Failed to delete migration task:", error);
    return { error: error instanceof Error ? error.message : "删除任务失败" };
  }
}

