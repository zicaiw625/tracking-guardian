import prisma from "../../db.server";
import { WebhookStatus } from "../../types";
import { logger } from "../../utils/logger.server";
import type { WebhookLockResult } from "../types";
import { isPrismaError, getPrismaErrorCode } from "../../utils/type-guards";
import { generateSimpleId } from "../../utils/helpers";

export async function tryAcquireWebhookLock(
  shopDomain: string,
  webhookId: string | null,
  topic: string,
  orderId?: string
): Promise<WebhookLockResult> {

  if (!webhookId) {
    logger.warn(
      `[Webhook] Missing X-Shopify-Webhook-Id for topic ${topic} from ${shopDomain}`
    );
    return { acquired: true };
  }

  try {
    await prisma.webhookLog.create({
      data: {
        id: generateSimpleId("webhook") || crypto.randomUUID(),
        shopDomain,
        webhookId,
        topic,
        orderId,
        status: WebhookStatus.PROCESSING,
        receivedAt: new Date(),
      },
    });
    return { acquired: true };
  } catch (error) {
    if (isPrismaError(error) && getPrismaErrorCode(error) === "P2002") {

      const existing = await prisma.webhookLog.findUnique({
        where: {
          shopDomain_webhookId_topic: {
            shopDomain,
            webhookId,
            topic,
          },
        },
        select: { status: true, receivedAt: true },
      });

      if (existing?.status === WebhookStatus.PROCESSING) {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        if (existing.receivedAt < fiveMinutesAgo) {
          try {
            // 使用原子更新操作,只更新在检测时仍处于死锁状态的记录
            // 这样可以减少多个实例同时获取锁的可能性
            const now = new Date();
            const updated = await prisma.webhookLog.updateMany({
              where: {
                shopDomain,
                webhookId,
                topic,
                status: WebhookStatus.PROCESSING,
                receivedAt: {
                  lt: fiveMinutesAgo,
                },
              },
              data: {
                receivedAt: now,
              },
            });

            if (updated.count > 0) {
              // 验证更新是否成功,并且确保我们是最新的接收者
              // 这提供了额外的保护,防止多个实例都认为获取了锁
              const verify = await prisma.webhookLog.findUnique({
                where: {
                  shopDomain_webhookId_topic: {
                    shopDomain,
                    webhookId,
                    topic,
                  },
                },
                select: { receivedAt: true, status: true },
              });

              // 双重验证: 确保receivedAt已更新且状态仍为PROCESSING
              // 验证逻辑：检查 receivedAt 是否与我们更新时设置的值（now）一致
              // 使用时间戳比较，允许小的数据库处理延迟（最多5秒）
              const verifyNow = new Date(); // 验证时的时间戳，用于检查未来时间
              const toleranceMs = 5000; // 允许5秒的数据库处理延迟容忍度
              const timeDiff = verify ? Math.abs(verify.receivedAt.getTime() - now.getTime()) : Infinity;
              
              if (
                verify &&
                verify.status === WebhookStatus.PROCESSING &&
                verify.receivedAt >= fiveMinutesAgo && // 确保时间已更新
                verify.receivedAt <= verifyNow && // 严格不允许未来时间
                timeDiff <= toleranceMs // 验证 receivedAt 与我们设置的 now 值接近（允许处理延迟）
              ) {
                logger.warn(
                  `[Webhook Idempotency] Dead lock detected for ${topic}/${webhookId}. Taking over.`
                );
                return { acquired: true };
              } else {
                // 验证失败,说明另一个实例可能已经获取了锁或时间检查失败
                logger.info(
                  `[Webhook Idempotency] Dead lock takeover verification failed for ${topic}/${webhookId}. Another instance may have taken over or time check failed.`,
                  {
                    status: verify?.status,
                    receivedAt: verify?.receivedAt,
                    expectedReceivedAt: now,
                    timeDiff: verify ? timeDiff : null,
                    fiveMinutesAgo,
                  }
                );
              }
            }
          } catch (updateError) {
            logger.warn(
              `[Webhook Idempotency] Failed to take over dead lock for ${topic}/${webhookId}: ${updateError}`
            );
            // 更新失败后，重新检查当前状态
            // 如果状态已经不是 PROCESSING，说明另一个实例已经处理了
            try {
              const currentState = await prisma.webhookLog.findUnique({
                where: {
                  shopDomain_webhookId_topic: {
                    shopDomain,
                    webhookId,
                    topic,
                  },
                },
                select: { status: true },
              });
              
              if (currentState?.status !== WebhookStatus.PROCESSING) {
                // 状态已改变，说明另一个实例已经处理
                logger.info(
                  `[Webhook Idempotency] State changed during dead lock takeover attempt for ${topic}/${webhookId}. Current status: ${currentState?.status}`
                );
              }
            } catch (checkError) {
              // 如果重新检查也失败，记录错误但继续执行
              logger.error(
                `[Webhook Idempotency] Failed to re-check state after update failure for ${topic}/${webhookId}: ${checkError}`
              );
            }
          }
        }
      }

      logger.info(
        `[Webhook Idempotency] Duplicate webhook detected: ${topic} for ${shopDomain}, webhookId=${webhookId}`
      );
      return { acquired: false, existing: true };
    }

    logger.error(`[Webhook] Failed to acquire lock: ${error}`);
    return { acquired: false, existing: false };
  }
}

