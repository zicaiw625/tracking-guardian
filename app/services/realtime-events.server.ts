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
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      eventType: true,
      platform: true,
      orderKey: true,
      createdAt: true,
      pixelTimestamp: true,
      payloadJson: true,
    },
  });
  return receipts.map((receipt) => {
    const payload = receipt.payloadJson as Record<string, unknown> | null;
    const data = payload?.data as Record<string, unknown> | undefined;
    const value = typeof data?.value === "number" ? data.value : undefined;
    const currency = typeof data?.currency === "string" ? data.currency : undefined;
    const hasValue = value !== undefined && value !== null;
    const hasCurrency = !!currency;
    const status = hasValue && hasCurrency ? "success" as const : "pending" as const;
    return {
      id: receipt.id,
      eventType: receipt.eventType,
      platform: receipt.platform || "unknown",
      orderId: receipt.orderKey || "",
      status,
      timestamp: receipt.pixelTimestamp,
      params: {
        value,
        currency,
      },
      errors: status === "pending" ? ["参数不完整"] : undefined,
    };
  });
}

export async function subscribeToEvents(
  shopId: string,
  callback: (event: RealtimeEvent) => void
): Promise<() => void> {
  let isActive = true;
  let lastEventId: string | null = null;
  let timeoutId: NodeJS.Timeout | null = null;
  let isPolling = false;
  const cleanup = () => {
    isActive = false;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
  const poll = async () => {
    if (!isActive) {
      return;
    }
    if (isPolling) {
      return;
    }
    isPolling = true;
    try {
      if (!isActive) {
        return;
      }
      const events = await getRecentEvents(shopId, 10);
      if (!isActive) {
        return;
      }
      let newEvents: RealtimeEvent[];
      if (!lastEventId) {
        newEvents = events;
      } else {
        const lastEventIndex = events.findIndex((e) => e.id === lastEventId);
        if (lastEventIndex === -1) {
          newEvents = events;
        } else {
          newEvents = events.slice(0, lastEventIndex);
        }
      }
      if (newEvents.length > 0 && isActive) {
        newEvents.reverse().forEach((event) => {
          if (isActive) {
            callback(event);
          }
        });
        const latestEvent = events[0];
        if (latestEvent && isActive) {
          lastEventId = latestEvent.id;
        }
      }
    } catch (error) {
      logger.error("Error polling events", { shopId, error });
    } finally {
      isPolling = false;
    }
    if (!isActive) {
      return;
    }
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (isActive) {
      timeoutId = setTimeout(poll, 2000);
    }
  };
  poll();
  return cleanup;
}
