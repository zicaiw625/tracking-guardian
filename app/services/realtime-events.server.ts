
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

  return logs.map((log) => ({
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
  // 这里应该使用 WebSocket 或 SSE 实现实时推送
  // 目前先实现轮询方式
  let isActive = true;
  let lastEventId: string | null = null;

  const poll = async () => {
    if (!isActive) return;

    try {
      const events = await getRecentEvents(shopId, 10);
      const newEvents = lastEventId
        ? events.filter((e) => e.id !== lastEventId)
        : events.slice(0, 1);

      if (newEvents.length > 0) {
        newEvents.forEach((event) => callback(event));
        lastEventId = newEvents[0].id;
      }
    } catch (error) {
      logger.error("Error polling events", { shopId, error });
    }

    if (isActive) {
      setTimeout(poll, 2000); // 每2秒轮询一次
    }
  };

  poll();

  return () => {
    isActive = false;
  };
}

