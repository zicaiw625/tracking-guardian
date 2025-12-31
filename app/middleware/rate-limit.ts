

import { json } from "@remix-run/node";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { RATE_LIMIT_CONFIG } from "../utils/config";
import { logger } from "../utils/logger.server";
import {
  getRedisClient,
  getRedisClientSync,
  getRedisConnectionInfo,
  type RedisClientWrapper,
} from "../utils/redis-client";

export interface RateLimitConfig {

  maxRequests: number;

  windowMs: number;

  keyExtractor?: (request: Request) => string;

  skip?: (request: Request) => boolean;

  message?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

export type RateLimitedHandler<T> = (
  args: LoaderFunctionArgs | ActionFunctionArgs
) => Promise<T>;

interface MemoryRateLimitEntry {
  count: number;
  windowStart: number;
}

class InMemoryRateLimitStore {
  private store = new Map<string, MemoryRateLimitEntry>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private readonly maxKeys: number;
  private readonly cleanupIntervalMs: number;

  constructor(maxKeys = 10000, cleanupIntervalMs = 60000) {
    this.maxKeys = maxKeys;
    this.cleanupIntervalMs = cleanupIntervalMs;
    this.startCleanup();
  }

  private startCleanup(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.cleanupIntervalMs);

    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.store.entries()) {

      if (now - entry.windowStart > 5 * 60 * 1000) {
        this.store.delete(key);
        cleaned++;
      }
    }

