import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import type { Prisma } from "@prisma/client";

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
  const platforms = url.searchParams.get("platforms")?.split(",") || [];
  const eventTypes = url.searchParams.get("eventTypes")?.split(",") || [];
  const runId = url.searchParams.get("runId") || null;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const sendMessage = (type: string, data: unknown) => {
        const message = JSON.stringify({ type, ...(typeof data === "object" ? data : { data }) });
        controller.enqueue(encoder.encode(`data: ${message}\n\n`));
      };

      sendMessage("connected", {
        shopId: shop.id,
        platforms,
        eventTypes,
        runId,
        timestamp: new Date().toISOString(),
      });

      if (runId) {
        try {
          const run = await prisma.verificationRun.findUnique({
            where: { id: runId },
            select: { status: true, startedAt: true, completedAt: true },
          });

          if (run) {
            sendMessage("verification_run_status", {
              runId,
              status: run.status,
              startedAt: run.startedAt?.toISOString(),
              completedAt: run.completedAt?.toISOString(),
            });
          }
        } catch (error) {
          logger.error("Failed to fetch verification run status", { runId, error });
        }
      }

      let lastEventId: string | null = null;
      const pollInterval = 2000;

      const pollEvents = async () => {
        try {

          const whereClause: Prisma.ConversionLogWhereInput = {
            shopId: shop.id,
            ...(platforms.length > 0 && { platform: { in: platforms } }),
            ...(eventTypes.length > 0 && { eventType: { in: eventTypes } }),
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

          const conversionLogs = await prisma.conversionLog.findMany({
            where: whereClause,
            orderBy: { createdAt: "desc" },
            take: 10,
            select: {
              id: true,
              orderId: true,
              orderValue: true,
              currency: true,
              platform: true,
              eventType: true,
              status: true,
              createdAt: true,
              eventId: true,
              errorMessage: true,
            },
          });

          const pixelReceipts = await prisma.pixelEventReceipt.findMany({
            where: {
              shopId: shop.id,
              ...(platforms.length > 0 && { eventType: { in: eventTypes } }),
              ...(lastEventId && {
                createdAt: {
                  gt: new Date(Date.now() - pollInterval * 2),
                },
              }),
            },
            orderBy: { createdAt: "desc" },
            take: 10,
            select: {
              id: true,
              orderId: true,
              eventType: true,
              createdAt: true,
              eventId: true,
              consentState: true,
              isTrusted: true,
              trustLevel: true,
            },
          });

          const events: Array<{
            id: string;
            eventType: string;
            orderId: string;
            platform: string;
            timestamp: Date;
            status: "success" | "failed" | "pending";
            params?: {
              value?: number;
              currency?: string;
              items?: number;
              hasEventId?: boolean;
            };
            trust?: {
              isTrusted: boolean;
              trustLevel: string;
              hasConsent: boolean;
            };
            errors?: string[];
          }> = [];

          for (const log of conversionLogs) {
            if (lastEventId && log.id === lastEventId) continue;

            let shopifyOrder: { value: number; currency: string; itemCount: number } | undefined;
            try {

              shopifyOrder = {
                value: Number(log.orderValue),
                currency: log.currency || "USD",
                itemCount: 0,
              };
            } catch (error) {
              logger.warn("Failed to fetch Shopify order data", { orderId: log.orderId, error });
            }

            const hasValue = log.orderValue !== null && log.orderValue !== undefined;
            const hasCurrency = !!log.currency;
            const hasEventId = !!log.eventId;
            const missingParams: string[] = [];
            if (!hasValue) missingParams.push("value");
            if (!hasCurrency) missingParams.push("currency");
            if (!hasEventId) missingParams.push("event_id");

            const completeness = missingParams.length === 0 ? 100 : Math.max(0, 100 - (missingParams.length * 33));

            const discrepancies: string[] = [];
            if (shopifyOrder && hasValue) {
              const eventValue = Number(log.orderValue);
              const orderValue = shopifyOrder.value;
              if (Math.abs(eventValue - orderValue) >= 0.01) {
                discrepancies.push(`金额不一致: 事件 ${eventValue} vs 订单 ${orderValue}`);
              }
              if (log.currency !== shopifyOrder.currency) {
                discrepancies.push(`币种不一致: 事件 ${log.currency} vs 订单 ${shopifyOrder.currency}`);
              }
            }

            events.push({
              id: log.id,
              eventType: log.eventType,
              orderId: log.orderId,
              platform: log.platform,
              timestamp: log.createdAt,
              status: log.status === "sent" ? "success" : log.status === "failed" ? "failed" : "pending",
              params: {
                value: Number(log.orderValue),
                currency: log.currency,
                hasEventId,
              },
              paramCompleteness: {
                hasValue,
                hasCurrency,
                hasEventId,
                missingParams,
                completeness,
              },
              shopifyOrder,
              discrepancies: discrepancies.length > 0 ? discrepancies : undefined,
              errors: log.errorMessage ? [log.errorMessage] : undefined,
            });

            if (!lastEventId || log.createdAt > new Date()) {
              lastEventId = log.id;
            }
          }

          for (const receipt of pixelReceipts) {
            events.push({
              id: `pixel-${receipt.id}`,
              eventType: receipt.eventType,
              orderId: receipt.orderId,
              platform: "pixel",
              timestamp: receipt.createdAt,
              status: receipt.isTrusted ? "success" : "pending",
              params: {
                hasEventId: !!receipt.eventId,
              },
              trust: {
                isTrusted: receipt.isTrusted,
                trustLevel: receipt.trustLevel,
                hasConsent: !!receipt.consentState,
              },
            });
          }

          for (const event of events) {
            sendMessage("event", event);
          }
        } catch (error) {
          logger.error("Error polling events for SSE", { shopId: shop.id, error });
          sendMessage("error", {
            message: error instanceof Error ? error.message : "Failed to fetch events",
          });
        }
      };

      const intervalId = setInterval(pollEvents, pollInterval);
      pollEvents();

      request.signal.addEventListener("abort", () => {
        clearInterval(intervalId);
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
};
