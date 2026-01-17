import { getRedisClient, type RedisClientWrapper } from "./redis-client";
import { logger } from "./logger.server";

export interface CircuitBreakerState {
  count: number;
  resetTime: number;
  tripped: boolean;
}

export interface CircuitBreakerConfig {
  threshold: number;
  windowMs: number;
  cooldownMs?: number;
}

export interface CircuitBreakerResult {
  blocked: boolean;
  reason?: string;
  count?: number;
  retryAfter?: number;
}

const CIRCUIT_BREAKER_PREFIX = "tg:cb:";

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  threshold: 10000,
  windowMs: 60 * 1000,
  cooldownMs: 60 * 1000,
};

function getKey(identifier: string): string {
  return `${CIRCUIT_BREAKER_PREFIX}${identifier}`;
}

async function getState(
  client: RedisClientWrapper,
  key: string
): Promise<CircuitBreakerState | null> {
  try {
    const data = await client.hGetAll(key);
    if (!data || Object.keys(data).length === 0) {
      return null;
    }
    const ttl = await client.ttl(key);
    if (ttl <= 0) {
      return null;
    }
    return {
      count: parseInt(data.count || "0", 10),
      resetTime: Date.now() + ttl * 1000,
      tripped: data.tripped === "1",
    };
  } catch (error) {
    logger.error("Circuit breaker getState error", error);
    return null;
  }
}

async function incrementCounter(
  client: RedisClientWrapper,
  key: string,
  config: CircuitBreakerConfig
): Promise<CircuitBreakerState> {
  const now = Date.now();
  const windowSeconds = Math.ceil(config.windowMs / 1000);
  const cooldownSeconds = Math.ceil((config.cooldownMs || config.windowMs) / 1000);
  try {
    const count = await client.hIncrBy(key, "count", 1);
    if (count === 1) {
      await client.expire(key, windowSeconds);
    }
    const tripped = count > config.threshold;
    if (tripped) {
      await client.hSet(key, "tripped", "1");
      await client.expire(key, cooldownSeconds);
    }
    const ttl = await client.ttl(key);
    return {
      count,
      resetTime: now + (ttl > 0 ? ttl * 1000 : config.windowMs),
      tripped,
    };
  } catch (error) {
    logger.error("Circuit breaker increment error", error);
    return {
      count: 1,
      resetTime: now + config.windowMs,
      tripped: false,
    };
  }
}

async function tripBreaker(
  client: RedisClientWrapper,
  key: string,
  config: CircuitBreakerConfig
): Promise<void> {
  const cooldownSeconds = Math.ceil((config.cooldownMs || config.windowMs) / 1000);
  try {
    await client.hMSet(key, {
      count: String(config.threshold + 1),
      tripped: "1",
    });
    await client.expire(key, cooldownSeconds);
  } catch (error) {
    logger.error("Circuit breaker trip error", error);
  }
}

async function resetBreaker(
  client: RedisClientWrapper,
  key: string
): Promise<void> {
  try {
    await client.del(key);
  } catch (error) {
    logger.error("Circuit breaker reset error", error);
  }
}

export async function checkCircuitBreaker(
  identifier: string,
  config: Partial<CircuitBreakerConfig> = {}
): Promise<CircuitBreakerResult> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const key = getKey(identifier);
  try {
    const client = await getRedisClient();
    const state = await incrementCounter(client, key, finalConfig);
    if (state.tripped) {
      const retryAfter = Math.ceil((state.resetTime - Date.now()) / 1000);
      if (state.count === finalConfig.threshold + 1) {
        logger.error(
          `🚨 Circuit breaker TRIPPED for ${identifier}: ` +
            `${state.count} requests in ${finalConfig.windowMs}ms`
        );
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
  } catch (error) {
    logger.error("Circuit breaker check error", error);
    return { blocked: false };
  }
}

export async function tripCircuitBreaker(
  identifier: string,
  config: Partial<CircuitBreakerConfig> = {}
): Promise<void> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const key = getKey(identifier);
  try {
    const client = await getRedisClient();
    await tripBreaker(client, key, finalConfig);
    logger.warn(`Circuit breaker manually tripped for ${identifier}`);
  } catch (error) {
    logger.error("Failed to trip circuit breaker", error);
  }
}

export async function resetCircuitBreaker(identifier: string): Promise<void> {
  const key = getKey(identifier);
  try {
    const client = await getRedisClient();
    await resetBreaker(client, key);
    logger.info(`Circuit breaker reset for ${identifier}`);
  } catch (error) {
    logger.error("Failed to reset circuit breaker", error);
  }
}

export async function getCircuitBreakerState(
  identifier: string
): Promise<CircuitBreakerState | null> {
  const key = getKey(identifier);
  try {
    const client = await getRedisClient();
    return await getState(client, key);
  } catch (error) {
    logger.error("Failed to get circuit breaker state", error);
    return null;
  }
}

export async function isCircuitBreakerTripped(
  identifier: string
): Promise<boolean> {
  const state = await getCircuitBreakerState(identifier);
  return state?.tripped ?? false;
}

export async function getCircuitBreakerStats(): Promise<{
  activeBreakers: number;
  trippedBreakers: number;
}> {
  try {
    const client = await getRedisClient();
    let cursor = "0";
    let activeBreakers = 0;
    let trippedCount = 0;
    do {
      const result = await client.scan(cursor, `${CIRCUIT_BREAKER_PREFIX}*`, 200);
      cursor = result.cursor;
      activeBreakers += result.keys.length;
      for (const key of result.keys) {
        const data = await client.hGetAll(key);
        if (data.tripped === "1") {
          trippedCount++;
        }
      }
    } while (cursor !== "0");
    return {
      activeBreakers,
      trippedBreakers: trippedCount,
    };
  } catch {
    return {
      activeBreakers: 0,
      trippedBreakers: 0,
    };
  }
}
