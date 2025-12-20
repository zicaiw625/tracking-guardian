

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitStore {
  get(key: string): Promise<RateLimitEntry | undefined>;
  set(key: string, entry: RateLimitEntry): Promise<void>;
  increment(key: string, windowMs: number): Promise<RateLimitEntry>;
  delete(key: string): Promise<void>;
  size(): Promise<number>;
  cleanup(): Promise<void>;
  
  getSync?(key: string): RateLimitEntry | undefined;
}

class InMemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, RateLimitEntry>();
  private maxSize: number;
  
  constructor(maxSize = 10000) {
    this.maxSize = maxSize;
  }
  
  async get(key: string): Promise<RateLimitEntry | undefined> {
    return this.store.get(key);
  }
  
  getSync(key: string): RateLimitEntry | undefined {
    return this.store.get(key);
  }
  
  async set(key: string, entry: RateLimitEntry): Promise<void> {
    
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      const now = Date.now();

      for (const [k, v] of this.store.entries()) {
        if (v.resetTime < now) {
          this.store.delete(k);
        }
      }

      if (this.store.size >= this.maxSize) {
        const entries = Array.from(this.store.entries())
          .sort((a, b) => a[1].resetTime - b[1].resetTime);
        const toRemove = Math.min(100, entries.length);
        for (let i = 0; i < toRemove; i++) {
          this.store.delete(entries[i][0]);
        }
      }
    }
    this.store.set(key, entry);
  }
  
  async increment(key: string, windowMs: number): Promise<RateLimitEntry> {
    const now = Date.now();
    let entry = this.store.get(key);
    
    if (!entry || entry.resetTime < now) {
      entry = { count: 0, resetTime: now + windowMs };
    }
    
    entry.count++;
    await this.set(key, entry);
    return entry;
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
  
  entries(): IterableIterator<[string, RateLimitEntry]> {
    return this.store.entries();
  }
}

class RedisRateLimitStore implements RateLimitStore {
  private redisUrl: string;
  private redis: {
    incr: (key: string) => Promise<number>;
    expire: (key: string, seconds: number) => Promise<boolean>;
    get: (key: string) => Promise<string | null>;
    del: (key: string) => Promise<number>;
    ttl: (key: string) => Promise<number>;
    keys: (pattern: string) => Promise<string[]>;
  } | null = null;
  private prefix = "tg:rl:";
  
  private fallbackStore = new InMemoryRateLimitStore();
  private initPromise: Promise<void>;
  private initFailed = false;
  
  constructor(redisUrl: string) {
    this.redisUrl = redisUrl;
    this.initPromise = this.initRedis();
  }
  
  private async initRedis(): Promise<void> {
    try {
      
      const { createClient } = await import("redis");
      const client = createClient({ url: this.redisUrl });
      
      client.on("error", (err) => {
        console.error("Redis rate limiter error:", err);
        
        this.redis = null;
        this.initFailed = true;
      });
      
      client.on("reconnecting", () => {
        console.log("Redis rate limiter reconnecting...");
      });
      
      await client.connect();
      
      this.redis = {
        incr: (key) => client.incr(key),
        expire: (key, seconds) => client.expire(key, seconds),
        get: (key) => client.get(key),
        del: (key) => client.del(key).then((r) => r),
        ttl: (key) => client.ttl(key),
        keys: (pattern) => client.keys(pattern),
      };
      
      this.initFailed = false;
      console.log("✅ Redis rate limiter connected");
    } catch (error) {
      console.error("Failed to initialize Redis rate limiter:", error);
      console.warn("⚠️ Falling back to in-memory rate limiter");
      this.initFailed = true;
      
    }
  }
  
  private getRedisKey(key: string): string {
    return `${this.prefix}${key}`;
  }
  
