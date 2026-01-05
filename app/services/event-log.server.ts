/**
 * P0: EventLog 服务 - 用于持久化最终发往平台的请求 payload 证据链
 * 
 * 这是 Verification 和 Monitoring 的核心数据源，支持导出验收报告。
 * 所有发往 GA4/Meta/TikTok 的请求 payload 都会被记录，用于：
 * 1. Verification UI 实时查看事件与 payload
 * 2. 导出验收报告（含证据）
 * 3. 监控缺参率（value/currency/items）
 */

import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { generateSimpleId } from "../utils/helpers";

/**
 * 脱敏敏感信息（access_token, api_secret 等）
 */
function sanitizePayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const sanitized = Array.isArray(payload) ? [...payload] : { ...payload as Record<string, unknown> };

  if (Array.isArray(sanitized)) {
    return sanitized.map(item => sanitizePayload(item));
  }

  const obj = sanitized as Record<string, unknown>;
  const sensitiveKeys = [
    "access_token",
    "api_secret",
    "apiSecret",
    "accessToken",
    "test_event_code",
    "testEventCode",
  ];

  for (const key of Object.keys(obj)) {
    if (sensitiveKeys.includes(key.toLowerCase())) {
      obj[key] = "***REDACTED***";
    } else if (typeof obj[key] === "object" && obj[key] !== null) {
      obj[key] = sanitizePayload(obj[key]);
    }
  }

  return obj;
}

export interface CreateEventLogOptions {
  shopId: string;
  eventId: string | null;
  eventName: string;
  destination: string;
  destinationId?: string | null;
  requestPayload: unknown;
  status: "pending" | "sent" | "failed";
  errorDetail?: string | null;
  responseStatus?: number | null;
  responseBody?: string | null;
}

/**
 * 创建 EventLog 记录
 */
export async function createEventLog(options: CreateEventLogOptions): Promise<void> {
  try {
    const sanitizedPayload = sanitizePayload(options.requestPayload);

    await prisma.eventLog.create({
      data: {
        id: generateSimpleId("evtlog"),
        shopId: options.shopId,
        eventId: options.eventId || null,
        eventName: options.eventName,
        destination: options.destination,
        destinationId: options.destinationId || null,
        requestPayload: sanitizedPayload as Record<string, unknown>,
        status: options.status,
        errorDetail: options.errorDetail || null,
        responseStatus: options.responseStatus || null,
        responseBody: options.responseBody ? options.responseBody.substring(0, 2000) : null, // 限制长度
        sentAt: options.status === "sent" ? new Date() : null,
      },
    });
  } catch (error) {
    // 记录失败不应阻塞事件发送流程
    logger.error("Failed to create EventLog", {
      shopId: options.shopId,
      eventId: options.eventId,
      eventName: options.eventName,
      destination: options.destination,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 更新 EventLog 状态（从 pending 到 sent/failed）
 */
export async function updateEventLogStatus(
  shopId: string,
  eventId: string | null,
  destination: string,
  status: "sent" | "failed",
  errorDetail?: string | null,
  responseStatus?: number | null,
  responseBody?: string | null
): Promise<void> {
  try {
    await prisma.eventLog.updateMany({
      where: {
        shopId,
        eventId: eventId || undefined,
        destination,
        status: "pending",
      },
      data: {
        status,
        errorDetail: errorDetail || null,
        responseStatus: responseStatus || null,
        responseBody: responseBody ? responseBody.substring(0, 2000) : null,
        sentAt: status === "sent" ? new Date() : null,
      },
    });
  } catch (error) {
    logger.error("Failed to update EventLog status", {
      shopId,
      eventId,
      destination,
      status,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 获取 EventLog 列表（用于 Verification UI）
 */
export async function getEventLogs(
  shopId: string,
  options: {
    eventId?: string | null;
    eventName?: string;
    destination?: string;
    status?: string;
    limit?: number;
    offset?: number;
    startDate?: Date;
    endDate?: Date;
  } = {}
): Promise<Array<{
  id: string;
  eventId: string | null;
  eventName: string;
  destination: string;
  destinationId: string | null;
  requestPayload: unknown;
  status: string;
  errorDetail: string | null;
  responseStatus: number | null;
  createdAt: Date;
  sentAt: Date | null;
}>> {
  try {
    const logs = await prisma.eventLog.findMany({
      where: {
        shopId,
        ...(options.eventId !== undefined && { eventId: options.eventId || null }),
        ...(options.eventName && { eventName: options.eventName }),
        ...(options.destination && { destination: options.destination }),
        ...(options.status && { status: options.status }),
        ...(options.startDate && { createdAt: { gte: options.startDate } }),
        ...(options.endDate && { createdAt: { lte: options.endDate } }),
      },
      orderBy: { createdAt: "desc" },
      take: options.limit || 100,
      skip: options.offset || 0,
      select: {
        id: true,
        eventId: true,
        eventName: true,
        destination: true,
        destinationId: true,
        requestPayload: true,
        status: true,
        errorDetail: true,
        responseStatus: true,
        createdAt: true,
        sentAt: true,
      },
    });

    return logs;
  } catch (error) {
    logger.error("Failed to get EventLogs", {
      shopId,
      options,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

