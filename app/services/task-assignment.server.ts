import { randomUUID } from "crypto";
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
  logger.debug(`createMigrationTask called but migrationTask table no longer exists`, {
    shopId: input.shopId,
    assignedByShopId,
  });
  return { error: "任务功能已移除" };
}

export async function updateMigrationTask(
  taskId: string,
  input: UpdateTaskInput,
  updatedByShopId: string
): Promise<boolean | { error: string }> {
  logger.debug(`updateMigrationTask called but migrationTask table no longer exists`, {
    taskId,
    updatedByShopId,
  });
  return { error: "任务功能已移除" };
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
  logger.debug(`getMigrationTasks called but migrationTask table no longer exists`, {
    shopId,
    options,
  });
  return [];
}

export async function getMigrationTask(
  taskId: string,
  requesterShopId: string
): Promise<TaskWithDetails | null> {
  logger.debug(`getMigrationTask called but migrationTask table no longer exists`, {
    taskId,
    requesterShopId,
  });
  return null;
}

export async function deleteMigrationTask(
  taskId: string,
  deletedByShopId: string
): Promise<boolean | { error: string }> {
  logger.debug(`deleteMigrationTask called but migrationTask table no longer exists`, {
    taskId,
    deletedByShopId,
  });
  return { error: "任务功能已移除" };
}
