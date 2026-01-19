import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { extractPlatformFromPayload } from "../utils/common";
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
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let isClosed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const cleanup = () => {
        if (intervalId !== null) {
          clearInterval(intervalId);
          intervalId = null;
        }
        if (!isClosed) {
          isClosed = true;
          try {
            controller.close();
          } catch (error) {
          }
        }
      };
      const sendMessage = (type: string, data: unknown) => {
        if (isClosed) return;
        try {
          const message = JSON.stringify({ type, ...(typeof data === "object" ? data : { data }) });
          controller.enqueue(encoder.encode(`data: ${message}\n\n`));
        } catch (error) {
          logger.warn("Failed to send SSE message, closing stream", {
            error: error instanceof Error ? error.message : String(error),
            errorName: error instanceof Error ? error.name : "Unknown",
          });
          cleanup();
        }
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
          const whereClause: Prisma.PixelEventReceiptWhereInput = {
            shopId: shop.id,
            ...(eventTypes.length > 0 && { eventType: { in: eventTypes } }),
          };
          if (lastEventId) {
            const lastEvent = await prisma.pixelEventReceipt.findUnique({
              where: { id: lastEventId },
              select: { createdAt: true },
            });
            if (lastEvent) {
              whereClause.createdAt = { gt: lastEvent.createdAt };
            }
          }
          if (runId) {
            whereClause.verificationRunId = runId;
          }
          const pixelReceipts = await prisma.pixelEventReceipt.findMany({
            where: whereClause,
            orderBy: { createdAt: "desc" },
            take: 20,
            select: {
              id: true,
              eventType: true,
              orderKey: true,
              pixelTimestamp: true,
              createdAt: true,
              payloadJson: true,
              verificationRunId: true,
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
            shopifyOrder?: {
              value: number;
              currency: string;
              itemCount: number;
            };
            discrepancies?: string[];
            errors?: string[];
            trust?: {
              isTrusted: boolean;
              trustLevel: string | null;
              hasConsent: boolean;
            };
          }> = [];
          const newEvents: typeof events = [];
          for (const receipt of pixelReceipts) {
            if (lastEventId && receipt.id === lastEventId) continue;
            const orderId = receipt.orderKey || "";
            const payload = receipt.payloadJson as Record<string, unknown> | null;
            const platform = extractPlatformFromPayload(payload);
            if (platforms.length > 0 && platform && !platforms.includes(platform)) {
              continue;
            }
            let value: number | undefined;
            let currency: string | undefined;
            let items: number | undefined;
            const missingParams: string[] = [];
            if (platform === "google") {
              const events = payload?.events as Array<Record<string, unknown>> | undefined;
              if (events && events.length > 0) {
                const params = events[0].params as Record<string, unknown> | undefined;
                value = params?.value as number | undefined;
                currency = params?.currency as string | undefined;
                if (Array.isArray(params?.items)) {
                  items = (params.items as Array<unknown>).length;
                }
              }
            } else if (platform === "meta" || platform === "facebook") {
              const data = payload?.data as Array<Record<string, unknown>> | undefined;
              if (data && data.length > 0) {
                const customData = data[0].custom_data as Record<string, unknown> | undefined;
                value = customData?.value as number | undefined;
                currency = customData?.currency as string | undefined;
                if (Array.isArray(customData?.contents)) {
                  items = (customData.contents as Array<unknown>).length;
                }
              }
            } else if (platform === "tiktok") {
              const data = payload?.data as Array<Record<string, unknown>> | undefined;
              if (data && data.length > 0) {
                const properties = data[0].properties as Record<string, unknown> | undefined;
                value = properties?.value as number | undefined;
                currency = properties?.currency as string | undefined;
                if (Array.isArray(properties?.contents)) {
                  items = (properties.contents as Array<unknown>).length;
                }
              }
            }
            if (!value) missingParams.push("value");
            if (!currency) missingParams.push("currency");
            const status: "success" | "failed" | "pending" = platform && (value !== undefined && value > 0) && currency ? "success" : "pending";
            newEvents.push({
              id: receipt.id,
              eventType: receipt.eventType,
              orderId,
              platform: platform || "unknown",
              timestamp: receipt.pixelTimestamp || receipt.createdAt,
              status,
              params: {
                value,
                currency,
                items,
                hasEventId: !!receipt.id,
              },
              discrepancies: missingParams.length > 0 ? missingParams : undefined,
            });
          }
          if (newEvents.length > 0) {
            for (const event of newEvents) {
              sendMessage("event", event);
            }
            if (newEvents.length > 0) {
              lastEventId = newEvents[0].id;
            }
          }
        } catch (error) {
          logger.error("Error polling events for SSE", { shopId: shop.id, error });
          sendMessage("error", {
            message: error instanceof Error ? error.message : "Failed to fetch events",
          });
          if (isClosed) {
            cleanup();
          }
        }
      };
      intervalId = setInterval(pollEvents, pollInterval);
      pollEvents();
      request.signal.addEventListener("abort", () => {
        cleanup();
      });
    },
    cancel() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
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
};
