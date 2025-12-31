

import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";

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

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        const sendMessage = (data: unknown) => {
          const message = `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(message));
        };

        sendMessage({ type: "connected", timestamp: new Date().toISOString() });

        let lastEventId: string | null = null;
        const pollInterval = setInterval(async () => {
          try {

            const whereClause: {
              shopId: string;
              createdAt?: { gt: Date };
            } = {
              shopId: shop.id,
            };

            if (lastEventId) {

              const lastEvent = await prisma.conversionLog.findUnique({
                where: { id: lastEventId },
                select: { createdAt: true },
              });
              if (lastEvent) {
                whereClause.createdAt = { gt: lastEvent.createdAt };
              }
            }

            const recentLogs = await prisma.conversionLog.findMany({
              where: {
                ...whereClause,
                ...(platforms.length > 0 && { platform: { in: platforms } }),
              },
              orderBy: { createdAt: "asc" }, // 改为 asc，从旧到新处理
              take: 10,
              select: {
                id: true,
                orderId: true,
                orderNumber: true,
                orderValue: true,
                currency: true,
                platform: true,
                eventType: true,
                status: true,
                errorMessage: true,
                createdAt: true,
              },
            });

            // 处理日志，更新 lastEventId 为最新的一条
            let latestLogId: string | null = null;
            for (const log of recentLogs) {
              const event = {
                id: log.id,
                eventType: log.eventType,
                orderId: log.orderId,
                orderNumber: log.orderNumber,
                platform: log.platform,
                timestamp: log.createdAt.toISOString(),
                status: log.status === "sent" ? "success" : log.status === "failed" ? "failed" : "pending",
                params: {
                  value: Number(log.orderValue),
                  currency: log.currency,
                },
                ...(log.errorMessage && { errors: [log.errorMessage] }),
              };

              sendMessage(event);
              latestLogId = log.id; // 记录最新的一条
            }
            
            // 更新 lastEventId 为最新的一条，下次查询时使用 createdAt > 这条的时间
            if (latestLogId) {
              lastEventId = latestLogId;
            }

            // 对于 pixelEventReceipt，使用时间窗口而不是 lastEventId
            // 因为它是独立的表，使用最近 60 秒的数据
            const recentReceipts = await prisma.pixelEventReceipt.findMany({
              where: {
                shopId: shop.id,
                createdAt: {
                  gt: new Date(Date.now() - 60000),
                },
              },
              orderBy: { createdAt: "asc" },
              take: 10,
              select: {
                id: true,
                orderId: true,
                eventType: true,
                createdAt: true,
                isTrusted: true,
                trustLevel: true,
              },
            });

            for (const receipt of recentReceipts) {
              const event = {
                id: `receipt_${receipt.id}`,
                eventType: receipt.eventType,
                orderId: receipt.orderId,
                platform: "pixel",
                timestamp: receipt.createdAt.toISOString(),
                status: receipt.isTrusted ? "success" : "pending",
                params: {
                  hasEventId: true,
                },
              };

              sendMessage(event);
            }
          } catch (error) {
            logger.error("Error polling events for SSE", error);
            sendMessage({
              type: "error",
              message: "Failed to fetch events",
            });
          }
        }, 2000);

        request.signal.addEventListener("abort", () => {
          clearInterval(pollInterval);
          controller.close();
        });
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

