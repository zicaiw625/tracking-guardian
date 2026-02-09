import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";
import { getValidCredentials } from "~/services/credentials.server";
import { listPendingJobs, markSent, markFailed, type ListPendingJobsResult } from "./queue";
import { sendEvent as sendGa4 } from "~/services/destinations/ga4";
import { sendEvent as sendMeta } from "~/services/destinations/meta";
import { sendEvent as sendTiktok } from "~/services/destinations/tiktok";
import type { InternalEventPayload } from "~/services/destinations/types";
import type { GoogleCredentials, MetaCredentials, TikTokCredentials } from "~/types";
import { getRedisClient } from "~/utils/redis-client.server";

const DEFAULT_MAX_JOBS = 100;
const RATE_LIMIT_WINDOW_SECONDS = 10;
const RATE_LIMIT_MAX_REQUESTS = 50; // 5 req/s average

const DESTINATION_TO_PLATFORM: Record<string, string> = {
  GA4: "google",
  META: "meta",
  TIKTOK: "tiktok",
};

function toInternalEventPayload(ie: ListPendingJobsResult["InternalEvent"]): InternalEventPayload {
  return {
    id: ie.id,
    shopId: ie.shopId,
    source: ie.source,
    event_name: ie.event_name,
    event_id: ie.event_id,
    client_id: ie.client_id,
    timestamp: ie.timestamp,
    occurred_at: ie.occurred_at,
    ip: ie.ip,
    ip_encrypted: ie.ip_encrypted,
    user_agent: ie.user_agent,
    user_agent_encrypted: ie.user_agent_encrypted,
    page_url: ie.page_url,
    referrer: ie.referrer,
    querystring: ie.querystring,
    currency: ie.currency,
    value: ie.value,
    transaction_id: ie.transaction_id,
    items: ie.items,
    user_data_hashed: ie.user_data_hashed,
    consent_purposes: ie.consent_purposes,
  };
}

export async function runDispatchWorker(options?: { maxJobs?: number }): Promise<{
  processed: number;
  sent: number;
  failed: number;
}> {
  if (process.env.SERVER_SIDE_CONVERSIONS_ENABLED !== "true") {
    return { processed: 0, sent: 0, failed: 0 };
  }
  const maxJobs = options?.maxJobs ?? DEFAULT_MAX_JOBS;
  const now = new Date();
  const jobs = await listPendingJobs(maxJobs, now);
  let sent = 0;
  let failed = 0;

  const uniquePairs = new Map<string, { shopId: string; platform: string; environment: string }>();
  for (const job of jobs) {
    const platform = DESTINATION_TO_PLATFORM[job.destination];
    if (platform) {
      const environment = job.InternalEvent.environment;
      uniquePairs.set(`${job.InternalEvent.shopId}:${platform}:${environment}`, {
        shopId: job.InternalEvent.shopId,
        platform,
        environment,
      });
    }
  }

  const configsMap = new Map<string, { shopId: string; platform: string; credentialsEncrypted: string | null; credentials_legacy: any; environment: string }>();
  if (uniquePairs.size > 0) {
    const configs = await prisma.pixelConfig.findMany({
      where: {
        OR: Array.from(uniquePairs.values()).map((p) => ({
          shopId: p.shopId,
          platform: p.platform,
          serverSideEnabled: true,
          isActive: true,
          environment: p.environment,
        })),
      },
      select: {
        shopId: true,
        platform: true,
        credentialsEncrypted: true,
        credentials_legacy: true,
        environment: true,
      },
    });
    for (const c of configs) {
      configsMap.set(`${c.shopId}:${c.platform}:${c.environment}`, c);
    }
  }

  let redis;
  try {
    redis = await getRedisClient();
  } catch (error) {
    logger.warn("Redis unavailable for dispatch worker, proceeding without idempotency/rate-limit", { error: String(error) });
  }

  for (const job of jobs) {
    if (redis) {
      const idempotencyKey = `dispatch:idempotency:${job.InternalEvent.shopId}:${job.destination}:${job.InternalEvent.event_id}`;
      try {
        const isProcessed = await redis.get(idempotencyKey);
        if (isProcessed) {
          logger.info(`[Dispatch Idempotency] Skipping duplicate: ${job.id}`);
          await markSent(job.id);
          sent++;
          continue;
        }
      } catch (e) {
        logger.warn("Failed to check idempotency", { error: String(e) });
      }

      const rateLimitKey = `dispatch:ratelimit:${job.InternalEvent.shopId}:${job.destination}`;
      try {
        const currentRate = await redis.incr(rateLimitKey);
        if (currentRate === 1) {
          await redis.expire(rateLimitKey, RATE_LIMIT_WINDOW_SECONDS);
        }
        if (currentRate > RATE_LIMIT_MAX_REQUESTS) {
          logger.warn(`[Dispatch Rate Limit] Exceeded for ${job.InternalEvent.shopId}:${job.destination}`);
          // Skip this job for now, it will be retried later
          continue;
        }
      } catch (e) {
        logger.warn("Failed to check rate limit", { error: String(e) });
      }
    }

    const platform = DESTINATION_TO_PLATFORM[job.destination];
    if (!platform) {
      await markFailed(job.id, `Unknown destination: ${job.destination}`, null, job.attempts + 1);
      failed++;
      continue;
    }
    const environment = job.InternalEvent.environment;
    const config = configsMap.get(`${job.InternalEvent.shopId}:${platform}:${environment}`);
    if (!config) {
      await markFailed(job.id, "No S2S credentials for destination", null, job.attempts + 1);
      failed++;
      continue;
    }
    const credResult = getValidCredentials(
      { credentialsEncrypted: config.credentialsEncrypted, credentials_legacy: config.credentials_legacy, platform },
      platform
    );
    if (!credResult.ok) {
      await markFailed(job.id, credResult.error.message, null, job.attempts + 1);
      failed++;
      continue;
    }
    const payload = toInternalEventPayload(job.InternalEvent);
    let result: { ok: boolean; statusCode?: number; error?: string };
    try {
      if (job.destination === "GA4") {
        result = await sendGa4(payload, credResult.value.credentials as GoogleCredentials);
      } else if (job.destination === "META") {
        result = await sendMeta(payload, credResult.value.credentials as MetaCredentials);
      } else if (job.destination === "TIKTOK") {
        result = await sendTiktok(payload, credResult.value.credentials as TikTokCredentials);
      } else {
        await markFailed(job.id, `Unsupported destination: ${job.destination}`, null, job.attempts + 1);
        failed++;
        continue;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Dispatch worker adapter threw", { jobId: job.id, destination: job.destination, error: message });
      await markFailed(job.id, message, null, job.attempts + 1);
      failed++;
      continue;
    }
    if (result.ok) {
      if (redis) {
        const idempotencyKey = `dispatch:idempotency:${job.InternalEvent.shopId}:${job.destination}:${job.InternalEvent.event_id}`;
        try {
          await redis.set(idempotencyKey, "1", { EX: 86400 });
        } catch (e) {
          logger.warn("Failed to set idempotency key", { error: String(e) });
        }
      }
      await markSent(job.id);
      sent++;
    } else {
      await markFailed(
        job.id,
        result.error ?? "Unknown error",
        result.statusCode ?? null,
        job.attempts + 1
      );
      failed++;
    }
  }

  return { processed: jobs.length, sent, failed };
}
