/**
 * Simple in-memory rate limiter for API endpoints
 * For production with multiple instances, use Redis-based rate limiting
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

// In-memory store for rate limit tracking
const rateLimitStore = new Map<string, RateLimitEntry>();

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
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}

/**
 * Generate a rate limit key from request
 */
function getRateLimitKey(request: Request, endpoint: string): string {
  // Use IP address if available, otherwise use a generic key
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  
  // For authenticated requests, use shop domain if available
  const shop = request.headers.get("x-shopify-shop-domain");
  
  return shop ? `${endpoint}:${shop}` : `${endpoint}:${ip}`;
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
  cleanupOldEntries();

  const config = {
    ...DEFAULT_CONFIGS[endpoint] || DEFAULT_CONFIGS.api,
    ...customConfig,
  };

  const key = getRateLimitKey(request, endpoint);
  const now = Date.now();

  let entry = rateLimitStore.get(key);

  // Create new entry if doesn't exist or expired
  if (!entry || entry.resetTime < now) {
    entry = {
      count: 0,
      resetTime: now + config.windowMs,
    };
  }

  // Increment counter
  entry.count++;
  rateLimitStore.set(key, entry);

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
  rateLimitStore.delete(key);
}

/**
 * Get current rate limit stats (for debugging/monitoring)
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
    totalKeys: rateLimitStore.size,
    entries,
  };
}
