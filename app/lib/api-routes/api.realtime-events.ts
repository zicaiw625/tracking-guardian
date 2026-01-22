import type { LoaderFunctionArgs } from "@remix-run/node";
import type { Prisma } from "@prisma/client";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { SSE_SECURITY_HEADERS, addSecurityHeadersToHeaders } from "../../utils/security-headers";
import { getRedisClient } from "../../utils/redis-client";
import { randomBytes } from "crypto";

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
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let isClosed = false;
    const MAX_CONCURRENT_CONNECTIONS = 5;
    const connectionId = randomBytes(16).toString("hex");
    const sseKey = `sse:${shop.id}:${connectionId}`;
    const countKey = `sse:${shop.id}:count`;
    const redisClient = await getRedisClient();
    const currentCount = await redisClient.incr(countKey);
    if (currentCount === 1) {
      await redisClient.expire(countKey, 3600);
    }
    if (currentCount > MAX_CONCURRENT_CONNECTIONS) {
      const decremented = currentCount - 1;
      if (decremented <= 0) {
        await redisClient.del(countKey);
      } else {
        await redisClient.set(countKey, String(decremented), { EX: 3600 });
      }
      return new Response("Too Many Requests", {
        status: 429,
        headers: {
          "Retry-After": "60",
          "X-RateLimit-Limit": String(MAX_CONCURRENT_CONNECTIONS),
          "X-RateLimit-Remaining": "0",
        },
      });
    }
    await redisClient.set(sseKey, "1", { EX: 3600 });
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const cleanup = async () => {
          try {
            await redisClient.del(sseKey);
            const count = await redisClient.get(countKey);
            if (count) {
              const newCount = parseInt(count, 10) - 1;
              if (newCount <= 0) {
                await redisClient.del(countKey);
              } else {
                await redisClient.set(countKey, String(newCount), { EX: 3600 });
              }
            }
          } catch (error) {
            logger.warn("Failed to cleanup SSE connection count", { error });
          }
          if (pollInterval !== null) {
            clearInterval(pollInterval);
            pollInterval = null;
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
        let lastEventId: string | null = null;
        pollInterval = setInterval(async () => {
          try {
            const now = Date.now();
            const timeWindowStart = new Date(now - 60000);
            let whereClause: Prisma.PixelEventReceiptWhereInput;
            if (lastEventId) {
              const lastEvent = await prisma.pixelEventReceipt.findUnique({
                where: { id: lastEventId },
                select: { createdAt: true },
              });
              if (lastEvent) {
                whereClause = {
                  shopId: shop.id,
                  AND: [
                    { createdAt: { gt: timeWindowStart } },
                    {
                      OR: [
                        { createdAt: { gt: lastEvent.createdAt } },
                        { createdAt: { equals: lastEvent.createdAt }, id: { gt: lastEventId } },
                      ],
                    },
                  ],
                };
              } else {
                lastEventId = null;
                whereClause = { shopId: shop.id, createdAt: { gt: timeWindowStart } };
              }
            } else {
              whereClause = { shopId: shop.id, createdAt: { gt: timeWindowStart } };
            }
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
              lastEventId = recentReceipts[recentReceipts.length - 1].id;
            }
          } catch (error) {
            logger.error("Error polling events for SSE", error);
            sendMessage({
              type: "error",
              message: "Failed to fetch events",
            });
            if (isClosed) {
              cleanup();
            }
          }
        }, 2000);
        request.signal.addEventListener("abort", () => {
          cleanup();
        });
      },
      cancel() {
        if (pollInterval !== null) {
          clearInterval(pollInterval);
          pollInterval = null;
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
