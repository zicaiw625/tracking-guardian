/**
 * Rate limiter for API endpoints
 * 
 * Current implementation: In-memory store (suitable for single instance)
 * 
 * IMPORTANT: For multi-instance production deployments, you should:
 * 1. Set REDIS_URL environment variable
 * 2. Use the Redis-based implementation (see below)
 * 
 * The in-memory implementation:
 * - Is fast and simple
 * - Does NOT share state across multiple server instances
 * - Will reset on server restart
 * - Has memory limits to prevent unbounded growth
 * 
 * For Redis upgrade, implement RateLimitStore interface with Redis commands:
 * - INCR for counter
 * - EXPIRE for TTL
 * - GET for checking current count
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

/**
 * Abstract interface for rate limit storage
 * Implement this interface for Redis-based storage
 */
export interface RateLimitStore {
  get(key: string): Promise<RateLimitEntry | undefined>;
  set(key: string, entry: RateLimitEntry): Promise<void>;
  delete(key: string): Promise<void>;
  size(): Promise<number>;
  cleanup(): Promise<void>;
}

// In-memory store implementation
class InMemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, RateLimitEntry>();
  private maxSize: number;
  
  constructor(maxSize = 10000) {
    this.maxSize = maxSize;
  }
  
  async get(key: string): Promise<RateLimitEntry | undefined> {
    return this.store.get(key);
  }
  
  async set(key: string, entry: RateLimitEntry): Promise<void> {
    // Prevent unbounded memory growth
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      // Remove oldest entries when at capacity
      const now = Date.now();
      let removed = 0;
      for (const [k, v] of this.store.entries()) {
        if (v.resetTime < now || removed < 100) {
          this.store.delete(k);
          removed++;
        }
        if (removed >= 100) break;
      }
    }
    this.store.set(key, entry);
  }
  
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  
  async size(): Promise<number> {
    return this.store.size;
  }
  
  async cleanup(): Promise<void> {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetTime < now) {
        this.store.delete(key);
      }
    }
  }
  
  // For testing and debugging
  getSync(key: string): RateLimitEntry | undefined {
    return this.store.get(key);
  }
  
  entries(): IterableIterator<[string, RateLimitEntry]> {
    return this.store.entries();
  }
}

// Create store instance
// In production with Redis, replace this with RedisRateLimitStore
const rateLimitStore = new InMemoryRateLimitStore(
  parseInt(process.env.RATE_LIMIT_MAX_KEYS || "10000", 10)
);

// Log warning for multi-instance deployments
if (process.env.NODE_ENV === "production" && !process.env.REDIS_URL) {
  console.warn(
    "⚠️ Rate limiter using in-memory store. " +
    "For multi-instance deployments, set REDIS_URL for shared rate limiting."
  );
}

// Default rate limit configurations
const DEFAULT_CONFIGS: Record<string, RateLimitConfig> = {
  api: {
    maxRequests: 100,
    windowMs: 60 * 1000, // 100 requests per minute
  },
  cron: {
    maxRequests: 5,
    windowMs: 60 * 60 * 1000, // 5 requests per hour
  },
  survey: {
    maxRequests: 10,
    windowMs: 60 * 1000, // 10 requests per minute per IP
  },
  webhook: {
    maxRequests: 1000,
    windowMs: 60 * 1000, // 1000 requests per minute (high for Shopify webhooks)
  },
};

// Cleanup old entries periodically
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
let lastCleanup = Date.now();

function cleanupOldEntries(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;

  lastCleanup = now;
  // Use async cleanup but don't wait for it
  rateLimitStore.cleanup().catch((err) => {
    console.error("Rate limit cleanup error:", err);
  });
}

/**
 * Sanitize a string for use in rate limit keys
 * Prevents key injection attacks
 */
function sanitizeKeyPart(value: string): string {
  // Remove any characters that could cause issues in keys
  return value.replace(/[^a-zA-Z0-9.\-_]/g, "").slice(0, 100);
}

/**
 * Extract client IP from request headers
 * Handles various proxy configurations
 */
function getClientIP(request: Request): string {
  // x-forwarded-for can contain multiple IPs, first one is the client
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIP = forwardedFor.split(",")[0]?.trim();
    if (firstIP) {
      return sanitizeKeyPart(firstIP);
    }
  }
  
  // Fallback to x-real-ip
  const realIP = request.headers.get("x-real-ip");
  if (realIP) {
    return sanitizeKeyPart(realIP.trim());
  }
  
  return "unknown";
}

