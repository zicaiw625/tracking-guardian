

import { getRedisClient, getRedisClientSync, type RedisClientWrapper } from "./redis-client";
import { logger } from "./logger.server";

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitResult {
  isLimited: boolean;
  remaining: number;
  resetTime: number;
  retryAfter: number;
}

const RATE_LIMIT_PREFIX = "tg:rl:";

const DEFAULT_CONFIGS: Record<string, RateLimitConfig> = {
  api: {
    maxRequests: 100,
    windowMs: 60 * 1000,
  },
  cron: {
    maxRequests: 5,
    windowMs: 60 * 60 * 1000,
  },
  survey: {
    maxRequests: 10,
    windowMs: 60 * 1000,
  },
  webhook: {
    maxRequests: 1000,
    windowMs: 60 * 1000,
  },
  "pixel-events": {
    maxRequests: 200,
    windowMs: 60 * 1000,
  },
  "pixel-events-checkout": {
    maxRequests: 50,
    windowMs: 60 * 1000,
  },
  "pixel-events-invalid-key": {
    maxRequests: 10,
    windowMs: 60 * 1000,
  },
  "pixel-events-invalid-origin": {
    maxRequests: 5,
    windowMs: 60 * 1000,
  },
  "pixel-events-invalid-timestamp": {
    maxRequests: 10,
    windowMs: 60 * 1000,
  },
  "pixel-events-unsigned": {
    maxRequests: 20,
    windowMs: 60 * 1000,
  },
};

interface AnomalyTracker {
  invalidKeyCount: number;
  invalidOriginCount: number;
  invalidTimestampCount: number;
  lastReset: number;
}

const anomalyTrackers = new Map<string, AnomalyTracker>();
const ANOMALY_WINDOW_MS = 5 * 60 * 1000;

const ANOMALY_THRESHOLDS = {
  invalidKey: 25,
  invalidOrigin: 50,
  invalidTimestamp: 50,
  composite: 75,
  warningRatio: 0.5,
};

const blockedShops = new Map<string, { blockedAt: number; reason: string }>();
const BLOCKED_SHOP_COOLDOWN_MS = 10 * 60 * 1000;

export function trackAnomaly(
  shopDomain: string,
  type: "invalid_key" | "invalid_origin" | "invalid_timestamp"
): {
  shouldBlock: boolean;
  reason?: string;
  severity?: "warning" | "critical";
} {
  const now = Date.now();

  const blocked = blockedShops.get(shopDomain);
  if (blocked && now - blocked.blockedAt < BLOCKED_SHOP_COOLDOWN_MS) {
    return { shouldBlock: true, reason: blocked.reason, severity: "critical" };
  }

  let tracker = anomalyTrackers.get(shopDomain);
  if (!tracker || now - tracker.lastReset > ANOMALY_WINDOW_MS) {
    tracker = {
      invalidKeyCount: 0,
      invalidOriginCount: 0,
      invalidTimestampCount: 0,
      lastReset: now,
    };
    anomalyTrackers.set(shopDomain, tracker);
  }

  switch (type) {
    case "invalid_key":
      tracker.invalidKeyCount++;
      break;
    case "invalid_origin":
      tracker.invalidOriginCount++;
      break;
    case "invalid_timestamp":
      tracker.invalidTimestampCount++;
      break;
  }

  const totalAnomalies =
    tracker.invalidKeyCount +
    tracker.invalidOriginCount +
    tracker.invalidTimestampCount;
  const warningThreshold = Math.floor(
    ANOMALY_THRESHOLDS.composite * ANOMALY_THRESHOLDS.warningRatio
  );

  if (
    totalAnomalies >= warningThreshold &&
    totalAnomalies < ANOMALY_THRESHOLDS.composite
  ) {
    return {
      shouldBlock: false,
      reason: `Approaching anomaly threshold (${totalAnomalies}/${ANOMALY_THRESHOLDS.composite})`,
      severity: "warning",
    };
  }

  if (totalAnomalies >= ANOMALY_THRESHOLDS.composite) {
    const reason =
      `Too many total anomalies (${totalAnomalies}): ` +
      `key=${tracker.invalidKeyCount}, origin=${tracker.invalidOriginCount}, ` +
      `timestamp=${tracker.invalidTimestampCount}`;
    blockedShops.set(shopDomain, { blockedAt: now, reason });
    return { shouldBlock: true, reason, severity: "critical" };
  }

  if (tracker.invalidKeyCount >= ANOMALY_THRESHOLDS.invalidKey) {
    const reason = `Too many invalid key requests (${tracker.invalidKeyCount})`;
    blockedShops.set(shopDomain, { blockedAt: now, reason });
    return { shouldBlock: true, reason, severity: "critical" };
  }

  if (tracker.invalidOriginCount >= ANOMALY_THRESHOLDS.invalidOrigin) {
    const reason = `Too many invalid origin requests (${tracker.invalidOriginCount})`;
    blockedShops.set(shopDomain, { blockedAt: now, reason });
    return { shouldBlock: true, reason, severity: "critical" };
  }

  if (tracker.invalidTimestampCount >= ANOMALY_THRESHOLDS.invalidTimestamp) {
    const reason = `Too many invalid timestamp requests (${tracker.invalidTimestampCount})`;
    blockedShops.set(shopDomain, { blockedAt: now, reason });
    return { shouldBlock: true, reason, severity: "critical" };
  }

  return { shouldBlock: false };
}

