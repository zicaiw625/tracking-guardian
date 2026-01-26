import { getRedisClient } from "./redis-client.server";

const SSE_ACQUIRE_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local current = redis.call('INCR', key)
if current == 1 then
  redis.call('EXPIRE', key, ttl)
end
if current > limit then
  local rolled = redis.call('DECR', key)
  if rolled <= 0 then
    redis.call('DEL', key)
  end
  return {0, rolled}
end
return {1, current}
`;

const SSE_RELEASE_SCRIPT = `
local key = KEYS[1]
local ttl = tonumber(ARGV[1])
local currentValue = redis.call('GET', key)
if not currentValue then
  return 0
end
local current = redis.call('DECR', key)
if current <= 0 then
  redis.call('DEL', key)
  return 0
end
redis.call('EXPIRE', key, ttl)
return current
`;

export async function acquireSseSlot(
  redisClient: Awaited<ReturnType<typeof getRedisClient>>,
  countKey: string,
  limit: number,
  ttlSeconds: number
): Promise<{ allowed: boolean; count: number }> {
  const info = redisClient.getConnectionInfo();
  if (info.mode === "redis") {
    const result = await redisClient.eval(SSE_ACQUIRE_SCRIPT, [countKey], [
      String(limit),
      String(ttlSeconds),
    ]);
    const arr = Array.isArray(result) ? result : [];
    const allowed = Number(arr[0]) === 1;
    const count = Number(arr[1]) || 0;
    return { allowed, count };
  }
  const currentCount = await redisClient.incr(countKey);
  if (currentCount === 1) {
    await redisClient.expire(countKey, ttlSeconds);
  }
  if (currentCount > limit) {
    const newCount = await redisClient.decr(countKey);
    if (newCount <= 0) {
      await redisClient.del(countKey);
    } else {
      await redisClient.expire(countKey, ttlSeconds);
    }
    return { allowed: false, count: Math.max(0, newCount) };
  }
  return { allowed: true, count: currentCount };
}

export async function releaseSseSlot(
  redisClient: Awaited<ReturnType<typeof getRedisClient>>,
  countKey: string,
  ttlSeconds: number
): Promise<number> {
  const info = redisClient.getConnectionInfo();
  if (info.mode === "redis") {
    const result = await redisClient.eval(SSE_RELEASE_SCRIPT, [countKey], [String(ttlSeconds)]);
    return Number(result) || 0;
  }
  const count = await redisClient.get(countKey);
  if (!count) return 0;
  const newCount = parseInt(count, 10) - 1;
  if (Number.isNaN(newCount) || newCount <= 0) {
    await redisClient.del(countKey);
    return 0;
  }
  await redisClient.set(countKey, String(newCount), { EX: ttlSeconds });
  return newCount;
}

