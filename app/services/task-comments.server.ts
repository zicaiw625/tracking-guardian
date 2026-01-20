import { logger } from "../utils/logger.server";

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
  logger.debug(`createTaskComment called but migrationTask table no longer exists`, {
    taskId: input.taskId,
    authorShopId,
  });
  return { error: "任务功能已移除" };
}

export async function getTaskComments(taskId: string, requesterShopId: string): Promise<CommentWithAuthor[]> {
  logger.debug(`getTaskComments called but migrationTask table no longer exists`, {
    taskId,
    requesterShopId,
  });
  return [];
}

export async function createSystemComment(
  taskId: string,
  _content: string
): Promise<void> {
  logger.debug(`createSystemComment called but migrationTask table no longer exists`, {
    taskId,
  });
}
