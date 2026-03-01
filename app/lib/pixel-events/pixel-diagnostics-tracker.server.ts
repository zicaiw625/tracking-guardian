import { getRedisClient } from "~/utils/redis-client.server";

const DIAGNOSTIC_TTL_SECONDS = 24 * 60 * 60;
const COUNTS_KEY_PREFIX = "pixel-diagnostics:counts:";
const LATEST_KEY_PREFIX = "pixel-diagnostics:latest:";

export type PixelDiagnosticReason =
  | "missing_ingestion_key"
  | "backend_unavailable"
  | "backend_url_not_injected";

export async function recordPixelDiagnosticSignal(
  shopDomain: string,
  reason: PixelDiagnosticReason
): Promise<void> {
  const redis = await getRedisClient();
  const countsKey = `${COUNTS_KEY_PREFIX}${shopDomain}`;
  const latestKey = `${LATEST_KEY_PREFIX}${shopDomain}`;
  await redis.hIncrBy(countsKey, reason, 1);
  await redis.expire(countsKey, DIAGNOSTIC_TTL_SECONDS);
  await redis.set(
    latestKey,
    JSON.stringify({
      reason,
      timestamp: Date.now(),
    }),
    { EX: DIAGNOSTIC_TTL_SECONDS }
  );
}

export async function getPixelDiagnosticSignals(shopDomain: string): Promise<{
  counts: Record<PixelDiagnosticReason, number>;
  latest: { reason: PixelDiagnosticReason; timestamp: number } | null;
}> {
  const redis = await getRedisClient();
  const countsKey = `${COUNTS_KEY_PREFIX}${shopDomain}`;
  const latestKey = `${LATEST_KEY_PREFIX}${shopDomain}`;
  const [countsRaw, latestRaw] = await Promise.all([
    redis.hGetAll(countsKey),
    redis.get(latestKey),
  ]);
  const counts: Record<PixelDiagnosticReason, number> = {
    missing_ingestion_key: Number(countsRaw.missing_ingestion_key ?? "0"),
    backend_unavailable: Number(countsRaw.backend_unavailable ?? "0"),
    backend_url_not_injected: Number(countsRaw.backend_url_not_injected ?? "0"),
  };
  let latest: { reason: PixelDiagnosticReason; timestamp: number } | null = null;
  if (latestRaw) {
    try {
      const parsed = JSON.parse(latestRaw) as { reason?: string; timestamp?: number };
      if (
        parsed &&
        (parsed.reason === "missing_ingestion_key" ||
          parsed.reason === "backend_unavailable" ||
          parsed.reason === "backend_url_not_injected") &&
        typeof parsed.timestamp === "number"
      ) {
        latest = { reason: parsed.reason, timestamp: parsed.timestamp };
      }
    } catch {
      latest = null;
    }
  }
  return { counts, latest };
}
