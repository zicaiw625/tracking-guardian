
import { logger } from "../utils/logger.server";
import prisma from "../db.server";

export interface RealtimeEvent {
  id: string;
  eventType: string;
  platform: string;
  orderId: string;
  status: "success" | "failed" | "pending";
  timestamp: Date;
  params?: Record<string, unknown>;
  errors?: string[];
}

export async function getRecentEvents(
  shopId: string,
  limit: number = 50
): Promise<RealtimeEvent[]> {
  const logs = await prisma.conversionLog.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      eventType: true,
      platform: true,
      orderId: true,
      status: true,
      createdAt: true,
      orderValue: true,
      currency: true,
      errorMessage: true,
    },
  });

  return logs.map((log: {
    id: string;
    eventType: string;
    platform: string;
    orderId: string;
    status: string;
    createdAt: Date;
    orderValue: number | string | null;
    currency: string | null;
    errorMessage: string | null;
  }) => ({
    id: log.id,
    eventType: log.eventType,
    platform: log.platform,
    orderId: log.orderId,
    status: log.status === "sent" ? "success" : log.status === "failed" ? "failed" : "pending",
    timestamp: log.createdAt,
    params: {
      value: log.orderValue ? Number(log.orderValue) : undefined,
      currency: log.currency,
    },
    errors: log.errorMessage ? [log.errorMessage] : undefined,
  }));
}

export async function subscribeToEvents(
  shopId: string,
  callback: (event: RealtimeEvent) => void
): Promise<() => void> {

  let isActive = true;
  let lastEventId: string | null = null;
  let timeoutId: NodeJS.Timeout | null = null;

  const poll = async () => {
    if (!isActive) return;

    try {
      const events = await getRecentEvents(shopId, 10);
      const newEvents = lastEventId
        ? events.filter((e) => e.id !== lastEventId)
        : events.slice(0, 1);

      if (newEvents.length > 0) {
        newEvents.forEach((event) => callback(event));

        const latestEvent = newEvents[0];
        if (latestEvent) {
          lastEventId = latestEvent.id;
        }
      }
    } catch (error) {
      logger.error("Error polling events", { shopId, error });
    }

    if (!isActive) return;

    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(poll, 2000);
  };

  poll();

  return () => {
    isActive = false;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
}