  async get(key: string): Promise<RateLimitEntry | undefined> {
    
    await this.initPromise;
    if (!this.redis || this.initFailed) {
      return this.fallbackStore.get(key);
    }
    
    try {
      const redisKey = this.getRedisKey(key);
      const [countStr, ttl] = await Promise.all([
        this.redis.get(redisKey),
        this.redis.ttl(redisKey),
      ]);
      
      if (!countStr || ttl <= 0) return undefined;
      
      return {
        count: parseInt(countStr, 10) || 0,
        resetTime: Date.now() + ttl * 1000,
      };
    } catch (error) {
      console.error("Redis get error, falling back to in-memory:", error);
      return this.fallbackStore.get(key);
    }
  }
  
  async set(key: string, entry: RateLimitEntry): Promise<void> {
    
    await this.initPromise;
    if (!this.redis || this.initFailed) {
      return this.fallbackStore.set(key, entry);
    }
    
  }
  
  async increment(key: string, windowMs: number): Promise<RateLimitEntry> {
    
    await this.initPromise;
    if (!this.redis || this.initFailed) {
      return this.fallbackStore.increment(key, windowMs);
    }
    
    try {
      const redisKey = this.getRedisKey(key);
      const windowSeconds = Math.ceil(windowMs / 1000);

      const count = await this.redis.incr(redisKey);

      if (count === 1) {
        await this.redis.expire(redisKey, windowSeconds);
      }

      const ttl = await this.redis.ttl(redisKey);
      
      return {
        count,
        resetTime: Date.now() + (ttl > 0 ? ttl * 1000 : windowMs),
      };
    } catch (error) {
      console.error("Redis increment error, falling back to in-memory:", error);
      return this.fallbackStore.increment(key, windowMs);
    }
  }
  
  async delete(key: string): Promise<void> {
    await this.initPromise;
    if (!this.redis || this.initFailed) {
      return this.fallbackStore.delete(key);
    }
    
    try {
      await this.redis.del(this.getRedisKey(key));
    } catch (error) {
      console.error("Redis delete error:", error);
      return this.fallbackStore.delete(key);
    }
  }
  
  async size(): Promise<number> {
    await this.initPromise;
    if (!this.redis || this.initFailed) {
      return this.fallbackStore.size();
    }
    
    try {
      const keys = await this.redis.keys(`${this.prefix}*`);
      return keys.length;
    } catch (error) {
      console.error("Redis size error:", error);
      return this.fallbackStore.size();
    }
  }
  
  async cleanup(): Promise<void> {
    
  }
}

let rateLimitStore: RateLimitStore;

if (process.env.REDIS_URL) {
  rateLimitStore = new RedisRateLimitStore(process.env.REDIS_URL);
  console.log("📊 Rate limiter: Redis mode (multi-instance)");
} else {
  rateLimitStore = new InMemoryRateLimitStore(
    parseInt(process.env.RATE_LIMIT_MAX_KEYS || "10000", 10)
  );
  
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "⚠️ Rate limiter using in-memory store. " +
      "For multi-instance deployments, set REDIS_URL for shared rate limiting."
    );
  }
}

/**
 * P1-05: Rate limit configurations
 * 
 * These values balance protection against abuse while allowing legitimate traffic.
 * For high-volume shops, consider adjusting via environment variables.
 */
const DEFAULT_CONFIGS: Record<string, RateLimitConfig> = {
  api: {
    maxRequests: 100,
    windowMs: 60 * 1000, // 1 minute
  },
  cron: {
    maxRequests: 5,
    windowMs: 60 * 60 * 1000, // 1 hour
  },
  survey: {
    maxRequests: 10,
    windowMs: 60 * 1000, // 1 minute
  },
  webhook: {
    maxRequests: 1000,
    windowMs: 60 * 1000, // 1 minute
  },
  // P1-05: Separate configs for pixel events
  "pixel-events": {
    maxRequests: 200, // Higher limit for pixel (many page views per session)
    windowMs: 60 * 1000,
  },
  "pixel-events-unsigned": {
    maxRequests: 20, // Much stricter for unsigned requests
    windowMs: 60 * 1000,
  },
};

