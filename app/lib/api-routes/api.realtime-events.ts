import type { LoaderFunctionArgs } from "@remix-run/node";
import type { Prisma } from "@prisma/client";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { SSE_SECURITY_HEADERS, addSecurityHeadersToHeaders } from "../../utils/security-headers";
import { getRedisClient } from "../../utils/redis-client";
import { randomBytes } from "crypto";

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

async function acquireSseSlot(
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

async function releaseSseSlot(
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

function extractPlatformFromPayload(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  if (payload.platform && typeof payload.platform === "string") {
    return payload.platform;
  }
  if (payload.destination && typeof payload.destination === "string") {
    return payload.destination;
  }
  return null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });
    if (!shop) {
      return new Response("Shop not found", { status: 404 });
    }
    const url = new URL(request.url);
    const platformsParam = url.searchParams.get("platforms");
    const platforms = platformsParam ? platformsParam.split(",") : [];
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => Promise<void>) | null = null;
    let isClosed = false;
    const MAX_CONCURRENT_CONNECTIONS = 5;
    const TTL_SECONDS = 3600;
    const connectionId = randomBytes(16).toString("hex");
    const sseKey = `sse:${shop.id}:${connectionId}`;
    const countKey = `sse:${shop.id}:count`;
    const redisClient = await getRedisClient();
    const acquire = await acquireSseSlot(redisClient, countKey, MAX_CONCURRENT_CONNECTIONS, TTL_SECONDS);
    if (!acquire.allowed) {
      return new Response("Too Many Requests", {
        status: 429,
        headers: {
          "Retry-After": "60",
          "X-RateLimit-Limit": String(MAX_CONCURRENT_CONNECTIONS),
          "X-RateLimit-Remaining": "0",
        },
      });
    }
    await redisClient.set(sseKey, "1", { EX: TTL_SECONDS });
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const cleanup = async () => {
          try {
            await redisClient.del(sseKey);
            await releaseSseSlot(redisClient, countKey, TTL_SECONDS);
          } catch (error) {
            logger.warn("Failed to cleanup SSE connection count", { error });
          }
          if (pollTimer !== null) {
            clearTimeout(pollTimer);
            pollTimer = null;
          }
          if (unsubscribe) {
            try {
              await unsubscribe();
            } catch {
              void 0;
            }
            unsubscribe = null;
          }
          if (!isClosed) {
            isClosed = true;
            try {
              controller.close();
            } catch {
              void 0;
            }
          }
        };
        const sendMessage = (data: unknown) => {
          if (isClosed) return;
          try {
            const message = `data: ${JSON.stringify(data)}\n\n`;
            controller.enqueue(encoder.encode(message));
          } catch (error) {
            logger.warn("Failed to send SSE message, closing stream", {
              error: error instanceof Error ? error.message : String(error),
              errorName: error instanceof Error ? error.name : "Unknown",
            });
            cleanup();
          }
        };
        sendMessage({ type: "connected", timestamp: new Date().toISOString() });
        try {
          unsubscribe = await redisClient.subscribe(`sse:shop:${shop.id}`, (message) => {
            try {
              const parsed = JSON.parse(message) as { platform?: string | null };
              const platform = parsed?.platform ?? null;
              if (platforms.length > 0 && platform && !platforms.includes(platform)) {
                return;
              }
              sendMessage(parsed);
            } catch {
              void 0;
            }
          });
        } catch {
          unsubscribe = null;
        }

        let lastCreatedAt: Date | null = null;
        let lastId: string | null = null;
        let backoffMs = 2000;
        const pollOnce = async () => {
          try {
            const now = Date.now();
            const timeWindowStart = new Date(now - 60000);
            const cursorWhere = lastCreatedAt && lastId
              ? {
                  OR: [
                    { createdAt: { gt: lastCreatedAt } },
                    { createdAt: { equals: lastCreatedAt }, id: { gt: lastId } },
                  ],
                }
              : {};
            const whereClause: Prisma.PixelEventReceiptWhereInput = {
              shopId: shop.id,
              AND: [
                { createdAt: { gt: timeWindowStart } },
                cursorWhere,
              ],
            };
            const recentReceipts = await prisma.pixelEventReceipt.findMany({
              where: whereClause,
              orderBy: { createdAt: "asc" },
              take: 10,
              select: {
                id: true,
                orderKey: true,
                eventType: true,
                pixelTimestamp: true,
                createdAt: true,
                payloadJson: true,
              },
            });
            if (recentReceipts.length > 0) {
              for (const receipt of recentReceipts) {
                const payload = receipt.payloadJson as Record<string, unknown> | null;
                const platform = extractPlatformFromPayload(payload);
                if (platforms.length > 0 && platform && !platforms.includes(platform)) {
                  continue;
                }
                const data = payload?.data as Record<string, unknown> | undefined;
                const value = typeof data?.value === "number" ? data.value : 0;
                const currency = (data?.currency as string) || "USD";
                const items = data?.items as Array<unknown> | undefined;
                const itemsCount = Array.isArray(items) ? items.length : 0;
                const trustLevel = (payload?.trustLevel as string) || "untrusted";
                const hmacMatched = typeof payload?.hmacMatched === "boolean" ? payload.hmacMatched : false;
                const hasValue = value > 0;
                const hasCurrency = !!currency;
                const status = hasValue && hasCurrency ? "success" : "pending";
                const event = {
                  id: receipt.id,
                  eventType: receipt.eventType,
                  orderId: receipt.orderKey || "",
                  platform: platform || "pixel",
                  timestamp: (receipt.pixelTimestamp || receipt.createdAt).toISOString(),
                  status,
                  params: {
                    value,
                    currency,
                    itemsCount,
                    hasEventId: true,
                  },
                  trust: {
                    trustLevel,
                    hmacMatched,
                  },
                };
                sendMessage(event);
              }
              lastCreatedAt = recentReceipts[recentReceipts.length - 1].createdAt;
              lastId = recentReceipts[recentReceipts.length - 1].id;
              backoffMs = 2000;
            } else {
              backoffMs = Math.min(10000, Math.round(backoffMs * 1.5));
            }
          } catch (error) {
            logger.error("Error polling events for SSE", error);
            sendMessage({
              type: "error",
              message: "Failed to fetch events",
            });
            backoffMs = Math.min(15000, Math.round(backoffMs * 1.5));
          }
          if (!isClosed && !unsubscribe) {
            pollTimer = setTimeout(() => {
              pollOnce();
            }, backoffMs);
          }
        };

        if (!unsubscribe) {
          pollOnce();
        }
        request.signal.addEventListener("abort", () => {
          cleanup();
        });
      },
      cancel() {
        if (pollTimer !== null) {
          clearTimeout(pollTimer);
          pollTimer = null;
        }
        if (!isClosed) {
          isClosed = true;
        }
      },
    });
    const headers = new Headers({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    addSecurityHeadersToHeaders(headers, SSE_SECURITY_HEADERS);
    return new Response(stream, {
      headers,
    });
  } catch (error) {
    logger.error("SSE connection failed", error);
    return new Response("Internal Server Error", { status: 500 });
  }
};
