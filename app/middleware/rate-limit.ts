/**
 * Rate Limiting Middleware
 *
 * Provides rate limiting for Remix routes with Redis support
 * and automatic fallback to in-memory store.
 *
 * Uses the unified Redis client from utils/redis-client for
 * distributed rate limiting across multiple instances.
 */

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

// =============================================================================
// Types
// =============================================================================

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Key extractor function */
  keyExtractor?: (request: Request) => string;
  /** Skip rate limiting for this request */
  skip?: (request: Request) => boolean;
  /** Custom message */
  message?: string;
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

/**
 * Rate limited handler
 */
export type RateLimitedHandler<T> = (
  args: LoaderFunctionArgs | ActionFunctionArgs
) => Promise<T>;

// =============================================================================
// Redis-backed Rate Limit Store
// =============================================================================

const RATE_LIMIT_PREFIX = "tg:mw:rl:";

/**
 * Distributed rate limit store using Redis with in-memory fallback
 */
class DistributedRateLimitStore {
  private pendingInit: Promise<RedisClientWrapper> | null = null;

  /**
   * Get the Redis client (async initialization)
   */
  private async getClient(): Promise<RedisClientWrapper> {
    if (!this.pendingInit) {
      this.pendingInit = getRedisClient();
    }
    return this.pendingInit;
  }

  /**
   * Check and update rate limit for a key (async)
   */
  async checkAsync(
    key: string,
    maxRequests: number,
    windowMs: number
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const fullKey = `${RATE_LIMIT_PREFIX}${key}`;
    const windowSeconds = Math.ceil(windowMs / 1000);

    try {
      const client = await this.getClient();
      const count = await client.incr(fullKey);

      // Set expiry on first request
      if (count === 1) {
        await client.expire(fullKey, windowSeconds);
      }

      // Get TTL for reset time
      const ttl = await client.ttl(fullKey);
      const resetAt = now + (ttl > 0 ? ttl * 1000 : windowMs);

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
      // Log error but don't block requests
      logger.error("Rate limit check error (allowing request)", error);
      return {
        allowed: true,
        remaining: maxRequests,
        resetAt: now + windowMs,
      };
    }
  }

  /**
   * Check rate limit synchronously (uses sync client, may be optimistic)
   */
  check(key: string, maxRequests: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const fullKey = `${RATE_LIMIT_PREFIX}${key}`;
    const windowSeconds = Math.ceil(windowMs / 1000);

    try {
      const client = getRedisClientSync();

      // Fire and forget increment
      client.incr(fullKey).then((count) => {
        if (count === 1) {
          client.expire(fullKey, windowSeconds).catch(() => {});
        }
      }).catch(() => {});

      // Return optimistic result (async check may catch abuse later)
      return {
        allowed: true,
        remaining: maxRequests,
        resetAt: now + windowMs,
      };
    } catch {
      return {
        allowed: true,
        remaining: maxRequests,
        resetAt: now + windowMs,
      };
    }
  }

  /**
   * Get current store size (for monitoring)
   */
  async getSize(): Promise<number> {
    try {
      const client = await this.getClient();
      const keys = await client.keys(`${RATE_LIMIT_PREFIX}*`);
      return keys.length;
    } catch {
      return 0;
    }
  }

  /**
   * Clear all entries (for testing)
   */
  async clear(): Promise<void> {
    try {
      const client = await this.getClient();
      const keys = await client.keys(`${RATE_LIMIT_PREFIX}*`);
      for (const key of keys) {
        await client.del(key);
      }
    } catch (error) {
      logger.error("Failed to clear rate limit entries", error);
    }
  }

  /**
   * Get connection info
   */
  getConnectionInfo(): { mode: "redis" | "memory"; connected: boolean } {
    const info = getRedisConnectionInfo();
    return {
      mode: info.mode,
      connected: info.connected,
    };
  }
}

// Global distributed rate limit store
const rateLimitStore = new DistributedRateLimitStore();

// =============================================================================
// Key Extractors
// =============================================================================