const CLEANUP_INTERVAL = 5 * 60 * 1000; 
let lastCleanup = Date.now();

function cleanupOldEntries(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;

  lastCleanup = now;
  
  rateLimitStore.cleanup().catch((err) => {
    console.error("Rate limit cleanup error:", err);
  });
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

/**
 * P1-05: Generate rate limit key
 * 
 * Key strategy:
 * - If shopDomain header present: use shop + IP combination (prevents single shop/IP abuse)
 * - Otherwise: use IP only
 * 
 * The combination approach ensures that:
 * 1. A single shop can't monopolize the rate limit
 * 2. A single IP can't attack multiple shops
 */
function getRateLimitKey(request: Request, endpoint: string): string {
  const sanitizedEndpoint = sanitizeKeyPart(endpoint);
  const ip = getClientIP(request);

  const shop = request.headers.get("x-shopify-shop-domain");
  if (shop) {
    const sanitizedShop = sanitizeKeyPart(shop);
    // P1-05: Use shop + IP combination for better protection
    return `${sanitizedEndpoint}:${sanitizedShop}:${ip}`;
  }

  return `${sanitizedEndpoint}:ip:${ip}`;
}

/**
 * P1-05: Standard security headers for all public API responses
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Cache control for API responses
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "Pragma": "no-cache",
  "Expires": "0",
};

/**
 * P1-05: Add security headers to a response
 */
export function addSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    // Don't override existing headers
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

  if (rateLimitStore.getSync) {
    let entry = rateLimitStore.getSync(key);

    if (!entry || entry.resetTime < now) {
      entry = {
        count: 0,
        resetTime: now + config.windowMs,
      };
    }

    entry.count++;

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

  rateLimitStore.increment(key, config.windowMs)
    .then((entry) => {
      if (entry.count > config.maxRequests) {
        console.warn(`Rate limit exceeded for ${endpoint}: ${key} (${entry.count}/${config.maxRequests})`);
      }
    })
    .catch((err) => {
      console.error("Rate limit increment error:", err);
    });

  return {
    isLimited: false,
    remaining: config.maxRequests,
    resetTime: now + config.windowMs,
    retryAfter: Math.ceil(config.windowMs / 1000),
  };
}

export async function checkRateLimitAsync(
  request: Request,
  endpoint: string,
  customConfig?: Partial<RateLimitConfig>
): Promise<{
  isLimited: boolean;
  remaining: number;
  resetTime: number;
  retryAfter: number;
}> {
  const config = {
    ...DEFAULT_CONFIGS[endpoint] || DEFAULT_CONFIGS.api,
    ...customConfig,
  };

  const key = getRateLimitKey(request, endpoint);
  const now = Date.now();

  try {
    const entry = await rateLimitStore.increment(key, config.windowMs);
    
    const isLimited = entry.count > config.maxRequests;
    const remaining = Math.max(0, config.maxRequests - entry.count);
    const retryAfter = Math.ceil((entry.resetTime - now) / 1000);

    return {
      isLimited,
      remaining,
      resetTime: entry.resetTime,
      retryAfter,
    };
  } catch (error) {
    console.error("Rate limit check error:", error);
    
    return {
      isLimited: false,
      remaining: config.maxRequests,
      resetTime: now + config.windowMs,
      retryAfter: Math.ceil(config.windowMs / 1000),
    };
  }
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

    if (response instanceof Response) {
      return addRateLimitHeaders(response, { remaining, resetTime });
    }

    return response;
  };
}

export function resetRateLimit(request: Request, endpoint: string): void {
  const key = getRateLimitKey(request, endpoint);
  rateLimitStore.delete(key).catch((err) => {
    console.error("Rate limit reset error:", err);
  });
}

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

export function getRateLimitConfig(endpoint: string): RateLimitConfig {
  return DEFAULT_CONFIGS[endpoint] || DEFAULT_CONFIGS.api;
}
