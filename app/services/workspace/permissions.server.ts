

import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";

export type WorkspaceRole = "owner" | "admin" | "viewer";

export interface PermissionCheck {
  allowed: boolean;
  reason?: string;
}

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
        Workspace: {
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

    if (role === "owner") {
      return { allowed: true };
    }

    switch (action) {
      case "view":

        return { allowed: true };

      case "edit":

        if (role === "admin") {
          return { allowed: true };
        }
        return {
          allowed: false,
          reason: "只有 Admin 和 Owner 可以编辑",
        };

      case "delete":

        return {
          allowed: false,
          reason: "只有 Owner 可以删除",
        };

      case "manage_members":

        if (role === "admin") {
          return { allowed: true };
        }
        return {
          allowed: false,
          reason: "只有 Admin 和 Owner 可以管理成员",
        };

      case "manage_billing":

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
        inviteStatus: true,
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

