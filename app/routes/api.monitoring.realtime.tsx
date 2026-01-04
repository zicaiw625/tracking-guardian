

import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getEventMonitoringStats } from "../services/monitoring.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
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
  const shopId = url.searchParams.get("shopId") || shop.id;

  const headers = new Headers({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let interval: ReturnType<typeof setInterval> | null = null;
  let isClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const cleanup = () => {
        if (interval !== null) {
          clearInterval(interval);
          interval = null;
        }
        if (!isClosed) {
          isClosed = true;
          try {
            controller.close();
          } catch (error) {
            // Stream may already be closed
          }
        }
      };

      try {
        const stats = await getEventMonitoringStats(shopId, 24);
        const data = JSON.stringify({
          timestamp: new Date().toISOString(),
          totalEvents: stats.totalEvents,
          successfulEvents: stats.successfulEvents,
          failedEvents: stats.failedEvents,
          successRate: stats.successRate,
          failureRate: stats.failureRate,
          byPlatform: stats.byPlatform,
        });

        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      } catch (error) {
        logger.error("Failed to send initial SSE data:", error);
        cleanup();
        return;
      }

      interval = setInterval(async () => {
        try {
          const stats = await getEventMonitoringStats(shopId, 24);
          const data = JSON.stringify({
            timestamp: new Date().toISOString(),
            totalEvents: stats.totalEvents,
            successfulEvents: stats.successfulEvents,
            failedEvents: stats.failedEvents,
            successRate: stats.successRate,
            failureRate: stats.failureRate,
            byPlatform: stats.byPlatform,
          });

          if (isClosed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          } catch (error) {
            logger.warn("Failed to send SSE update, closing stream", {
              error: error instanceof Error ? error.message : String(error),
              errorName: error instanceof Error ? error.name : "Unknown",
            });
            cleanup();
          }
        } catch (error) {
          logger.error("Failed to fetch monitoring stats:", error);
          // Don't close on single error, but cleanup if stream is broken
          if (isClosed) {
            cleanup();
          }
        }
      }, 5000);

      request.signal.addEventListener("abort", () => {
        cleanup();
      });
    },
    cancel() {
      // Ensure cleanup when stream is cancelled
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    },
  });

  return new Response(stream, { headers });
};

