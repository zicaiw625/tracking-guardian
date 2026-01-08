import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { WebhookStatus } from "../../types";
import { updateWebhookStatus } from "../../webhooks/middleware/idempotency";

export interface WebhookMonitorResult {
  checked: number;
  stuckFound: number;
  recovered: number;
  failed: number;
  oldestStuckAge: number | null;
}

/**
 * 监控长期处于 PROCESSING 状态的 webhook
 * 对于超过5分钟仍未完成的 webhook，尝试标记为 FAILED 以恢复
 */
export async function monitorStuckWebhooks(): Promise<WebhookMonitorResult> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  
  // 查找所有超过5分钟仍处于 PROCESSING 状态的 webhook
  const stuckWebhooks = await prisma.webhookLog.findMany({
    where: {
      status: WebhookStatus.PROCESSING,
      receivedAt: {
        lt: fiveMinutesAgo,
      },
    },
    select: {
      id: true,
      shopDomain: true,
      webhookId: true,
      topic: true,
      receivedAt: true,
    },
    orderBy: {
      receivedAt: "asc",
    },
    take: 100, // 每次最多处理100个，避免一次性处理太多
  });

  if (stuckWebhooks.length === 0) {
    return {
      checked: 0,
      stuckFound: 0,
      recovered: 0,
      failed: 0,
      oldestStuckAge: null,
    };
  }

  logger.warn(
    `[Webhook Monitor] Found ${stuckWebhooks.length} stuck webhook(s) in PROCESSING status`,
    {
      count: stuckWebhooks.length,
      oldestReceivedAt: stuckWebhooks[0]?.receivedAt,
    }
  );

  let recovered = 0;
  let failed = 0;
  const now = Date.now();
  let oldestStuckAge: number | null = null;

  for (const webhook of stuckWebhooks) {
    const ageMs = now - webhook.receivedAt.getTime();
    const ageMinutes = Math.floor(ageMs / (60 * 1000));

    if (oldestStuckAge === null || ageMs > oldestStuckAge) {
      oldestStuckAge = ageMs;
    }

    // 对于超过10分钟的，直接标记为失败
    // 对于5-10分钟的，尝试通过更新 receivedAt 来触发死锁接管机制
    // 但这里我们直接标记为失败，因为已经超过了预期的处理时间
    try {
      await updateWebhookStatus(
        webhook.shopDomain,
        webhook.webhookId,
        webhook.topic,
        WebhookStatus.FAILED
      );
      recovered++;
      logger.info(
        `[Webhook Monitor] Recovered stuck webhook: ${webhook.topic}/${webhook.webhookId} (age: ${ageMinutes} minutes)`,
        {
          shopDomain: webhook.shopDomain,
          topic: webhook.topic,
          webhookId: webhook.webhookId,
          ageMinutes,
          receivedAt: webhook.receivedAt,
        }
      );
    } catch (error) {
      failed++;
      logger.error(
        `[Webhook Monitor] Failed to recover stuck webhook: ${webhook.topic}/${webhook.webhookId}`,
        error,
        {
          shopDomain: webhook.shopDomain,
          topic: webhook.topic,
          webhookId: webhook.webhookId,
          ageMinutes,
        }
      );
    }
  }

  // 如果有超过10分钟的 stuck webhook，记录警告
  const criticalStuck = stuckWebhooks.filter(
    (w) => w.receivedAt < tenMinutesAgo
  );
  if (criticalStuck.length > 0) {
    logger.error(
      `[Webhook Monitor] CRITICAL: Found ${criticalStuck.length} webhook(s) stuck for more than 10 minutes!`,
      undefined,
      {
        count: criticalStuck.length,
        oldestReceivedAt: criticalStuck[0]?.receivedAt,
        topics: [...new Set(criticalStuck.map((w) => w.topic))],
        shopDomains: [...new Set(criticalStuck.map((w) => w.shopDomain))],
      }
    );
  }

  return {
    checked: stuckWebhooks.length,
    stuckFound: stuckWebhooks.length,
    recovered,
    failed,
    oldestStuckAge: oldestStuckAge ? Math.floor(oldestStuckAge / 1000) : null, // 转换为秒
  };
}
