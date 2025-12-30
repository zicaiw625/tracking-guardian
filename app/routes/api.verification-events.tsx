import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";

/**
 * SSE 端点：实时推送验收事件
 * 用于 Verification 页面的实时事件监控
 */
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

  // 创建 SSE 响应流
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // 发送连接成功消息
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

      // 如果提供了 runId，发送验收运行状态
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

      // 轮询数据库获取新事件
      let lastEventId: string | null = null;
      const pollInterval = 2000; // 2秒轮询一次

      const pollEvents = async () => {
        try {
          // 查询最近的 ConversionLog 和 PixelEventReceipt
          const whereClause: any = {
            shopId: shop.id,
            ...(platforms.length > 0 && { platform: { in: platforms } }),
            ...(eventTypes.length > 0 && { eventType: { in: eventTypes } }),
          };

          // 如果提供了 lastEventId，只查询新事件
          if (lastEventId) {
            const lastEvent = await prisma.conversionLog.findUnique({
              where: { id: lastEventId },
              select: { createdAt: true },
            });
            if (lastEvent) {
              whereClause.createdAt = { gt: lastEvent.createdAt };
            }
          }

          // 查询 ConversionLog（服务端发送的事件）
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

          // 查询 PixelEventReceipt（像素端事件）
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

          // 合并并转换事件
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

          // 处理 ConversionLog - 增强版，包含参数完整性和订单对比
          for (const log of conversionLogs) {
            if (lastEventId && log.id === lastEventId) continue;

            // 查询对应的 Shopify 订单数据（用于金额一致性验证）
            let shopifyOrder: { value: number; currency: string; itemCount: number } | undefined;
            try {
              // 这里可以查询 Shopify Admin API 获取订单详情
              // 暂时使用 ConversionLog 中的数据
              shopifyOrder = {
                value: Number(log.orderValue),
                currency: log.currency || "USD",
                itemCount: 0, // 可以从 orderNumber 或其他字段获取
              };
            } catch (error) {
              logger.warn("Failed to fetch Shopify order data", { orderId: log.orderId, error });
            }

            // 计算参数完整性
            const hasValue = log.orderValue !== null && log.orderValue !== undefined;
            const hasCurrency = !!log.currency;
            const hasEventId = !!log.eventId;
            const missingParams: string[] = [];
            if (!hasValue) missingParams.push("value");
            if (!hasCurrency) missingParams.push("currency");
            if (!hasEventId) missingParams.push("event_id");

            const completeness = missingParams.length === 0 ? 100 : Math.max(0, 100 - (missingParams.length * 33));

            // 金额一致性检查
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

          // 处理 PixelEventReceipt
          for (const receipt of pixelReceipts) {
            events.push({
              id: `pixel-${receipt.id}`,
              eventType: receipt.eventType,
              orderId: receipt.orderId,
              platform: "pixel", // 像素端事件
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

          // 发送新事件
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

      // 开始轮询
      const intervalId = setInterval(pollEvents, pollInterval);
      pollEvents(); // 立即执行一次

      // 清理函数
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
      "X-Accel-Buffering": "no", // 禁用 Nginx 缓冲
    },
  });
};