/**
 * Generate a rate limit key from request
 * Format: endpoint:identifier (shop domain or IP)
 */
function getRateLimitKey(request: Request, endpoint: string): string {
  const sanitizedEndpoint = sanitizeKeyPart(endpoint);
  
  // For authenticated requests, use shop domain if available
  const shop = request.headers.get("x-shopify-shop-domain");
  if (shop) {
    const sanitizedShop = sanitizeKeyPart(shop);
    return `${sanitizedEndpoint}:shop:${sanitizedShop}`;
  }
  
  // Fall back to IP-based rate limiting
  const ip = getClientIP(request);
  return `${sanitizedEndpoint}:ip:${ip}`;
}

/**
 * Check if a request should be rate limited
 * @returns Object with isLimited flag and remaining requests info
 */
export function checkRateLimit(
  request: Request,
  endpoint: string,
  customConfig?: Partial<RateLimitConfig>
): {
  isLimited: boolean;
  remaining: number;
  resetTime: number;
  retryAfter: number;
} {
  // Trigger async cleanup (non-blocking)
  cleanupOldEntries();

  const config = {
    ...DEFAULT_CONFIGS[endpoint] || DEFAULT_CONFIGS.api,
    ...customConfig,
  };

  const key = getRateLimitKey(request, endpoint);
  const now = Date.now();

  // Use sync method for performance (in-memory implementation)
  let entry = rateLimitStore.getSync(key);

  // Create new entry if doesn't exist or expired
  if (!entry || entry.resetTime < now) {
    entry = {
      count: 0,
      resetTime: now + config.windowMs,
    };
  }

  // Increment counter
  entry.count++;
  
  // Use async set but don't wait (fire and forget for in-memory)
  rateLimitStore.set(key, entry).catch((err) => {
    console.error("Rate limit set error:", err);
  });

  const isLimited = entry.count > config.maxRequests;
  const remaining = Math.max(0, config.maxRequests - entry.count);
  const retryAfter = Math.ceil((entry.resetTime - now) / 1000);

  return {
    isLimited,
    remaining,
    resetTime: entry.resetTime,
    retryAfter,
  };
}

/**
 * Create a rate limit response with appropriate headers
 */
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

/**
 * Add rate limit headers to a response
 */
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

/**
 * Rate limit middleware for use in route handlers
 * @example
 * export const action = withRateLimit("api", async ({ request }) => {
 *   // handler code
 * });
 */
export function withRateLimit<T>(
  endpoint: string,
  handler: (args: { request: Request }) => Promise<T>,
  customConfig?: Partial<RateLimitConfig>
): (args: { request: Request }) => Promise<T | Response> {
  return async (args) => {
    const { isLimited, remaining, resetTime, retryAfter } = checkRateLimit(
      args.request,
      endpoint,
      customConfig
    );

    if (isLimited) {
      console.warn(
        `Rate limit exceeded for ${endpoint}: ${getRateLimitKey(args.request, endpoint)}`
      );
      return createRateLimitResponse(retryAfter);
    }

    const response = await handler(args);

    // If response is a Response object, add rate limit headers
    if (response instanceof Response) {
      return addRateLimitHeaders(response, { remaining, resetTime });
    }

    return response;
  };
}

/**
 * Reset rate limit for a specific key (useful for testing)
 */
export function resetRateLimit(request: Request, endpoint: string): void {
  const key = getRateLimitKey(request, endpoint);
  rateLimitStore.delete(key).catch((err) => {
    console.error("Rate limit reset error:", err);
  });
}

/**
 * Get current rate limit stats (for debugging/monitoring)
 * Note: For Redis implementation, this would need to be async
 */
export function getRateLimitStats(): {
  totalKeys: number;
  entries: Array<{ key: string; count: number; resetTime: number }>;
} {
  const entries = Array.from(rateLimitStore.entries()).map(([key, entry]) => ({
    key,
    count: entry.count,
    resetTime: entry.resetTime,
  }));

  return {
    totalKeys: entries.length,
    entries,
  };
}

/**
 * Get rate limit configuration for an endpoint
 */
export function getRateLimitConfig(endpoint: string): RateLimitConfig {
  return DEFAULT_CONFIGS[endpoint] || DEFAULT_CONFIGS.api;
}
