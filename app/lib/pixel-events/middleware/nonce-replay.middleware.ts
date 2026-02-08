import { jsonWithCors } from "../cors";
import { logger } from "~/utils/logger.server";
import { RETENTION_CONFIG, isStrictSecurityMode } from "~/utils/config.server";
import { getRedisClientStrict } from "~/utils/redis-client.server";
import { rejectionTracker } from "../rejection-tracker.server";
import { shouldRecordRejection } from "../stats-sampling";
import type { IngestContext, IngestMiddleware, MiddlewareResult } from "./types";

function isPurchaseEventName(eventName: string): boolean {
  return eventName === "checkout_completed" || eventName === "purchase";
}

export const nonceReplayProtectionMiddleware: IngestMiddleware = async (
  context: IngestContext
): Promise<MiddlewareResult> => {
  // Only enforce replay protection for trusted (HMAC matched) purchase events.
  if (!context.keyValidation?.matched) {
    return { continue: true, context };
  }
  if (!context.shop?.id) {
    return { continue: true, context };
  }

  const ttlMs = RETENTION_CONFIG.NONCE_EXPIRY_MS;
  const purchaseEventsWithNonce = context.validatedEvents.filter(({ payload }) => {
    if (!payload || typeof payload !== "object") return false;
    if (!isPurchaseEventName(payload.eventName)) return false;
    const nonce = (payload as { nonce?: unknown }).nonce;
    return typeof nonce === "string" && nonce.trim() !== "";
  });

  if (purchaseEventsWithNonce.length === 0) {
    return { continue: true, context };
  }

  // De-dupe nonces within the batch to reduce Redis calls.
  const nonceToIndexes = new Map<string, number[]>();
  for (const { payload, index } of purchaseEventsWithNonce) {
    const nonce = (payload as { nonce: string }).nonce.trim();
    const list = nonceToIndexes.get(nonce) ?? [];
    list.push(index);
    nonceToIndexes.set(nonce, list);
  }

  let redis;
  try {
    redis = await getRedisClientStrict();
  } catch (error) {
    const strict = context.isProduction && isStrictSecurityMode();
    logger.error("[Ingest Nonce] Redis strict unavailable", {
      requestId: context.requestId,
      shopDomain: context.shop.shopDomain,
      strict,
      error: error instanceof Error ? error.message : String(error),
    });
    if (strict) {
      if (shouldRecordRejection(context.isProduction, false, "nonce_check_unavailable")) {
        rejectionTracker.record({
          requestId: context.requestId,
          shopDomain: context.shop.shopDomain,
          reason: "nonce_check_unavailable",
          timestamp: Date.now(),
        });
      }
      return {
        continue: false,
        response: jsonWithCors(
          { error: "Service unavailable" },
          { status: 503, request: context.request, requestId: context.requestId }
        ),
      };
    }
    // Non-production: allow processing to continue (fail open).
    return { continue: true, context };
  }

  const replayNonces = new Set<string>();
  try {
    for (const [nonce] of nonceToIndexes.entries()) {
      const key = `tg:nonce:${context.shop.id}:purchase:${nonce}`;
      const ok = await redis.setNX(key, "1", ttlMs);
      if (!ok) {
        replayNonces.add(nonce);
      }
    }
  } catch (error) {
    const strict = context.isProduction && isStrictSecurityMode();
    logger.error("[Ingest Nonce] Failed to setNX nonce keys", {
      requestId: context.requestId,
      shopDomain: context.shop.shopDomain,
      strict,
      error: error instanceof Error ? error.message : String(error),
    });
    if (strict) {
      if (shouldRecordRejection(context.isProduction, false, "nonce_check_unavailable")) {
        rejectionTracker.record({
          requestId: context.requestId,
          shopDomain: context.shop.shopDomain,
          reason: "nonce_check_unavailable",
          timestamp: Date.now(),
        });
      }
      return {
        continue: false,
        response: jsonWithCors(
          { error: "Service unavailable" },
          { status: 503, request: context.request, requestId: context.requestId }
        ),
      };
    }
    return { continue: true, context };
  }

  if (replayNonces.size === 0) {
    return { continue: true, context };
  }

  // Drop only replayed purchase events; keep other events in the batch.
  const filteredValidatedEvents = context.validatedEvents.filter(({ payload }) => {
    if (!payload || typeof payload !== "object") return true;
    if (!isPurchaseEventName(payload.eventName)) return true;
    const nonce = (payload as { nonce?: unknown }).nonce;
    if (typeof nonce !== "string") return true;
    const normalized = nonce.trim();
    if (!normalized) return true;
    return !replayNonces.has(normalized);
  });

  const dropped = context.validatedEvents.length - filteredValidatedEvents.length;
  logger.info("[Ingest Nonce] Dropped replayed purchase event(s)", {
    requestId: context.requestId,
    shopDomain: context.shop.shopDomain,
    dropped,
    remaining: filteredValidatedEvents.length,
  });

  if (shouldRecordRejection(context.isProduction, false, "replay_detected")) {
    rejectionTracker.record({
      requestId: context.requestId,
      shopDomain: context.shop.shopDomain,
      reason: "replay_detected",
      timestamp: Date.now(),
    });
  }

  return {
    continue: true,
    context: {
      ...context,
      validatedEvents: filteredValidatedEvents,
    },
  };
};