export function unblockShop(shopDomain: string): boolean {
  const wasBlocked = blockedShops.has(shopDomain);
  blockedShops.delete(shopDomain);
  anomalyTrackers.delete(shopDomain);
  return wasBlocked;
}

export function clearAllTracking(): void {
  blockedShops.clear();
  anomalyTrackers.clear();
}

export function getBlockedShops(): Array<{
  shopDomain: string;
  blockedAt: Date;
  reason: string;
  remainingMs: number;
}> {
  const now = Date.now();
  const result: Array<{
    shopDomain: string;
    blockedAt: Date;
    reason: string;
    remainingMs: number;
  }> = [];

  blockedShops.forEach((info, shopDomain) => {
    const remainingMs = BLOCKED_SHOP_COOLDOWN_MS - (now - info.blockedAt);
    if (remainingMs > 0) {
      result.push({
        shopDomain,
        blockedAt: new Date(info.blockedAt),
        reason: info.reason,
        remainingMs,
      });
    } else {
      blockedShops.delete(shopDomain);
    }
  });

  return result;
}

export function getAnomalyStats(): Array<{
  shopDomain: string;
  invalidKeyCount: number;
  invalidOriginCount: number;
  invalidTimestampCount: number;
  ageMs: number;
}> {
  const now = Date.now();
  const stats: Array<{
    shopDomain: string;
    invalidKeyCount: number;
    invalidOriginCount: number;
    invalidTimestampCount: number;
    ageMs: number;
  }> = [];

  anomalyTrackers.forEach((tracker, shopDomain) => {
    if (now - tracker.lastReset <= ANOMALY_WINDOW_MS) {
      stats.push({
        shopDomain,
        invalidKeyCount: tracker.invalidKeyCount,
        invalidOriginCount: tracker.invalidOriginCount,
        invalidTimestampCount: tracker.invalidTimestampCount,
        ageMs: now - tracker.lastReset,
      });
    }
  });

  return stats.sort(
    (a, b) =>
      b.invalidKeyCount +
      b.invalidOriginCount +
      b.invalidTimestampCount -
      (a.invalidKeyCount + a.invalidOriginCount + a.invalidTimestampCount)
  );
}

export function cleanupAnomalyTrackers(): number {
  const now = Date.now();
  let cleaned = 0;

  anomalyTrackers.forEach((tracker, shopDomain) => {
    if (now - tracker.lastReset > ANOMALY_WINDOW_MS) {
      anomalyTrackers.delete(shopDomain);
      cleaned++;
    }
  });

  return cleaned;
}

function sanitizeKeyPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9.\-_]/g, "").slice(0, 100);
}

function getClientIP(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIP = forwardedFor.split(",")[0]?.trim();
    if (firstIP) {
      return sanitizeKeyPart(firstIP);
    }
  }

  const realIP = request.headers.get("x-real-ip");
  if (realIP) {
    return sanitizeKeyPart(realIP.trim());
  }

  return "unknown";
}

function getRateLimitKey(request: Request, endpoint: string): string {
  const sanitizedEndpoint = sanitizeKeyPart(endpoint);
  const ip = getClientIP(request);
  const shop = request.headers.get("x-shopify-shop-domain");

  if (shop) {
    const sanitizedShop = sanitizeKeyPart(shop);
    return `${RATE_LIMIT_PREFIX}${sanitizedEndpoint}:${sanitizedShop}:${ip}`;
  }

  return `${RATE_LIMIT_PREFIX}${sanitizedEndpoint}:ip:${ip}`;
}

