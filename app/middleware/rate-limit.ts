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
  expiresAt: number;
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
      if (now >= entry.expiresAt) {
        this.store.delete(key);
        cleaned++;
      }
    }
    if (this.store.size > this.maxKeys) {
      const entries = Array.from(this.store.entries())
        .sort((a, b) => a[1].expiresAt - b[1].expiresAt);
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
    if (!entry || now >= entry.expiresAt) {
      if (this.store.size >= this.maxKeys && !entry) {
        this.cleanup();
      }
      this.store.set(key, { count: 1, windowStart: now, expiresAt: now + windowMs });
      return {
        allowed: true,
        remaining: maxRequests - 1,
        resetAt: now + windowMs,
      };
    }
    entry.count++;
    const resetAt = entry.expiresAt;
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
    return memoryRateLimitStore.check(key, maxRequests, windowMs);
  }
  async getSize(): Promise<number> {
    try {
      const client = await this.getClient();
      let cursor = "0";
      let count = 0;
      do {
        const result = await client.scan(cursor, `${RATE_LIMIT_PREFIX}*`, 500);
        cursor = result.cursor;
        count += result.keys.length;
      } while (cursor !== "0");
      return count;
    } catch {
      return memoryRateLimitStore.getSize();
    }
  }
  async clear(): Promise<void> {
    memoryRateLimitStore.clear();
    try {
      const client = await this.getClient();
      let cursor = "0";
      do {
        const result = await client.scan(cursor, `${RATE_LIMIT_PREFIX}*`, 500);
        cursor = result.cursor;
        if (result.keys.length > 0) {
          await Promise.all(result.keys.map((key) => client.del(key)));
        }
      } while (cursor !== "0");
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

const DEFAULT_TRUSTED_IP_HEADERS = ["x-forwarded-for", "x-real-ip", "cf-connecting-ip"];
const DEVELOPMENT_IP_HEADERS = ["cf-connecting-ip", "x-real-ip", "x-forwarded-for"];

function getTrustedIpHeaders(): string[] {
  const rawHeaders = process.env.RATE_LIMIT_TRUSTED_IP_HEADERS;
  if (!rawHeaders) {
    return DEFAULT_TRUSTED_IP_HEADERS;
  }
  return rawHeaders
    .split(",")
    .map(header => header.trim().toLowerCase())
    .filter(Boolean);
}

function resolveIpFromHeader(headers: Headers, headerName: string): string | null {
  const value = headers.get(headerName);
  if (!value) {
    return null;
  }
  if (headerName === "x-forwarded-for") {
    return value.split(",")[0]?.trim() || null;
  }
  return value;
}

export function ipKeyExtractor(request: Request): string {
  if (!request || typeof request.headers?.get !== "function") {
    logger.warn("[rate-limit] ipKeyExtractor called with invalid request");
    return "unknown";
  }
  const isProduction = process.env.NODE_ENV === "production";
  const trustProxy = process.env.TRUST_PROXY === "true";
  if (isProduction && !trustProxy) {
    return "untrusted";
  }
  const headersToCheck = isProduction ? getTrustedIpHeaders() : DEVELOPMENT_IP_HEADERS;
  if (headersToCheck.length === 0) {
    return isProduction ? "untrusted" : "unknown";
  }
  for (const headerName of headersToCheck) {
    const resolved = resolveIpFromHeader(request.headers, headerName);
    if (resolved) {
      return resolved;
    }
  }
  return isProduction ? "untrusted" : "unknown";
}

export function shopQueryKeyExtractor(request: Request): string {
  if (!request || typeof request.url !== "string") {
    logger.warn("[rate-limit] shopQueryKeyExtractor called with invalid request");
    return "unknown";
  }
  try {
    const url = new URL(request.url);
    return url.searchParams.get("shop") ?? "unknown";
  } catch (error) {
    logger.warn("[rate-limit] shopQueryKeyExtractor failed to parse URL", { error });
    return "unknown";
  }
}

export function shopHeaderKeyExtractor(request: Request): string {
  if (!request || typeof request.headers?.get !== "function") {
    logger.warn("[rate-limit] shopHeaderKeyExtractor called with invalid request");
    return "unknown";
  }
  const shop = request.headers.get("x-shopify-shop-domain");
  if (!shop) {
    return "unknown";
  }
  return shop.replace(/[^a-zA-Z0-9.\-_]/g, "").slice(0, 100) || "unknown";
}

export function pathIpKeyExtractor(request: Request): string {
  if (!request || typeof request.url !== "string") {
    logger.warn("[rate-limit] pathIpKeyExtractor called with invalid request");
    return "unknown:unknown";
  }
  try {
    const url = new URL(request.url);
    const ip = ipKeyExtractor(request);
    return `${url.pathname}:${ip}`;
  } catch (error) {
    logger.warn("[rate-limit] pathIpKeyExtractor failed to parse URL", { error });
    return "unknown:unknown";
  }
}

export function pathShopKeyExtractor(request: Request): string {
  if (!request || typeof request.url !== "string") {
    logger.warn("[rate-limit] pathShopKeyExtractor called with invalid request");
    return "unknown:unknown";
  }
  try {
    const url = new URL(request.url);
    const shop = shopQueryKeyExtractor(request);
    return `${url.pathname}:${shop}`;
  } catch (error) {
    logger.warn("[rate-limit] pathShopKeyExtractor failed to parse URL", { error });
    return "unknown:unknown";
  }
}

export function shopDomainIpKeyExtractor(request: Request): string {
  if (!request || typeof request.headers?.get !== "function") {
    logger.warn("[rate-limit] shopDomainIpKeyExtractor called with invalid request");
    return "unknown:unknown";
  }
  const shop = request.headers.get("x-shopify-shop-domain");
  const ip = ipKeyExtractor(request);
  const sanitizedShop = shop ? shop.replace(/[^a-zA-Z0-9.\-_]/g, "").slice(0, 100) : "unknown";
  return `${sanitizedShop}:${ip}`;
}

function resolveRequest(args: unknown): Request | undefined {
  if (!args) return undefined;
  if (args instanceof Request) return args;
  if (typeof args === "object" && args !== null && "request" in args) {
    const request = (args as { request: unknown }).request;
    if (request instanceof Request) return request;
  }
  return undefined;
}

export function withRateLimit<T>(
  config: RateLimitConfig,
  handler?: RateLimitedHandler<T>
): RateLimitedHandler<T | Response> | ((handler: RateLimitedHandler<T>) => RateLimitedHandler<T | Response>) {
  const {
    maxRequests,
    windowMs,
    keyExtractor = ipKeyExtractor,
    skip,
    message = "Too many requests",
  } = config;
  const createWrappedHandler = (handler: RateLimitedHandler<T>): RateLimitedHandler<T | Response> => {
    return async (args) => {
      const request = resolveRequest(args);
      if (!request || typeof request.url !== "string") {
        const errorMsg = `[rate-limit] Invalid args: expected Remix args { request }, got: ${args ? Object.keys(args).join(", ") : "undefined"}`;
        logger.error(errorMsg, {
          argsType: typeof args,
          argsKeys: args ? Object.keys(args) : [],
          hasRequest: !!args?.request,
          requestType: args?.request ? typeof args.request : "undefined",
        });
        return json(
          {
            success: false,
            error: {
              code: "INTERNAL_ERROR",
              message: "Rate limit middleware configuration error",
            },
          },
          { status: 500 }
        );
      }
      if (skip?.(request)) {
        return handler(args);
      }
      let key: string;
      try {
        key = keyExtractor(request);
      } catch (error) {
        logger.error("[rate-limit] keyExtractor failed", {
          error: error instanceof Error ? error.message : String(error),
          requestUrl: request.url,
        });
        key = `fallback:${request.url || "unknown"}`;
      }
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
  };
  if (handler) {
    return createWrappedHandler(handler);
  }
  return (handler: RateLimitedHandler<T>) => createWrappedHandler(handler);
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
  keyExtractor: shopDomainIpKeyExtractor,
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
