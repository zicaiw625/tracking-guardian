interface CircuitBreakerState {
    count: number;
    resetTime: number;
    tripped: boolean;
}
interface CircuitBreakerConfig {
    threshold: number;
    windowMs: number;
    cooldownMs?: number;
}
interface CircuitBreakerStore {
    getState(key: string): Promise<CircuitBreakerState | null>;
    setState(key: string, state: CircuitBreakerState): Promise<void>;
    increment(key: string, config: CircuitBreakerConfig): Promise<CircuitBreakerState>;
    trip(key: string, config: CircuitBreakerConfig): Promise<void>;
    reset(key: string): Promise<void>;
    cleanup(): Promise<void>;
}
class InMemoryCircuitBreakerStore implements CircuitBreakerStore {
    private store = new Map<string, CircuitBreakerState>();
    private maxSize: number;
    constructor(maxSize = 5000) {
        this.maxSize = maxSize;
    }
    async getState(key: string): Promise<CircuitBreakerState | null> {
        const state = this.store.get(key);
        if (!state)
            return null;
        if (state.resetTime < Date.now()) {
            this.store.delete(key);
            return null;
        }
        return state;
    }
    async setState(key: string, state: CircuitBreakerState): Promise<void> {
        if (this.store.size >= this.maxSize && !this.store.has(key)) {
            this.cleanup();
        }
        this.store.set(key, state);
    }
    async increment(key: string, config: CircuitBreakerConfig): Promise<CircuitBreakerState> {
        const now = Date.now();
        let state = await this.getState(key);
        if (!state) {
            state = {
                count: 1,
                resetTime: now + config.windowMs,
                tripped: false,
            };
        }
        else if (state.tripped) {
            return state;
        }
        else {
            state.count++;
            if (state.count > config.threshold) {
                state.tripped = true;
                state.resetTime = now + (config.cooldownMs || config.windowMs);
            }
        }
        await this.setState(key, state);
        return state;
    }
    async trip(key: string, config: CircuitBreakerConfig): Promise<void> {
        const now = Date.now();
        const state: CircuitBreakerState = {
            count: config.threshold + 1,
            resetTime: now + (config.cooldownMs || config.windowMs),
            tripped: true,
        };
        await this.setState(key, state);
    }
    async reset(key: string): Promise<void> {
        this.store.delete(key);
    }
    async cleanup(): Promise<void> {
        const now = Date.now();
        for (const [key, state] of this.store.entries()) {
            if (state.resetTime < now) {
                this.store.delete(key);
            }
        }
        if (this.store.size >= this.maxSize * 0.8) {
            const entries = Array.from(this.store.entries())
                .sort((a, b) => a[1].resetTime - b[1].resetTime);
            const targetSize = Math.floor(this.maxSize * 0.7);
            const toRemove = Math.max(0, entries.length - targetSize);
            for (let i = 0; i < toRemove; i++) {
                this.store.delete(entries[i][0]);
            }
        }
    }
}
class RedisCircuitBreakerStore implements CircuitBreakerStore {
    private redisUrl: string;
    private redis: {
        hGetAll: (key: string) => Promise<Record<string, string>>;
        hSet: (key: string, field: string, value: string) => Promise<number>;
        hMSet: (key: string, fields: Record<string, string>) => Promise<"OK">;
        hIncrBy: (key: string, field: string, increment: number) => Promise<number>;
        expire: (key: string, seconds: number) => Promise<boolean>;
        del: (key: string) => Promise<number>;
        ttl: (key: string) => Promise<number>;
    } | null = null;
    private prefix = "tg:cb:";
    private initPromise: Promise<void>;
    private fallbackStore = new InMemoryCircuitBreakerStore();
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
                console.error("Redis circuit breaker error:", err);
                this.redis = null;
                this.initFailed = true;
            });
            client.on("reconnecting", () => {
                console.log("Redis circuit breaker reconnecting...");
            });
            await client.connect();
            this.redis = {
                hGetAll: (key) => client.hGetAll(key),
                hSet: (key, field, value) => client.hSet(key, field, value),
                hMSet: (key, fields) => client.hSet(key, fields).then(() => "OK" as const),
                hIncrBy: (key, field, increment) => client.hIncrBy(key, field, increment),
                expire: (key, seconds) => client.expire(key, seconds),
                del: (key) => client.del(key),
                ttl: (key) => client.ttl(key),
            };
            this.initFailed = false;
            console.log("✅ Redis circuit breaker connected");
        }
        catch (error) {
            console.error("Failed to initialize Redis circuit breaker:", error);
            console.warn("⚠️ Falling back to in-memory circuit breaker");
            this.initFailed = true;
        }
    }
    private getRedisKey(key: string): string {
        return `${this.prefix}${key}`;
    }
    async getState(key: string): Promise<CircuitBreakerState | null> {
        await this.initPromise;
        if (!this.redis || this.initFailed) {
            return this.fallbackStore.getState(key);
        }
        try {
            const redisKey = this.getRedisKey(key);
            const data = await this.redis.hGetAll(redisKey);
            if (!data || Object.keys(data).length === 0) {
                return null;
            }
            const ttl = await this.redis.ttl(redisKey);
            if (ttl <= 0) {
                return null;
            }
            return {
                count: parseInt(data.count || "0", 10),
                resetTime: Date.now() + ttl * 1000,
                tripped: data.tripped === "1",
            };
        }
        catch (error) {
            console.error("Redis getState error:", error);
            return this.fallbackStore.getState(key);
        }
    }
    async setState(key: string, state: CircuitBreakerState): Promise<void> {
        await this.initPromise;
        if (!this.redis || this.initFailed) {
            return this.fallbackStore.setState(key, state);
        }
        try {
            const redisKey = this.getRedisKey(key);
            const ttlSeconds = Math.max(1, Math.ceil((state.resetTime - Date.now()) / 1000));
            await this.redis.hMSet(redisKey, {
                count: String(state.count),
                tripped: state.tripped ? "1" : "0",
            });
            await this.redis.expire(redisKey, ttlSeconds);
        }
        catch (error) {
            console.error("Redis setState error:", error);
            await this.fallbackStore.setState(key, state);
        }
    }
    async increment(key: string, config: CircuitBreakerConfig): Promise<CircuitBreakerState> {
        await this.initPromise;
        if (!this.redis || this.initFailed) {
            return this.fallbackStore.increment(key, config);
        }
        try {
            const redisKey = this.getRedisKey(key);
            const windowSeconds = Math.ceil(config.windowMs / 1000);
            const count = await this.redis.hIncrBy(redisKey, "count", 1);
            if (count === 1) {
                await this.redis.expire(redisKey, windowSeconds);
            }
            const tripped = count > config.threshold;
            if (tripped) {
                const cooldownSeconds = Math.ceil((config.cooldownMs || config.windowMs) / 1000);
                await this.redis.hSet(redisKey, "tripped", "1");
                await this.redis.expire(redisKey, cooldownSeconds);
            }
            const ttl = await this.redis.ttl(redisKey);
            return {
                count,
                resetTime: Date.now() + (ttl > 0 ? ttl * 1000 : config.windowMs),
                tripped,
            };
        }
        catch (error) {
            console.error("Redis increment error:", error);
            return this.fallbackStore.increment(key, config);
        }
    }
    async trip(key: string, config: CircuitBreakerConfig): Promise<void> {
        await this.initPromise;
        if (!this.redis || this.initFailed) {
            return this.fallbackStore.trip(key, config);
        }
        try {
            const redisKey = this.getRedisKey(key);
            const cooldownSeconds = Math.ceil((config.cooldownMs || config.windowMs) / 1000);
            await this.redis.hMSet(redisKey, {
                count: String(config.threshold + 1),
                tripped: "1",
            });
            await this.redis.expire(redisKey, cooldownSeconds);
        }
        catch (error) {
            console.error("Redis trip error:", error);
            await this.fallbackStore.trip(key, config);
        }
    }
    async reset(key: string): Promise<void> {
        await this.initPromise;
        if (!this.redis || this.initFailed) {
            return this.fallbackStore.reset(key);
        }
        try {
            await this.redis.del(this.getRedisKey(key));
        }
        catch (error) {
            console.error("Redis reset error:", error);
            await this.fallbackStore.reset(key);
        }
    }
    async cleanup(): Promise<void> {
    }
}
let circuitBreakerStore: CircuitBreakerStore;
if (process.env.REDIS_URL) {
    circuitBreakerStore = new RedisCircuitBreakerStore(process.env.REDIS_URL);
    console.log("🔌 Circuit breaker: Redis mode (multi-instance)");
}
else {
    circuitBreakerStore = new InMemoryCircuitBreakerStore(parseInt(process.env.CIRCUIT_BREAKER_MAX_KEYS || "5000", 10));
    if (process.env.NODE_ENV === "production") {
        console.warn("⚠️ Circuit breaker using in-memory store. " +
            "For multi-instance deployments, set REDIS_URL for shared state.");
    }
}
const DEFAULT_CONFIG: CircuitBreakerConfig = {
    threshold: 10000,
    windowMs: 60 * 1000,
    cooldownMs: 60 * 1000,
};
export async function checkCircuitBreaker(identifier: string, config: Partial<CircuitBreakerConfig> = {}): Promise<{
    blocked: boolean;
    reason?: string;
    count?: number;
    retryAfter?: number;
}> {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    try {
        const state = await circuitBreakerStore.increment(identifier, finalConfig);
        if (state.tripped) {
            const retryAfter = Math.ceil((state.resetTime - Date.now()) / 1000);
            if (state.count === finalConfig.threshold + 1) {
                console.error(`🚨 Circuit breaker TRIPPED for ${identifier}: ${state.count} requests in ${finalConfig.windowMs}ms`);
            }
            return {
                blocked: true,
                reason: `Circuit breaker tripped. Retry after ${retryAfter}s`,
                count: state.count,
                retryAfter,
            };
        }
        return {
            blocked: false,
            count: state.count,
        };
    }
    catch (error) {
        console.error("Circuit breaker check error:", error);
        return { blocked: false };
    }
}
export async function tripCircuitBreaker(identifier: string, config: Partial<CircuitBreakerConfig> = {}): Promise<void> {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    await circuitBreakerStore.trip(identifier, finalConfig);
    console.warn(`Circuit breaker manually tripped for ${identifier}`);
}
export async function resetCircuitBreaker(identifier: string): Promise<void> {
    await circuitBreakerStore.reset(identifier);
}
export async function getCircuitBreakerState(identifier: string): Promise<CircuitBreakerState | null> {
    return circuitBreakerStore.getState(identifier);
}
export type { CircuitBreakerConfig, CircuitBreakerState };
