/**
 * Workspace 权限服务 - Owner/Admin/Viewer 权限检查
 */

import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";

export type WorkspaceRole = "owner" | "admin" | "viewer";

export interface PermissionCheck {
  allowed: boolean;
  reason?: string;
}

/**
 * 检查用户是否有权限执行操作
 */
export async function checkWorkspacePermission(
  workspaceId: string,
  userId: string,
  action: "view" | "edit" | "delete" | "manage_members" | "manage_billing"
): Promise<PermissionCheck> {
  try {
    const member = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId,
        },
      },
      include: {
        workspace: {
          select: {
            ownerPartnerId: true,
            ownerEmail: true,
          },
        },
      },
    });

    if (!member) {
      return {
        allowed: false,
        reason: "用户不是 workspace 成员",
      };
    }

    if (member.inviteStatus !== "accepted") {
      return {
        allowed: false,
        reason: "邀请尚未接受",
      };
    }

    const role = member.role as WorkspaceRole;

    // Owner 拥有所有权限
    if (role === "owner") {
      return { allowed: true };
    }

    // 检查具体权限
    switch (action) {
      case "view":
        // 所有角色都可以查看
        return { allowed: true };

      case "edit":
        // Admin 和 Owner 可以编辑
        if (role === "admin") {
          return { allowed: true };
        }
        return {
          allowed: false,
          reason: "只有 Admin 和 Owner 可以编辑",
        };

      case "delete":
        // 只有 Owner 可以删除
        return {
          allowed: false,
          reason: "只有 Owner 可以删除",
        };

      case "manage_members":
        // Admin 和 Owner 可以管理成员
        if (role === "admin") {
          return { allowed: true };
        }
        return {
          allowed: false,
          reason: "只有 Admin 和 Owner 可以管理成员",
        };

      case "manage_billing":
        // 只有 Owner 可以管理计费
        return {
          allowed: false,
          reason: "只有 Owner 可以管理计费",
        };

      default:
        return {
          allowed: false,
          reason: "未知操作",
        };
    }
  } catch (error) {
    logger.error("Failed to check workspace permission", {
      workspaceId,
      userId,
      action,
      error,
    });
    return {
      allowed: false,
      reason: "权限检查失败",
    };
  }
}

/**
 * 获取用户的 workspace 角色
 */
export async function getUserWorkspaceRole(
  workspaceId: string,
  userId: string
): Promise<WorkspaceRole | null> {
  try {
    const member = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId,
        },
      },
      select: {
        role: true,
      },
    });

    if (!member || member.inviteStatus !== "accepted") {
      return null;
    }

    return member.role as WorkspaceRole;
  } catch (error) {
    logger.error("Failed to get user workspace role", {
      workspaceId,
      userId,
      error,
    });
    return null;
  }
}

