
import { randomUUID } from "crypto";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { getShopGroupDetails } from "./multi-shop.server";

export type CommentTargetType = "shop" | "scan_report" | "verification_run" | "migration_task";

export interface CreateWorkspaceCommentInput {
  targetType: CommentTargetType;
  targetId: string;
  content: string;
  parentCommentId?: string;
  groupId?: string;
  mentionedShopIds?: string[];
}

export interface WorkspaceCommentWithAuthor {
  id: string;
  targetType: string;
  targetId: string;
  authorShopId: string;
  authorShopDomain: string;
  content: string;
  groupId: string | null;
  groupName: string | null;
  parentCommentId: string | null;
  replies: WorkspaceCommentWithAuthor[];
  createdAt: Date;
  updatedAt: Date;
}

export async function createWorkspaceComment(
  input: CreateWorkspaceCommentInput,
  authorShopId: string
): Promise<{ id: string } | { error: string }> {
  try {

    if (input.groupId) {
      const group = await getShopGroupDetails(input.groupId, authorShopId);
      if (!group) {
        return { error: "分组不存在或无权访问" };
      }

      const isMember = group.members.some((m) => m.shopId === authorShopId);
      if (!isMember && group.ownerId !== authorShopId) {
        return { error: "无权在此分组中评论" };
      }
    }

    let targetExists = false;
    switch (input.targetType) {
      case "shop":
        const shop = await prisma.shop.findUnique({
          where: { id: input.targetId },
        });
        targetExists = !!shop;
        break;
      case "scan_report":
        const scanReport = await prisma.scanReport.findUnique({
          where: { id: input.targetId },
        });
        targetExists = !!scanReport;
        break;
      case "verification_run":
        const verificationRun = await prisma.verificationRun.findUnique({
          where: { id: input.targetId },
        });
        targetExists = !!verificationRun;
        break;
      case "migration_task":
        const task = await prisma.migrationTask.findUnique({
          where: { id: input.targetId },
        });
        targetExists = !!task;
        break;
    }

    if (!targetExists) {
      return { error: "目标不存在" };
    }

    if (input.parentCommentId) {
      const parentComment = await prisma.workspaceComment.findUnique({
        where: { id: input.parentCommentId },
      });
      if (
        !parentComment ||
        parentComment.targetType !== input.targetType ||
        parentComment.targetId !== input.targetId
      ) {
        return { error: "父评论不存在或不属于此目标" };
      }
    }

    const comment = await prisma.workspaceComment.create({
      data: {
        id: randomUUID(),
        targetType: input.targetType,
        targetId: input.targetId,
        authorShopId,
        content: input.content,
        parentCommentId: input.parentCommentId ?? null,
        groupId: input.groupId ?? null,
        updatedAt: new Date(),
      },
    });

    if (input.mentionedShopIds && input.mentionedShopIds.length > 0) {
      logger.info("Workspace comment mentions detected", {
        commentId: comment.id,
        mentionedShopIds: input.mentionedShopIds,
      });

    }

    logger.info(`Workspace comment created: ${comment.id} by ${authorShopId}`);

    return { id: comment.id };
  } catch (error) {
    logger.error("Failed to create workspace comment:", error);
    return { error: error instanceof Error ? error.message : "创建评论失败" };
  }
}

export async function getWorkspaceComments(
  targetType: CommentTargetType,
  targetId: string,
  requesterShopId: string
): Promise<WorkspaceCommentWithAuthor[]> {
  const comments = await prisma.workspaceComment.findMany({
    where: {
      targetType,
      targetId,
      parentCommentId: null,
    },
    include: {
      ShopGroup: {
        select: {
          name: true,
        },
      },
      other_WorkspaceComment: {
        orderBy: { createdAt: "asc" },
        include: {
          ShopGroup: {
            select: {
              name: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const authorShopIds = new Set<string>();
  comments.forEach((c) => {
    authorShopIds.add(c.authorShopId);
    c.other_WorkspaceComment.forEach((r: typeof c.other_WorkspaceComment[0]) => authorShopIds.add(r.authorShopId));
  });

  const shops = await prisma.shop.findMany({
    where: { id: { in: Array.from(authorShopIds) } },
    select: { id: true, shopDomain: true },
  });

  const shopMap = new Map(shops.map((s: { id: string; shopDomain: string }) => [s.id, s.shopDomain]));

  const mapComment = (c: typeof comments[0]): WorkspaceCommentWithAuthor => ({
    id: c.id,
    targetType: c.targetType,
    targetId: c.targetId,
    authorShopId: c.authorShopId,
    authorShopDomain: shopMap.get(c.authorShopId) || "Unknown",
    content: c.content,
    groupId: c.groupId,
    groupName: c.ShopGroup?.name || null,
    parentCommentId: c.parentCommentId,
    replies: c.other_WorkspaceComment.map((r: typeof c.other_WorkspaceComment[0]) => ({
      id: r.id,
      targetType: c.targetType,
      targetId: c.targetId,
      authorShopId: r.authorShopId,
      authorShopDomain: shopMap.get(r.authorShopId) || "Unknown",
      content: r.content,
      groupId: r.groupId,
      groupName: r.ShopGroup?.name || null,
      parentCommentId: c.id,
      replies: [],
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  });

  return comments.map(mapComment);
}

export async function deleteWorkspaceComment(
  commentId: string,
  deletedByShopId: string
): Promise<boolean | { error: string }> {
  try {
    const comment = await prisma.workspaceComment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      return { error: "评论不存在" };
    }

    if (comment.authorShopId !== deletedByShopId) {
      return { error: "无权删除此评论" };
    }

    await prisma.workspaceComment.delete({
      where: { id: commentId },
    });

    logger.info(`Workspace comment deleted: ${commentId} by ${deletedByShopId}`);
    return true;
  } catch (error) {
    logger.error("Failed to delete workspace comment:", error);
    return { error: error instanceof Error ? error.message : "删除评论失败" };
  }
}

