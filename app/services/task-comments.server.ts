import { randomUUID } from "crypto";
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
    const task = await prisma.migrationTask.findUnique({
      where: { id: input.taskId },
      include: {
        ShopGroup: {
          include: { ShopGroupMember: true },
        },
      },
    });
    if (!task) {
      return { error: "任务不存在" };
    }
    const isOwner = task.shopId === authorShopId;
    const isAssignedTo = task.assignedToShopId === authorShopId;
    const isGroupMember = task.ShopGroup?.ShopGroupMember.some((m: { shopId: string }) => m.shopId === authorShopId);
    const isGroupOwner = task.ShopGroup?.ownerId === authorShopId;
    if (!isOwner && !isAssignedTo && !isGroupMember && !isGroupOwner) {
      return { error: "无权在此任务中评论" };
    }
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
        id: randomUUID(),
        taskId: input.taskId,
        authorShopId,
        content: input.content,
        parentCommentId: input.parentCommentId,
        isSystemMessage: false,
        updatedAt: new Date(),
      },
    });
    if (input.mentionedShopIds && input.mentionedShopIds.length > 0) {
      logger.info("Comment mentions detected", {
        commentId: comment.id,
        mentionedShopIds: input.mentionedShopIds,
      });
    }
    logger.info(`Task comment created: ${comment.id} by ${authorShopId}`);
    return { id: comment.id };
  } catch (error) {
    logger.error("Failed to create task comment:", error);
    return { error: error instanceof Error ? error.message : "创建评论失败" };
  }
}

export async function getTaskComments(taskId: string, requesterShopId: string): Promise<CommentWithAuthor[]> {
  const task = await prisma.migrationTask.findUnique({
    where: { id: taskId },
    include: {
      ShopGroup: {
        include: { ShopGroupMember: true },
      },
    },
  });
  if (!task) {
    return [];
  }
  const isOwner = task.shopId === requesterShopId;
  const isAssignedTo = task.assignedToShopId === requesterShopId;
    const isGroupMember = task.ShopGroup?.ShopGroupMember.some((m: { shopId: string }) => m.shopId === requesterShopId);
    const isGroupOwner = task.ShopGroup?.ownerId === requesterShopId;
  if (!isOwner && !isAssignedTo && !isGroupMember && !isGroupOwner) {
    return [];
  }
  const comments = await prisma.taskComment.findMany({
    where: {
      taskId,
      parentCommentId: null,
    },
    include: {
      other_TaskComment: {
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  const authorShopIds = new Set<string>();
  comments.forEach((c) => {
    authorShopIds.add(c.authorShopId);
    c.other_TaskComment.forEach((r) => authorShopIds.add(r.authorShopId));
  });
  const shops = await prisma.shop.findMany({
    where: { id: { in: Array.from(authorShopIds) } },
    select: { id: true, shopDomain: true },
  });
  const shopMap = new Map(shops.map((s) => [s.id, s.shopDomain]));
  const mapComment = (c: {
    id: string;
    taskId: string;
    authorShopId: string;
    content: string;
    isSystemMessage: boolean;
    parentCommentId: string | null;
    other_TaskComment: Array<{
      id: string;
      authorShopId: string;
      content: string;
      isSystemMessage: boolean;
      parentCommentId: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>;
    createdAt: Date;
    updatedAt: Date;
  }): CommentWithAuthor => {
    const mapReply = (reply: {
      id: string;
      authorShopId: string;
      content: string;
      isSystemMessage: boolean;
      parentCommentId: string | null;
      createdAt: Date;
      updatedAt: Date;
    }): CommentWithAuthor => ({
      id: reply.id,
      taskId: c.taskId,
      authorShopId: reply.authorShopId,
      authorShopDomain: shopMap.get(reply.authorShopId) || "Unknown",
      content: reply.content,
      isSystemMessage: reply.isSystemMessage,
      parentCommentId: reply.parentCommentId,
      replies: [],
      createdAt: reply.createdAt,
      updatedAt: reply.updatedAt,
    });
    return {
      id: c.id,
      taskId: c.taskId,
      authorShopId: c.authorShopId,
      authorShopDomain: shopMap.get(c.authorShopId) || "Unknown",
      content: c.content,
      isSystemMessage: c.isSystemMessage,
      parentCommentId: c.parentCommentId,
      replies: c.other_TaskComment.map(mapReply),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  };
  return comments.map(mapComment);
}

export async function createSystemComment(
  taskId: string,
  content: string
): Promise<void> {
  try {
    await prisma.taskComment.create({
      data: {
        id: randomUUID(),
        taskId,
        authorShopId: "",
        content,
        isSystemMessage: true,
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    logger.error("Failed to create system comment:", error);
  }
}