/**
 * Extract key from IP address
 */
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

/**
 * Extract key from shop domain
 */
export function shopKeyExtractor(request: Request): string {
  const url = new URL(request.url);
  return url.searchParams.get("shop") ?? "unknown";
}

/**
 * Extract key from path + IP
 */
export function pathIpKeyExtractor(request: Request): string {
  const url = new URL(request.url);
  const ip = ipKeyExtractor(request);
  return `${url.pathname}:${ip}`;
}

/**
 * Extract key from path + shop
 */
export function pathShopKeyExtractor(request: Request): string {
  const url = new URL(request.url);
  const shop = shopKeyExtractor(request);
  return `${url.pathname}:${shop}`;
}

// =============================================================================
// Rate Limit Middleware
// =============================================================================

/**
 * Rate limit middleware (async version - recommended)
 *
 * Uses Redis for distributed rate limiting across multiple instances.
 * Falls back to in-memory store if Redis is unavailable.
 *
 * @example
 * ```typescript
 * export const loader = withRateLimit(
 *   { maxRequests: 100, windowMs: 60000 },
 *   async ({ request }) => {
 *     return json({ data: "..." });
 *   }
 * );
 * ```
 */
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

    // Check if should skip
    if (skip?.(request)) {
      return handler(args);
    }

    // Get rate limit key
    const key = keyExtractor(request);

    // Use async check for accurate rate limiting
    const result = await rateLimitStore.checkAsync(key, maxRequests, windowMs);

    // Set rate limit headers
    const headers = new Headers();
    headers.set("X-RateLimit-Limit", String(maxRequests));
    headers.set("X-RateLimit-Remaining", String(result.remaining));
    headers.set("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));

    // Add connection info header in development
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

    // Call handler and add headers to response
    const response = await handler(args);

    // If handler returned a Response, add headers
    if (response instanceof Response) {
      for (const [key, value] of headers) {
        response.headers.set(key, value);
      }
    }

    return response;
  };
}

// =============================================================================
// Preset Configurations
// =============================================================================

/**
 * Standard API rate limit (from config)
 */
export const standardRateLimit: RateLimitConfig = {
  maxRequests: RATE_LIMIT_CONFIG.PIXEL_EVENTS.maxRequests,
  windowMs: RATE_LIMIT_CONFIG.PIXEL_EVENTS.windowMs,
  keyExtractor: pathShopKeyExtractor,
};

/**
 * Strict rate limit for sensitive endpoints
 */
export const strictRateLimit: RateLimitConfig = {
  maxRequests: 10,
  windowMs: 60000,
  keyExtractor: ipKeyExtractor,
};

/**
 * Webhook rate limit
 */
export const webhookRateLimit: RateLimitConfig = {
  maxRequests: RATE_LIMIT_CONFIG.WEBHOOKS.maxRequests,
  windowMs: RATE_LIMIT_CONFIG.WEBHOOKS.windowMs,
  keyExtractor: shopKeyExtractor,
};

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check rate limit asynchronously (accurate, uses Redis)
 */
export async function checkRateLimitAsync(
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<RateLimitResult> {
  return rateLimitStore.checkAsync(key, maxRequests, windowMs);
}

/**
 * Check rate limit synchronously (optimistic, may not be accurate)
 * Use checkRateLimitAsync when accuracy is important.
 */
export function checkRateLimitSync(
  key: string,
  maxRequests: number,
  windowMs: number
): RateLimitResult {
  return rateLimitStore.check(key, maxRequests, windowMs);
}

/**
 * Get rate limit store size (for monitoring)
 */
export async function getRateLimitStoreSize(): Promise<number> {
  return rateLimitStore.getSize();
}

/**
 * Clear rate limit store (for testing)
 */
export async function clearRateLimitStore(): Promise<void> {
  await rateLimitStore.clear();
}

/**
 * Get rate limit backend info
 */
export function getRateLimitBackendInfo(): {
  mode: "redis" | "memory";
  connected: boolean;
} {
  return rateLimitStore.getConnectionInfo();
}