    if (this.store.size > this.maxKeys) {
      const entries = Array.from(this.store.entries())
        .sort((a, b) => a[1].windowStart - b[1].windowStart);

      const toRemove = entries.slice(0, this.store.size - this.maxKeys);
      for (const [key] of toRemove) {
        this.store.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`[Rate Limit] Memory store cleanup: removed ${cleaned} entries, size: ${this.store.size}`);
    }
  }

  check(key: string, maxRequests: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now - entry.windowStart >= windowMs) {

      if (this.store.size >= this.maxKeys && !entry) {
        this.cleanup();
      }

      this.store.set(key, { count: 1, windowStart: now });
      return {
        allowed: true,
        remaining: maxRequests - 1,
        resetAt: now + windowMs,
      };
    }

    entry.count++;
    const resetAt = entry.windowStart + windowMs;

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((resetAt - now) / 1000);
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfter,
      };
    }

    return {
      allowed: true,
      remaining: maxRequests - entry.count,
      resetAt,
    };
  }

  getSize(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

const memoryRateLimitStore = new InMemoryRateLimitStore(
  RATE_LIMIT_CONFIG.MAX_KEYS,
  RATE_LIMIT_CONFIG.CLEANUP_INTERVAL_MS
);

const RATE_LIMIT_PREFIX = "tg:mw:rl:";

class DistributedRateLimitStore {
  private pendingInit: Promise<RedisClientWrapper> | null = null;
  private redisHealthy = true;
  private lastRedisError: number = 0;
  private readonly redisRetryIntervalMs = 30000;

  private async getClient(): Promise<RedisClientWrapper> {
    if (!this.pendingInit) {
      this.pendingInit = getRedisClient();
    }
    return this.pendingInit;
  }

  private shouldRetryRedis(): boolean {
    if (this.redisHealthy) return true;
    return Date.now() - this.lastRedisError > this.redisRetryIntervalMs;
  }

  private markRedisUnhealthy(): void {
    if (this.redisHealthy) {
      logger.warn("[Rate Limit] Redis unavailable, falling back to in-memory store");
    }
    this.redisHealthy = false;
    this.lastRedisError = Date.now();
  }

  private markRedisHealthy(): void {
    if (!this.redisHealthy) {
      logger.info("[Rate Limit] Redis connection restored");
    }
    this.redisHealthy = true;
  }

  async checkAsync(
    key: string,
    maxRequests: number,
    windowMs: number
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const fullKey = `${RATE_LIMIT_PREFIX}${key}`;
    const windowSeconds = Math.ceil(windowMs / 1000);

    if (!this.shouldRetryRedis()) {
      return memoryRateLimitStore.check(key, maxRequests, windowMs);
    }

    try {
      const client = await this.getClient();
      const count = await client.incr(fullKey);

      if (count === 1) {
        await client.expire(fullKey, windowSeconds);
      }

      const ttl = await client.ttl(fullKey);
      const resetAt = now + (ttl > 0 ? ttl * 1000 : windowMs);

      this.markRedisHealthy();

      if (count > maxRequests) {
        const retryAfter = Math.ceil((resetAt - now) / 1000);
        return {
          allowed: false,
          remaining: 0,
          resetAt,
          retryAfter,
        };
      }

      return {
        allowed: true,
        remaining: maxRequests - count,
        resetAt,
      };
    } catch (error) {

      this.markRedisUnhealthy();
      logger.error("[Rate Limit] Redis error, using memory fallback", error);

      return memoryRateLimitStore.check(key, maxRequests, windowMs);
    }
  }

  check(key: string, maxRequests: number, windowMs: number): RateLimitResult {
    // Synchronous method can only use in-memory store since Redis operations are async
    // Use checkAsync() if Redis-based rate limiting is needed
    return memoryRateLimitStore.check(key, maxRequests, windowMs);
  }

  async getSize(): Promise<number> {
    try {
      const client = await this.getClient();
      const keys = await client.keys(`${RATE_LIMIT_PREFIX}*`);
      return keys.length;
    } catch {

      return memoryRateLimitStore.getSize();
    }
  }

  async clear(): Promise<void> {

    memoryRateLimitStore.clear();

    try {
      const client = await this.getClient();
      const keys = await client.keys(`${RATE_LIMIT_PREFIX}*`);
      for (const key of keys) {
        await client.del(key);
      }
    } catch (error) {
      logger.error("Failed to clear Redis rate limit entries", error);
    }
  }

  getConnectionInfo(): {
    mode: "redis" | "memory";
    connected: boolean;
    usingFallback: boolean;
  } {
    const info = getRedisConnectionInfo();
    return {
      mode: info.mode,
      connected: info.connected,
      usingFallback: !this.redisHealthy,
    };
  }

  getMemoryStoreSize(): number {
    return memoryRateLimitStore.getSize();
  }
}

const rateLimitStore = new DistributedRateLimitStore();

export function ipKeyExtractor(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() ?? "unknown";
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  return "unknown";
}

export function shopKeyExtractor(request: Request): string {
  const url = new URL(request.url);
  return url.searchParams.get("shop") ?? "unknown";
}

export function pathIpKeyExtractor(request: Request): string {
  const url = new URL(request.url);
  const ip = ipKeyExtractor(request);
  return `${url.pathname}:${ip}`;
}

export function pathShopKeyExtractor(request: Request): string {
  const url = new URL(request.url);
  const shop = shopKeyExtractor(request);
  return `${url.pathname}:${shop}`;
}

export function withRateLimit<T>(
  config: RateLimitConfig,
  handler: RateLimitedHandler<T>
): RateLimitedHandler<T | Response> {
  const {
    maxRequests,
    windowMs,
    keyExtractor = ipKeyExtractor,
    skip,
    message = "Too many requests",
  } = config;

  return async (args) => {
    const { request } = args;

    if (skip?.(request)) {
      return handler(args);
    }

    const key = keyExtractor(request);

    const result = await rateLimitStore.checkAsync(key, maxRequests, windowMs);

    const headers = new Headers();
    headers.set("X-RateLimit-Limit", String(maxRequests));
    headers.set("X-RateLimit-Remaining", String(result.remaining));
    headers.set("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));

    if (process.env.NODE_ENV !== "production") {
      const connInfo = rateLimitStore.getConnectionInfo();
      headers.set("X-RateLimit-Backend", connInfo.mode);
    }

    if (!result.allowed) {
      headers.set("Retry-After", String(result.retryAfter));

      logger.warn("Rate limit exceeded", {
        key,
        maxRequests,
        windowMs,
        retryAfter: result.retryAfter,
        backend: rateLimitStore.getConnectionInfo().mode,
      });

      return json(
        {
          success: false,
          error: {
            code: "RATE_LIMITED",
            message,
            retryAfter: result.retryAfter,
          },
        },
        { status: 429, headers }
      );
    }

    const response = await handler(args);

    if (response instanceof Response) {
      for (const [key, value] of headers) {
        response.headers.set(key, value);
      }
    }

    return response;
  };
}

export const standardRateLimit: RateLimitConfig = {
  maxRequests: RATE_LIMIT_CONFIG.PIXEL_EVENTS.maxRequests,
  windowMs: RATE_LIMIT_CONFIG.PIXEL_EVENTS.windowMs,
  keyExtractor: pathShopKeyExtractor,
};

export const strictRateLimit: RateLimitConfig = {
  maxRequests: 10,
  windowMs: 60000,
  keyExtractor: ipKeyExtractor,
};

export const webhookRateLimit: RateLimitConfig = {
  maxRequests: RATE_LIMIT_CONFIG.WEBHOOKS.maxRequests,
  windowMs: RATE_LIMIT_CONFIG.WEBHOOKS.windowMs,
  keyExtractor: shopKeyExtractor,
};

export async function checkRateLimitAsync(
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<RateLimitResult> {
  return rateLimitStore.checkAsync(key, maxRequests, windowMs);
}

export function checkRateLimitSync(
  key: string,
  maxRequests: number,
  windowMs: number
): RateLimitResult {
  return rateLimitStore.check(key, maxRequests, windowMs);
}

export async function getRateLimitStoreSize(): Promise<number> {
  return rateLimitStore.getSize();
}

export async function clearRateLimitStore(): Promise<void> {
  await rateLimitStore.clear();
}

export function getRateLimitBackendInfo(): {
  mode: "redis" | "memory";
  connected: boolean;
  usingFallback: boolean;
} {
  return rateLimitStore.getConnectionInfo();
}

export function getMemoryRateLimitStoreSize(): number {
  return rateLimitStore.getMemoryStoreSize();
}
