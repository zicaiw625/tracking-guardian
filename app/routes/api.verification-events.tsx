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

          const whereClause: Prisma.EventLogWhereInput = {
            shopId: shop.id,
            ...(eventTypes.length > 0 && { eventName: { in: eventTypes } }),
          };

          if (lastEventId) {
            const lastEvent = await prisma.eventLog.findUnique({
              where: { id: lastEventId },
              select: { createdAt: true },
            });
            if (lastEvent) {
              whereClause.createdAt = { gt: lastEvent.createdAt };
            }
          }

          const eventLogs = await prisma.eventLog.findMany({
            where: whereClause,
            orderBy: { createdAt: "desc" },
            take: 20,
            select: {
              id: true,
              eventId: true,
              eventName: true,
              source: true,
              occurredAt: true,
              createdAt: true,
              shopifyContextJson: true,
              normalizedEventJson: true,
              DeliveryAttempt: {
                where: platforms.length > 0 ? { destinationType: { in: platforms } } : undefined,
                select: {
                  id: true,
                  destinationType: true,
                  environment: true,
                  status: true,
                  errorCode: true,
                  errorDetail: true,
                  responseStatus: true,
                  responseBodySnippet: true,
                  latencyMs: true,
                  requestPayloadJson: true,
                  createdAt: true,
                },
                orderBy: { createdAt: "desc" },
              },
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

            eventLogId?: string;
            deliveryAttemptId?: string;
          }> = [];

          for (const eventLog of eventLogs) {
            if (lastEventId && eventLog.id === lastEventId) continue;

            const shopifyContext = eventLog.shopifyContextJson as Record<string, unknown> | null;
            const normalizedEvent = eventLog.normalizedEventJson as Record<string, unknown> | null;
            const orderId = (shopifyContext?.orderId || normalizedEvent?.orderId || "") as string;

            for (const attempt of eventLog.DeliveryAttempt) {

              const requestPayload = attempt.requestPayloadJson as Record<string, unknown> | null;
              let value: number | undefined;
              let currency: string | undefined;

              if (attempt.destinationType === "google") {
                const body = requestPayload?.body as Record<string, unknown> | undefined;
                const events = body?.events as Array<Record<string, unknown>> | undefined;
                if (events && events.length > 0) {
                  const params = events[0].params as Record<string, unknown> | undefined;
                  value = params?.value as number | undefined;
                  currency = params?.currency as string | undefined;
                }
              } else if (attempt.destinationType === "meta" || attempt.destinationType === "facebook") {
                const body = requestPayload?.body as Record<string, unknown> | undefined;
                const data = body?.data as Array<Record<string, unknown>> | undefined;
                if (data && data.length > 0) {
                  const customData = data[0].custom_data as Record<string, unknown> | undefined;
                  value = customData?.value as number | undefined;
                  currency = customData?.currency as string | undefined;
                }
              } else if (attempt.destinationType === "tiktok") {
                const body = requestPayload?.body as Record<string, unknown> | undefined;
                const data = body?.data as Array<Record<string, unknown>> | undefined;
                if (data && data.length > 0) {
                  const properties = data[0].properties as Record<string, unknown> | undefined;
                  value = properties?.value as number | undefined;
                  currency = properties?.currency as string | undefined;
                }
              }

              const hasEventId = !!eventLog.eventId;
              const missingParams: string[] = [];
              if (!value) missingParams.push("value");
              if (!currency) missingParams.push("currency");
              if (!hasEventId) missingParams.push("event_id");

              const status = attempt.status === "ok" ? "success" :
                           attempt.status === "fail" ? "failed" : "pending";

              events.push({
                id: `${eventLog.id}-${attempt.id}`,
                eventType: eventLog.eventName,
                orderId,
                platform: attempt.destinationType,
                timestamp: attempt.createdAt,
                status,
                params: {
                  value,
                  currency,
                  hasEventId,
                },
                errors: attempt.errorDetail ? [attempt.errorDetail] : undefined,

                eventLogId: eventLog.id,
                deliveryAttemptId: attempt.id,
              });

              if (!lastEventId || attempt.createdAt > new Date()) {
                lastEventId = eventLog.id;
              }
            }

            if (eventLog.DeliveryAttempt.length === 0) {
              events.push({
                id: eventLog.id,
                eventType: eventLog.eventName,
                orderId,
                platform: eventLog.source,
                timestamp: eventLog.createdAt,
                status: "pending",
                params: {
                  hasEventId: !!eventLog.eventId,
                },

                eventLogId: eventLog.id,
              });

              if (!lastEventId || eventLog.createdAt > new Date()) {
                lastEventId = eventLog.id;
              }
            }
          }

          for (const event of events) {
            sendMessage("event", event);
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
