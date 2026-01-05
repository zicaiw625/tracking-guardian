
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

  return logs.map((log) => {
    const orderValue = log.orderValue;
    const numericValue = orderValue != null 
      ? (typeof orderValue === "number" ? orderValue : Number(orderValue))
      : undefined;
    
    return {
      id: log.id,
      eventType: log.eventType,
      platform: log.platform,
      orderId: log.orderId,
      status: log.status === "sent" ? "success" : log.status === "failed" ? "failed" : "pending",
      timestamp: log.createdAt,
      params: {
        value: numericValue,
        currency: log.currency ?? undefined,
      },
      errors: log.errorMessage ? [log.errorMessage] : undefined,
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
    // 在开始轮询前检查状态
    if (!isActive) {
      return;
    }

    // 防止并发轮询
    if (isPolling) {
      return;
    }

    isPolling = true;

    try {
      // 再次检查状态，防止在设置 isPolling 期间被取消
      if (!isActive) {
        return;
      }

      const events = await getRecentEvents(shopId, 10);
      
      // 再次检查状态，防止在异步操作期间被取消
      if (!isActive) {
        return;
      }

      let newEvents: RealtimeEvent[];

      if (!lastEventId) {
        // 第一次调用，获取所有事件
        newEvents = events;
      } else {
        // 找到 lastEventId 在数组中的位置，获取所有比它新的事件
        const lastEventIndex = events.findIndex((e) => e.id === lastEventId);
        if (lastEventIndex === -1) {
          // 如果找不到 lastEventId，说明所有事件都是新的
          newEvents = events;
        } else {
          // 获取 lastEventId 之前的所有事件（更新的）
          newEvents = events.slice(0, lastEventIndex);
        }
      }

      if (newEvents.length > 0 && isActive) {
        // 按时间顺序处理事件（从旧到新）
        newEvents.reverse().forEach((event) => {
          // 在处理每个事件前再次检查状态
          if (isActive) {
            callback(event);
          }
        });

        // 更新 lastEventId 为最新的事件ID
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

    // 在设置新的 timeout 前再次检查状态
    if (!isActive) {
      return;
    }

    // 清理旧的 timeout（如果存在）
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    // 只有在仍然活跃时才设置新的 timeout
    if (isActive) {
      timeoutId = setTimeout(poll, 2000);
    }
  };

  // 启动第一次轮询
  poll();

  // 返回清理函数
  return cleanup;
}

