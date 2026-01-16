import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";

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
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const cleanup = () => {
          if (pollInterval !== null) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
          if (!isClosed) {
            isClosed = true;
            try {
              controller.close();
            } catch (error) {
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
            let minCreatedAt: Date = timeWindowStart;
            
            if (lastEventId) {
              const lastEvent = await prisma.pixelEventReceipt.findUnique({
                where: { id: lastEventId },
                select: { createdAt: true },
              });
              if (lastEvent) {
                minCreatedAt = lastEvent.createdAt > timeWindowStart ? lastEvent.createdAt : timeWindowStart;
              } else {
                lastEventId = null;
              }
            }
            
            const recentReceipts = await prisma.pixelEventReceipt.findMany({
              where: {
                shopId: shop.id,
                createdAt: {
                  gt: minCreatedAt,
                },
              },
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
                const hasValue = value > 0;
                const hasCurrency = !!currency;
                const status = hasValue && hasCurrency ? "success" : "pending";
                const event = {
                  id: receipt.id,
                  eventType: receipt.eventType,
                  orderId: receipt.orderKey || "",
                  platform: platform || "pixel",
                  timestamp: receipt.pixelTimestamp.toISOString(),
                  status,
                  params: {
                    value,
                    currency,
                    hasEventId: true,
                  },
                  details: {
                    payload,
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
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    logger.error("SSE connection failed", error);
    return new Response("Internal Server Error", { status: 500 });
  }
};
