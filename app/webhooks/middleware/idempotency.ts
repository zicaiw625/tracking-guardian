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

              
              
              
              const verifyNow = new Date(); 
              const toleranceMs = 5000; 
              const timeDiff = verify ? Math.abs(verify.receivedAt.getTime() - now.getTime()) : Infinity;
              
              if (
                verify &&
                verify.status === WebhookStatus.PROCESSING &&
                verify.receivedAt >= fiveMinutesAgo && 
                verify.receivedAt <= verifyNow && 
                timeDiff <= toleranceMs 
              ) {
                logger.warn(
                  `[Webhook Idempotency] Dead lock detected for ${topic}/${webhookId}. Taking over.`
                );
                return { acquired: true };
              } else {
                
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
                
                logger.info(
                  `[Webhook Idempotency] State changed during dead lock takeover attempt for ${topic}/${webhookId}. Current status: ${currentState?.status}`
                );
              }
            } catch (checkError) {
              
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
      
      
      if (errorCode === "P2025") {
        logger.warn(
          `[Webhook] Webhook log not found when updating status: ${topic}/${webhookId} for ${shopDomain}`,
          { status, orderId }
        );
        return;
      }
      
      
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
        
        logger.warn(
          `[Webhook] Status update failed (attempt ${attempt + 1}/${retries + 1}) for ${topic}/${webhookId}, retrying...`,
          {
            error: error instanceof Error ? error.message : String(error),
            errorCode,
          }
        );
        
        await new Promise((resolve) => setTimeout(resolve, Math.min(100 * Math.pow(2, attempt), 1000)));
      }
    }
  }
  
  
  
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

    
    if (!context.webhookId) {
      return handler(context, ...args);
    }

    try {
      const result = await handler(context, ...args);
      return result;
    } catch (error) {
      
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
      
      
      try {
        await updateWebhookStatus(
          context.shopDomain,
          context.webhookId,
          context.topic,
          WebhookStatus.FAILED
        );
      } catch (statusUpdateError) {
        
        logger.error(
          `[Webhook Idempotency] Failed to update status to FAILED after handler error for ${context.topic}/${context.webhookId}:`,
          statusUpdateError
        );
      }
      
      
      throw error;
    }
  };
}