export async function updateWebhookStatus(
  shopDomain: string,
  webhookId: string,
  topic: string,
  status: typeof WebhookStatus.PROCESSED | typeof WebhookStatus.FAILED,
  orderId?: string,
  retries: number = 2
): Promise<void> {
  let lastError: unknown;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await prisma.webhookLog.update({
        where: {
          shopDomain_webhookId_topic: {
            shopDomain,
            webhookId,
            topic,
          },
        },
        data: {
          status,
          orderId,
          processedAt: new Date(),
        },
      });
      // 更新成功，返回
      if (attempt > 0) {
        logger.info(
          `[Webhook] Successfully updated status after ${attempt} retry(ies) for ${topic}/${webhookId}`
        );
      }
      return;
    } catch (error) {
      lastError = error;
      const isPrismaErr = isPrismaError(error);
      const errorCode = isPrismaErr ? getPrismaErrorCode(error) : null;
      
      // 如果是记录不存在（P2025），记录警告但不重试
      if (errorCode === "P2025") {
        logger.warn(
          `[Webhook] Webhook log not found when updating status: ${topic}/${webhookId} for ${shopDomain}`,
          { status, orderId }
        );
        return;
      }
      
      // 如果是最后一次尝试，记录详细错误
      if (attempt === retries) {
        logger.error(
          `[Webhook] Failed to update status after ${retries + 1} attempt(s) for ${topic}/${webhookId}`,
          {
            error: error instanceof Error ? error.message : String(error),
            errorCode,
            shopDomain,
            status,
            orderId,
            stack: error instanceof Error ? error.stack : undefined,
          }
        );
      } else {
        // 记录重试信息
        logger.warn(
          `[Webhook] Status update failed (attempt ${attempt + 1}/${retries + 1}) for ${topic}/${webhookId}, retrying...`,
          {
            error: error instanceof Error ? error.message : String(error),
            errorCode,
          }
        );
        // 等待一小段时间后重试（指数退避）
        await new Promise((resolve) => setTimeout(resolve, Math.min(100 * Math.pow(2, attempt), 1000)));
      }
    }
  }
  
  // 所有重试都失败，但错误已记录
  // 这里不抛出异常，因为调用者可能已经完成了业务逻辑
}

export function withIdempotency<T>(
  handler: (
    context: { shopDomain: string; webhookId: string | null; topic: string },
    ...args: unknown[]
  ) => Promise<T>
) {
  return async (
    context: { shopDomain: string; webhookId: string | null; topic: string },
    ...args: unknown[]
  ): Promise<T | { skipped: true; reason: string }> => {
    const lock = await tryAcquireWebhookLock(
      context.shopDomain,
      context.webhookId,
      context.topic
    );

    if (!lock.acquired) {
      return { skipped: true, reason: "duplicate_webhook" };
    }

    // 如果获取了锁但没有 webhookId，无法更新状态，直接执行 handler
    if (!context.webhookId) {
      return handler(context, ...args);
    }

    try {
      const result = await handler(context, ...args);
      return result;
    } catch (error) {
      // Handler 抛出异常时，更新 webhook 状态为 FAILED
      logger.error(
        `[Webhook Idempotency] Handler threw error for ${context.topic}/${context.webhookId}:`,
        error instanceof Error ? error.message : String(error),
        {
          shopDomain: context.shopDomain,
          topic: context.topic,
          webhookId: context.webhookId,
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      
      // 尝试更新状态为 FAILED
      try {
        await updateWebhookStatus(
          context.shopDomain,
          context.webhookId,
          context.topic,
          WebhookStatus.FAILED
        );
      } catch (statusUpdateError) {
        // 状态更新失败也记录，但不影响错误传播
        logger.error(
          `[Webhook Idempotency] Failed to update status to FAILED after handler error for ${context.topic}/${context.webhookId}:`,
          statusUpdateError
        );
      }
      
      // 重新抛出错误，让调用者知道处理失败
      throw error;
    }
  };
}
