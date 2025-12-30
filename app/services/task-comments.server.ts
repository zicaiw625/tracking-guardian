
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { getShopGroupDetails } from "./multi-shop.server";

export interface CreateCommentInput {
  taskId: string;
  content: string;
  parentCommentId?: string;
  mentionedShopIds?: string[];
}

export interface CommentWithAuthor {
  id: string;
  taskId: string;
  authorShopId: string;
  authorShopDomain: string;
  content: string;
  isSystemMessage: boolean;
  parentCommentId: string | null;
  replies: CommentWithAuthor[];
  createdAt: Date;
  updatedAt: Date;
}

export async function createTaskComment(
  input: CreateCommentInput,
  authorShopId: string
): Promise<{ id: string } | { error: string }> {
  try {
    // 验证任务存在且有权限
    const task = await prisma.migrationTask.findUnique({
      where: { id: input.taskId },
      include: {
        group: {
          include: { members: true },
        },
      },
    });

    if (!task) {
      return { error: "任务不存在" };
    }

    // 权限检查
    const isOwner = task.shopId === authorShopId;
    const isAssignedTo = task.assignedToShopId === authorShopId;
    const isGroupMember = task.group?.members.some((m) => m.shopId === authorShopId);
    const isGroupOwner = task.group?.ownerId === authorShopId;

    if (!isOwner && !isAssignedTo && !isGroupMember && !isGroupOwner) {
      return { error: "无权在此任务中评论" };
    }

    // 如果是对评论的回复，验证父评论存在
    if (input.parentCommentId) {
      const parentComment = await prisma.taskComment.findUnique({
        where: { id: input.parentCommentId },
      });
      if (!parentComment || parentComment.taskId !== input.taskId) {
        return { error: "父评论不存在或不属于此任务" };
      }
    }

    const comment = await prisma.taskComment.create({
      data: {
        taskId: input.taskId,
        authorShopId,
        content: input.content,
        parentCommentId: input.parentCommentId,
        isSystemMessage: false,
        // 将提及信息存储在 content 中（可以通过解析 @ 符号提取）
        // 或者可以扩展模型添加 mentionedShopIds 字段
      },
    });

    // 如果有提及，可以发送通知（未来功能）
    if (input.mentionedShopIds && input.mentionedShopIds.length > 0) {
      logger.info("Comment mentions detected", {
        commentId: comment.id,
        mentionedShopIds: input.mentionedShopIds,
      });
      // TODO: 发送提及通知
    }

    logger.info(`Task comment created: ${comment.id} by ${authorShopId}`);

    return { id: comment.id };
  } catch (error) {
    logger.error("Failed to create task comment:", error);
    return { error: error instanceof Error ? error.message : "创建评论失败" };
  }
}

export async function getTaskComments(taskId: string, requesterShopId: string): Promise<CommentWithAuthor[]> {
  // 验证任务存在且有权限
  const task = await prisma.migrationTask.findUnique({
    where: { id: taskId },
    include: {
      group: {
        include: { members: true },
      },
    },
  });

  if (!task) {
    return [];
  }

  // 权限检查
  const isOwner = task.shopId === requesterShopId;
  const isAssignedTo = task.assignedToShopId === requesterShopId;
  const isGroupMember = task.group?.members.some((m) => m.shopId === requesterShopId);
  const isGroupOwner = task.group?.ownerId === requesterShopId;

  if (!isOwner && !isAssignedTo && !isGroupMember && !isGroupOwner) {
    return [];
  }

  const comments = await prisma.taskComment.findMany({
    where: {
      taskId,
      parentCommentId: null, // 只获取顶级评论
    },
    include: {
      replies: {
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // 获取所有作者店铺信息
  const authorShopIds = new Set<string>();
  comments.forEach((c) => {
    authorShopIds.add(c.authorShopId);
    c.replies.forEach((r) => authorShopIds.add(r.authorShopId));
  });

  const shops = await prisma.shop.findMany({
    where: { id: { in: Array.from(authorShopIds) } },
    select: { id: true, shopDomain: true },
  });

  const shopMap = new Map(shops.map((s) => [s.id, s.shopDomain]));

  const mapComment = (c: any): CommentWithAuthor => ({
    id: c.id,
    taskId: c.taskId,
    authorShopId: c.authorShopId,
    authorShopDomain: shopMap.get(c.authorShopId) || "Unknown",
    content: c.content,
    isSystemMessage: c.isSystemMessage,
    parentCommentId: c.parentCommentId,
    replies: c.replies.map(mapComment),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  });

  return comments.map(mapComment);
}

export async function createSystemComment(
  taskId: string,
  content: string
): Promise<void> {
  try {
    await prisma.taskComment.create({
      data: {
        taskId,
        authorShopId: "", // 系统消息没有作者
        content,
        isSystemMessage: true,
      },
    });
  } catch (error) {
    logger.error("Failed to create system comment:", error);
  }
}