export async function checkRateLimitAsync(
  request: Request,
  endpoint: string,
  customConfig?: Partial<RateLimitConfig>
): Promise<RateLimitResult> {
  const config = {
    ...(DEFAULT_CONFIGS[endpoint] || DEFAULT_CONFIGS.api),
    ...customConfig,
  };

  const key = getRateLimitKey(request, endpoint);
  const now = Date.now();

  try {
    const client = await getRedisClient();
    const count = await client.incr(key);

    if (count === 1) {
      const windowSeconds = Math.ceil(config.windowMs / 1000);
      await client.expire(key, windowSeconds);
    }

    const ttl = await client.ttl(key);
    const resetTime = now + (ttl > 0 ? ttl * 1000 : config.windowMs);
    const isLimited = count > config.maxRequests;
    const remaining = Math.max(0, config.maxRequests - count);
    const retryAfter = Math.ceil((resetTime - now) / 1000);

    return { isLimited, remaining, resetTime, retryAfter };
  } catch (error) {
    logger.error("Rate limit check error", error);

    return {
      isLimited: false,
      remaining: config.maxRequests,
      resetTime: now + config.windowMs,
      retryAfter: Math.ceil(config.windowMs / 1000),
    };
  }
}

export function checkRateLimit(
  request: Request,
  endpoint: string,
  customConfig?: Partial<RateLimitConfig>
): RateLimitResult {
  const config = {
    ...(DEFAULT_CONFIGS[endpoint] || DEFAULT_CONFIGS.api),
    ...customConfig,
  };

  const key = getRateLimitKey(request, endpoint);
  const now = Date.now();

  logger.warn(
    "checkRateLimit called (sync version). This function has race conditions. Use checkRateLimitAsync instead."
  );

  return {
    isLimited: false,
    remaining: config.maxRequests,
    resetTime: now + config.windowMs,
    retryAfter: Math.ceil(config.windowMs / 1000),
  };
}

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export function addSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);

  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createRateLimitResponse(retryAfter: number): Response {
  return new Response(
    JSON.stringify({
      error: "Too Many Requests",
      message: "Rate limit exceeded. Please try again later.",
      retryAfter,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": "See endpoint documentation",
        "X-RateLimit-Remaining": "0",
      },
    }
  );
}

export function addRateLimitHeaders(
  response: Response,
  rateLimit: {
    remaining: number;
    resetTime: number;
    maxRequests?: number;
  }
): Response {
  const headers = new Headers(response.headers);
  headers.set("X-RateLimit-Remaining", String(rateLimit.remaining));
  headers.set("X-RateLimit-Reset", String(rateLimit.resetTime));

  if (rateLimit.maxRequests) {
    headers.set("X-RateLimit-Limit", String(rateLimit.maxRequests));
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function withRateLimit<T>(
  endpoint: string,
  handler: (args: { request: Request }) => Promise<T>,
  customConfig?: Partial<RateLimitConfig>
): (args: { request: Request }) => Promise<T | Response> {
  return async (args) => {
    const { isLimited, remaining, resetTime, retryAfter } =
      await checkRateLimitAsync(args.request, endpoint, customConfig);

    if (isLimited) {
      logger.warn(
        `Rate limit exceeded for ${endpoint}: ${getRateLimitKey(args.request, endpoint)}`
      );
      return createRateLimitResponse(retryAfter);
    }

    const response = await handler(args);

    if (response instanceof Response) {
      return addRateLimitHeaders(response, { remaining, resetTime });
    }

    return response;
  };
}

export async function resetRateLimit(
  request: Request,
  endpoint: string
): Promise<void> {
  const key = getRateLimitKey(request, endpoint);
  try {
    const client = await getRedisClient();
    await client.del(key);
  } catch (err) {
    logger.error("Rate limit reset error", err);
  }
}

export function getRateLimitConfig(endpoint: string): RateLimitConfig {
  return DEFAULT_CONFIGS[endpoint] || DEFAULT_CONFIGS.api;
}

export async function getRateLimitStats(): Promise<{
  totalKeys: number;
  blockedShops: number;
  anomalyTrackers: number;
}> {
  try {
    const client = await getRedisClient();
    const keys = await client.keys(`${RATE_LIMIT_PREFIX}*`);

    return {
      totalKeys: keys.length,
      blockedShops: blockedShops.size,
      anomalyTrackers: anomalyTrackers.size,
    };
  } catch {
    return {
      totalKeys: 0,
      blockedShops: blockedShops.size,
      anomalyTrackers: anomalyTrackers.size,
    };
  }
}
