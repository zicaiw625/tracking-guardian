/**
 * Rate Limiting Middleware
 *
 * Provides simple in-memory rate limiting for Remix routes.
 * For production use, consider a distributed solution like Redis.
 */

import { json } from "@remix-run/node";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { RATE_LIMIT_CONFIG } from "../utils/config";
import { logger } from "../utils/logger.server";

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
 * Rate limit entry
 */
interface RateLimitEntry {
  count: number;
  resetAt: number;
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
// In-Memory Store
// =============================================================================

/**
 * Simple in-memory rate limit store
 */
class RateLimitStore {
  private entries = new Map<string, RateLimitEntry>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Check and update rate limit for a key
   */
  check(key: string, maxRequests: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const entry = this.entries.get(key);

    // If no entry or expired, create new
    if (!entry || entry.resetAt <= now) {
      const resetAt = now + windowMs;
      this.entries.set(key, { count: 1, resetAt });
      return {
        allowed: true,
        remaining: maxRequests - 1,
        resetAt,
      };
    }

    // Increment count
    entry.count++;

    // Check if over limit
    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.resetAt,
        retryAfter,
      };
    }

    return {
      allowed: true,
      remaining: maxRequests - entry.count,
      resetAt: entry.resetAt,
    };
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) {
        this.entries.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Rate limit cleanup: removed ${cleaned} expired entries`);
    }
  }

  /**
   * Get current size
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Stop cleanup interval
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Global rate limit store
const rateLimitStore = new RateLimitStore();

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
 * Rate limit middleware
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
    const result = rateLimitStore.check(key, maxRequests, windowMs);

    // Set rate limit headers
    const headers = new Headers();
    headers.set("X-RateLimit-Limit", String(maxRequests));
    headers.set("X-RateLimit-Remaining", String(result.remaining));
    headers.set("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));

    if (!result.allowed) {
      headers.set("Retry-After", String(result.retryAfter));

      logger.warn("Rate limit exceeded", {
        key,
        maxRequests,
        windowMs,
        retryAfter: result.retryAfter,
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
 * Check rate limit without consuming a request
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): RateLimitResult {
  return rateLimitStore.check(key, maxRequests, windowMs);
}

/**
 * Get rate limit store size (for monitoring)
 */
export function getRateLimitStoreSize(): number {
  return rateLimitStore.size;
}

/**
 * Clear rate limit store (for testing)
 */
export function clearRateLimitStore(): void {
  rateLimitStore.clear();
}
