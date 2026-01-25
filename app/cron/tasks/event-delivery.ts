import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { parallelLimit } from "../../utils/helpers";
import type { PixelEventPayload } from "../../lib/pixel-events/types";
import { checkInitialConsent, filterPlatformsByConsent } from "../../lib/pixel-events/consent-filter";
import { getShopPixelConfigs } from "../../services/db/pixel-config-repository.server";
import { processEventPipeline } from "../../services/events/pipeline.server";
import type { Prisma } from "@prisma/client";
import { getEffectiveConsentCategory } from "../../utils/platform-consent";

export async function processEventDelivery(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
}> {
  const batchSize = Math.max(1, Number.parseInt(process.env.EVENT_DELIVERY_BATCH_SIZE || "100", 10) || 100);
  const maxBatches = Math.max(1, Number.parseInt(process.env.EVENT_DELIVERY_MAX_BATCHES || "10", 10) || 10);
  const lookbackHours = Math.max(1, Number.parseInt(process.env.EVENT_DELIVERY_LOOKBACK_HOURS || "24", 10) || 24);
  const concurrency = Math.max(1, Number.parseInt(process.env.EVENT_DELIVERY_CONCURRENCY || "5", 10) || 5);

  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  let lastCreatedAt: Date | null = null;
  let lastId: string | null = null;

  for (let batch = 0; batch < maxBatches; batch++) {
    const pageWhere: Prisma.EventLogWhereInput = lastCreatedAt && lastId
      ? {
          OR: [
            { createdAt: { gt: lastCreatedAt } },
            { createdAt: { equals: lastCreatedAt }, id: { gt: lastId } },
          ],
        }
      : {};

    const logs: Array<{
      id: string;
      shopId: string;
      eventId: string;
      eventName: string;
      createdAt: Date;
      normalizedEventJson: unknown;
    }> = await prisma.eventLog.findMany({
      where: {
        source: "web_pixel",
        createdAt: { gte: since },
        ...pageWhere,
        OR: [
          { DeliveryAttempt: { none: {} } },
          { DeliveryAttempt: { some: { status: { in: ["fail", "pending"] } } } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: batchSize,
      select: {
        id: true,
        shopId: true,
        eventId: true,
        eventName: true,
        createdAt: true,
        normalizedEventJson: true,
      },
    });

    if (logs.length === 0) {
      break;
    }

    lastCreatedAt = logs[logs.length - 1].createdAt;
    lastId = logs[logs.length - 1].id;

    await parallelLimit(logs, concurrency, async (log) => {
      try {
        const payload = log.normalizedEventJson as unknown as PixelEventPayload | null;
        if (!payload || typeof payload !== "object") {
          skipped++;
          processed++;
          return true;
        }

        const consentResult = checkInitialConsent(payload.consent);
        if (!consentResult.hasAnyConsent) {
          skipped++;
          processed++;
          return true;
        }

        const env = (payload.data as { environment?: "test" | "live" } | undefined)?.environment || "live";
        const configs = await getShopPixelConfigs(log.shopId, { serverSideOnly: true, environment: env });
        if (configs.length === 0) {
          skipped++;
          processed++;
          return true;
        }

        const mappedConfigs = configs.map((config) => ({
          platform: config.platform,
          id: config.id,
          platformId: config.platformId,
          clientConfig: config.clientConfig && typeof config.clientConfig === "object" && "treatAsMarketing" in (config.clientConfig as object)
            ? { treatAsMarketing: (config.clientConfig as { treatAsMarketing?: boolean }).treatAsMarketing }
            : null,
        }));

        const { platformsToRecord } = filterPlatformsByConsent(mappedConfigs, consentResult);
        const destinations = Array.from(new Set(platformsToRecord.map((p) => p.platform)));
        if (destinations.length === 0) {
          skipped++;
          processed++;
          return true;
        }

        const finalDestinations = (() => {
          if (payload.eventName !== "checkout_completed") {
            return destinations;
          }
          const treatAsMarketingByPlatform = new Map<string, boolean>();
          for (const c of mappedConfigs) {
            if (c.clientConfig?.treatAsMarketing === true) {
              treatAsMarketingByPlatform.set(c.platform, true);
            } else if (!treatAsMarketingByPlatform.has(c.platform)) {
              treatAsMarketingByPlatform.set(c.platform, false);
            }
          }
          return destinations.filter((platform) => {
            const treatAsMarketing = treatAsMarketingByPlatform.get(platform) === true;
            return getEffectiveConsentCategory(platform, treatAsMarketing) === "analytics";
          });
        })();
        if (finalDestinations.length === 0) {
          skipped++;
          processed++;
          return true;
        }

        const r = await processEventPipeline(log.shopId, payload, log.eventId, finalDestinations, env);
        processed++;
        if (r.success) {
          succeeded++;
        } else {
          failed++;
        }
        return true;
      } catch (error) {
        processed++;
        failed++;
        logger.warn("processEventDelivery failed for eventLog", {
          eventLogId: log.id,
          shopId: log.shopId,
          eventId: log.eventId,
          eventName: log.eventName,
          error: error instanceof Error ? error.message : String(error),
        });
        return true;
      }
    });
  }

  logger.info("[Cron] Event delivery processing completed", {
    processed,
    succeeded,
    failed,
    skipped,
    since: since.toISOString(),
  });

  return { processed, succeeded, failed, skipped };
}

