

import { randomBytes, randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { CONFIG } from "../utils/config";

export interface WorkspaceInvitation {
  id: string;
  groupId: string;
  groupName: string;
  inviterId: string;
  inviterDomain: string;
  inviteeEmail?: string;
  inviteeDomain?: string;
  token: string;
  role: "admin" | "member";
  permissions: {
    canEditSettings: boolean;
    canViewReports: boolean;
    canManageBilling: boolean;
  };
  status: "pending" | "accepted" | "declined" | "expired";
  expiresAt: Date;
  createdAt: Date;
  acceptedAt?: Date;
  acceptedBy?: string;
}

export interface CreateInvitationInput {
  groupId: string;
  inviterId: string;
  inviteeEmail?: string;
  inviteeDomain?: string;
  role?: "admin" | "member";
  permissions?: {
    canEditSettings?: boolean;
    canViewReports?: boolean;
    canManageBilling?: boolean;
  };
  expiresInDays?: number;
}

export interface InvitationResult {
  invitation: WorkspaceInvitation;
  inviteUrl: string;
}

export interface AcceptInvitationResult {
  success: boolean;
  message: string;
  groupId?: string;
  groupName?: string;
}

export async function createInvitation(
  input: CreateInvitationInput
): Promise<InvitationResult | null> {
  const {
    groupId,
    inviterId,
    inviteeEmail,
    inviteeDomain,
    role = "member",
    permissions = {},
    expiresInDays = 7,
  } = input;

  try {

    const group = await prisma.shopGroup.findFirst({
      where: {
        id: groupId,
        ownerId: inviterId,
      },
      include: {
        ShopGroupMember: true,
      },
    });

    if (!group) {
      logger.warn(`Group ${groupId} not found or ${inviterId} is not owner`);
      return null;
    }

    const inviterShop = await prisma.shop.findUnique({
      where: { id: inviterId },
      select: { shopDomain: true },
    });

    if (!inviterShop) {
      return null;
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const invitationData: WorkspaceInvitation = {
      id: randomBytes(16).toString("hex"),
      groupId,
      groupName: group.name,
      inviterId,
      inviterDomain: inviterShop.shopDomain,
      inviteeEmail,
      inviteeDomain,
      token,
      role,
      permissions: {
        canEditSettings: permissions.canEditSettings ?? (role === "admin"),
        canViewReports: permissions.canViewReports ?? true,
        canManageBilling: permissions.canManageBilling ?? false,
      },
      status: "pending",
      expiresAt,
      createdAt: new Date(),
    };

    await prisma.auditLog.create({
      data: {
        id: randomUUID(),
        shopId: inviterId,
        actorType: "user",
        action: "workspace_invitation_created",
        resourceType: "workspace_invitation",
        resourceId: invitationData.id,
        metadata: invitationData as unknown as Prisma.InputJsonValue,
        createdAt: new Date(),
      },
    });

    const baseUrl = CONFIG.getEnv("SHOPIFY_APP_URL", "https://app.tracking-guardian.com");
    const inviteUrl = `${baseUrl}/app/workspace/accept-invitation?token=${token}`;

    logger.info(`Workspace invitation created: ${invitationData.id} for group ${groupId}`);

    return {
      invitation: invitationData,
      inviteUrl,
    };
  } catch (error) {
    logger.error("Failed to create workspace invitation:", error);
    return null;
  }
}

export async function getInvitationByToken(
  token: string
): Promise<WorkspaceInvitation | null> {
  try {

    const logs = await prisma.auditLog.findMany({
      where: {
        action: "workspace_invitation_created",
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    for (const log of logs) {
      try {
        const invitation = JSON.parse(log.metadata ? JSON.stringify(log.metadata) : "{}") as WorkspaceInvitation;
        if (invitation.token === token) {

          if (new Date(invitation.expiresAt) < new Date()) {
            invitation.status = "expired";
          }
          return invitation;
        }
      } catch {
        continue;
      }
    }

    return null;
  } catch (error) {
    logger.error("Failed to get invitation by token:", error);
    return null;
  }
}

export async function acceptInvitation(
  token: string,
  acceptorShopId: string
): Promise<AcceptInvitationResult> {
  try {
    const invitation = await getInvitationByToken(token);

    if (!invitation) {
      return { success: false, message: "邀请不存在" };
    }

    if (invitation.status === "expired") {
      return { success: false, message: "邀请已过期" };
    }

    if (invitation.status === "accepted") {
      return { success: false, message: "邀请已被接受" };
    }

    if (invitation.status === "declined") {
      return { success: false, message: "邀请已被拒绝" };
    }

    const existingMember = await prisma.shopGroupMember.findFirst({
      where: {
        groupId: invitation.groupId,
        shopId: acceptorShopId,
      },
    });

    if (existingMember) {
      return { success: false, message: "您已经是该分组的成员" };
    }

    await prisma.shopGroupMember.create({
      data: {
        id: randomUUID(),
        groupId: invitation.groupId,
        shopId: acceptorShopId,
        role: invitation.role,
        canEditSettings: invitation.permissions.canEditSettings,
        canViewReports: invitation.permissions.canViewReports,
        canManageBilling: invitation.permissions.canManageBilling,
      },
    });

    await prisma.auditLog.create({
      data: {
        id: randomUUID(),
        shopId: acceptorShopId,
        actorType: "user",
        action: "workspace_invitation_accepted",
        resourceType: "workspace_invitation",
        resourceId: invitation.id,
        metadata: {
          invitationId: invitation.id,
          groupId: invitation.groupId,
          groupName: invitation.groupName,
          acceptedAt: new Date(),
        } as Prisma.InputJsonValue,
        createdAt: new Date(),
      },
    });

    logger.info(`Workspace invitation ${invitation.id} accepted by ${acceptorShopId}`);

    return {
      success: true,
      message: `成功加入「${invitation.groupName}」分组`,
      groupId: invitation.groupId,
      groupName: invitation.groupName,
    };
  } catch (error) {
    logger.error("Failed to accept workspace invitation:", error);
    return { success: false, message: "接受邀请失败，请稍后重试" };
  }
}

export async function declineInvitation(
  token: string,
  declinerShopId: string
): Promise<{ success: boolean; message: string }> {
  try {
    const invitation = await getInvitationByToken(token);

    if (!invitation) {
      return { success: false, message: "邀请不存在" };
    }

    if (invitation.status !== "pending") {
      return { success: false, message: "邀请状态无效" };
    }

    await prisma.auditLog.create({
      data: {
        id: randomUUID(),
        shopId: declinerShopId,
        actorType: "user",
        action: "workspace_invitation_declined",
        resourceType: "workspace_invitation",
        resourceId: invitation.id,
        metadata: {
          invitationId: invitation.id,
          groupId: invitation.groupId,
          declinedAt: new Date(),
        } as Prisma.InputJsonValue,
        createdAt: new Date(),
      },
    });

    logger.info(`Workspace invitation ${invitation.id} declined by ${declinerShopId}`);

    return { success: true, message: "已拒绝邀请" };
  } catch (error) {
    logger.error("Failed to decline workspace invitation:", error);
    return { success: false, message: "拒绝邀请失败，请稍后重试" };
  }
}

export async function getPendingInvitations(
  groupId: string,
  ownerId: string
): Promise<WorkspaceInvitation[]> {
  try {

    const group = await prisma.shopGroup.findFirst({
      where: {
        id: groupId,
        ownerId,
      },
    });

    if (!group) {
      return [];
    }

    const logs = await prisma.auditLog.findMany({
      where: {
        action: "workspace_invitation_created",
        shopId: ownerId,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const invitations: WorkspaceInvitation[] = [];

    for (const log of logs) {
      try {
        const invitation = JSON.parse(log.metadata ? JSON.stringify(log.metadata) : "{}") as WorkspaceInvitation;
        if (invitation.groupId === groupId && invitation.status === "pending") {

          if (new Date(invitation.expiresAt) < new Date()) {
            invitation.status = "expired";
          }
          invitations.push(invitation);
        }
      } catch {
        continue;
      }
    }

    return invitations;
  } catch (error) {
    logger.error("Failed to get pending invitations:", error);
    return [];
  }
}

export async function revokeInvitation(
  invitationId: string,
  ownerId: string
): Promise<{ success: boolean; message: string }> {
  try {

    const logs = await prisma.auditLog.findMany({
      where: {
        action: "workspace_invitation_created",
        shopId: ownerId,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    let found = false;

    for (const log of logs) {
      try {
        const invitation = JSON.parse(log.metadata ? JSON.stringify(log.metadata) : "{}") as WorkspaceInvitation;
        if (invitation.id === invitationId) {
          found = true;

          await prisma.auditLog.create({
            data: {
              id: randomUUID(),
              shopId: ownerId,
              actorType: "system",
              action: "workspace_invitation_revoked",
              resourceType: "workspace_invitation",
              resourceId: invitationId,
              metadata: {
                invitationId,
                revokedAt: new Date(),
              } as Prisma.InputJsonValue,
              createdAt: new Date(),
            },
          });
          break;
        }
      } catch {
        continue;
      }
    }

    if (!found) {
      return { success: false, message: "邀请不存在" };
    }

    logger.info(`Workspace invitation ${invitationId} revoked by ${ownerId}`);
    return { success: true, message: "邀请已撤销" };
  } catch (error) {
    logger.error("Failed to revoke workspace invitation:", error);
    return { success: false, message: "撤销邀请失败，请稍后重试" };
  }
}

export function generateInvitationEmailHtml(
  invitation: WorkspaceInvitation,
  inviteUrl: string
): string {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>您收到了一个工作区邀请</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      background: white;
      border-radius: 8px;
      padding: 40px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
    }
    .logo {
      font-size: 32px;
      margin-bottom: 10px;
    }
    .title {
      font-size: 24px;
      font-weight: 600;
      margin: 0;
      color: #111;
    }
    .subtitle {
      font-size: 16px;
      color: #666;
      margin-top: 8px;
    }
    .content {
      margin: 30px 0;
    }
    .info-box {
      background: #f9fafb;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #eee;
    }
    .info-row:last-child {
      border-bottom: none;
    }
    .info-label {
      color: #666;
    }
    .info-value {
      font-weight: 500;
    }
    .cta-button {
      display: inline-block;
      background: #5c6ac4;
      color: white;
      padding: 14px 28px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 500;
      margin: 20px 0;
    }
    .cta-button:hover {
      background: #4959bd;
    }
    .footer {
      text-align: center;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #eee;
      color: #666;
      font-size: 14px;
    }
    .expiry-notice {
      background: #fff3cd;
      border: 1px solid #ffc107;
      border-radius: 6px;
      padding: 12px;
      margin-top: 20px;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">🛡️</div>
      <h1 class="title">Tracking Guardian</h1>
      <p class="subtitle">您收到了一个工作区邀请</p>
    </div>

    <div class="content">
      <p>您好！</p>
      <p>
        <strong>${invitation.inviterDomain}</strong> 邀请您加入他们的 Tracking Guardian 工作区。
      </p>

      <div class="info-box">
        <div class="info-row">
          <span class="info-label">工作区名称</span>
          <span class="info-value">${invitation.groupName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">邀请者</span>
          <span class="info-value">${invitation.inviterDomain}</span>
        </div>
        <div class="info-row">
          <span class="info-label">您的角色</span>
          <span class="info-value">${invitation.role === "admin" ? "管理员" : "成员"}</span>
        </div>
        <div class="info-row">
          <span class="info-label">权限</span>
          <span class="info-value">
            ${invitation.permissions.canEditSettings ? "✓ 编辑设置" : ""}
            ${invitation.permissions.canViewReports ? "✓ 查看报告" : ""}
            ${invitation.permissions.canManageBilling ? "✓ 管理账单" : ""}
          </span>
        </div>
      </div>

      <p style="text-align: center;">
        <a href="${inviteUrl}" class="cta-button">接受邀请</a>
      </p>

      <div class="expiry-notice">
        ⏰ 此邀请将于 <strong>${new Date(invitation.expiresAt).toLocaleDateString("zh-CN")}</strong> 过期
      </div>
    </div>

    <div class="footer">
      <p>如果您不希望加入此工作区，可以忽略此邮件。</p>
      <p>© ${new Date().getFullYear()} Tracking Guardian</p>
    </div>
  </div>
</body>
</html>
  `;
}

export function generateInvitationEmailText(
  invitation: WorkspaceInvitation,
  inviteUrl: string
): string {
  return `
您好！

${invitation.inviterDomain} 邀请您加入他们的 Tracking Guardian 工作区「${invitation.groupName}」。

详情：
- 工作区名称：${invitation.groupName}
- 邀请者：${invitation.inviterDomain}
- 您的角色：${invitation.role === "admin" ? "管理员" : "成员"}
- 权限：${[
    invitation.permissions.canEditSettings && "编辑设置",
    invitation.permissions.canViewReports && "查看报告",
    invitation.permissions.canManageBilling && "管理账单",
  ].filter(Boolean).join("、")}

点击以下链接接受邀请：
${inviteUrl}

此邀请将于 ${new Date(invitation.expiresAt).toLocaleDateString("zh-CN")} 过期。

如果您不希望加入此工作区，可以忽略此邮件。

© ${new Date().getFullYear()} Tracking Guardian
  `.trim();
}

