

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
          logger.warn(
            `[Webhook Idempotency] Dead lock detected for ${topic}/${webhookId}. Taking over.`
          );

          await prisma.webhookLog.update({
            where: {
              shopDomain_webhookId_topic: {
                shopDomain,
                webhookId,
                topic,
              },
            },
            data: {
              receivedAt: new Date(),
            },
          });

          return { acquired: true };
        }
      }

      logger.info(
        `[Webhook Idempotency] Duplicate webhook detected: ${topic} for ${shopDomain}, webhookId=${webhookId}`
      );
      return { acquired: false, existing: true };
    }

    logger.error(`[Webhook] Failed to acquire lock: ${error}`);
    return { acquired: true };
  }
}

export async function updateWebhookStatus(
  shopDomain: string,
  webhookId: string,
  topic: string,
  status: typeof WebhookStatus.PROCESSED | typeof WebhookStatus.FAILED,
  orderId?: string
): Promise<void> {
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
  } catch (error) {
    logger.error(`[Webhook] Failed to update status: ${error}`);
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

    return handler(context, ...args);
  };
}

