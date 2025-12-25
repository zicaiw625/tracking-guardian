/**
 * Webhook Idempotency Middleware
 *
 * Ensures webhooks are processed only once using database-based locking.
 */

import prisma from "../../db.server";
import { WebhookStatus } from "../../types";
import { logger } from "../../utils/logger.server";
import type { WebhookLockResult } from "../types";

// =============================================================================
// Lock Acquisition
// =============================================================================

/**
 * Try to acquire an idempotency lock for a webhook.
 * Uses unique constraint on (shopDomain, webhookId, topic) to prevent duplicates.
 *
 * @returns Lock result indicating if processing should proceed
 */
export async function tryAcquireWebhookLock(
  shopDomain: string,
  webhookId: string | null,
  topic: string,
  orderId?: string
): Promise<WebhookLockResult> {
  // If no webhook ID, allow processing (can't deduplicate)
  if (!webhookId) {
    logger.warn(
      `[Webhook] Missing X-Shopify-Webhook-Id for topic ${topic} from ${shopDomain}`
    );
    return { acquired: true };
  }

  try {
    await prisma.webhookLog.create({
      data: {
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
    // P2002 is Prisma's unique constraint violation error code
    if ((error as { code?: string })?.code === "P2002") {
      // Check if the existing lock is stale (dead letter)
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

      // If lock is stuck in PROCESSING for > 5 minutes, assume dead and retry
      if (existing?.status === WebhookStatus.PROCESSING) {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        if (existing.receivedAt < fiveMinutesAgo) {
          logger.warn(
            `[Webhook Idempotency] Dead lock detected for ${topic}/${webhookId}. Taking over.`
          );
          
          // Update timestamp to refresh lock
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

    // For other errors, log but allow processing to prevent data loss
    logger.error(`[Webhook] Failed to acquire lock: ${error}`);
    return { acquired: true };
  }
}

// =============================================================================
// Status Update
// =============================================================================

/**
 * Update the status of a processed webhook.
 */
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

// =============================================================================
// Middleware Wrapper
// =============================================================================

/**
 * Wrap a handler with idempotency checking
 */
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

