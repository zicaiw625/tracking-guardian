/**
 * P0: EventLog 和 DeliveryAttempt 服务 - 事件证据链
 * 
 * 这是 Verification 和 Monitoring 的核心数据源，支持导出验收报告。
 * 
 * 数据模型：
 * - EventLog: 记录所有从 web_pixel 接收到的标准化事件
 * - DeliveryAttempt: 记录每次向目的地发送的完整请求 payload 和响应
 * 
 * 使用流程：
 * 1. 接收到事件时，创建 EventLog 记录
 * 2. 准备发送到目的地时，创建 DeliveryAttempt (status=pending)
 * 3. 发送完成后，更新 DeliveryAttempt (status=ok/fail)
 */

import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { generateSimpleId } from "../utils/helpers";
import type { PixelEventPayload } from "../routes/api.pixel-events/types";

/**
 * P0-T4: Payload 脱敏策略（严格白名单模式）
 * 
 * 注意：此函数仅用于日志记录时的防御性脱敏，不是业务逻辑。
 * v1.0 版本不包含任何 PII/hash 生成能力，所有平台服务都不发送 PII。
 * 
 * 根据 Shopify 2025-12-10 起执行的"受保护客户数据"策略：
 * - 允许（白名单）：event_name、value、currency、items（SKU/variant_id）、event_id、timestamp、non-PII context
 * - 禁止/清空：email、phone、name、address、IP、精准定位等
 * - 对哈希后的 PII 也要谨慎处理（即使 v1.0 不生成，也要防御性清理）
 * 
 * 实现方式：严格白名单模式
 * - 只有明确在白名单中的字段才保留
 * - 其他字段一律删除（包括未知字段）
 * - 对包含 PII 关键词的字段名进行防御性检查
 * - 确保即使第三方 payload 包含未知的 PII 字段，也不会被持久化存储
 */
function sanitizePII(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const sanitized = Array.isArray(payload) ? [...payload] : { ...payload as Record<string, unknown> };

  if (Array.isArray(sanitized)) {
    return sanitized.map(item => sanitizePII(item));
  }

  const obj = sanitized as Record<string, unknown>;
  
  // P0-7: PII 字段白名单（允许保留的字段）- 统一使用小写
  // 只保留事件追踪必需的非 PII 字段
  const allowedFields = new Set([
    "event_name",
    "eventname",
    "value",
    "currency",
    "items",
    "event_id",
    "eventid",
    "timestamp",
    "event_time",
    "eventtime",
    "client_id",
    "clientid",
    "order_id",
    "orderid",
    "item_id",
    "itemid",
    "item_name",
    "itemname",
    "quantity",
    "price",
    "content_id",
    "contentid",
    "content_name",
    "contentname",
    "contents",
    "content_type",
    "contenttype",
    "engagement_time_msec",
    "engagementtimemsec",
    "url",
    "method",
    "headers",
    "body",
    "data",
    "pixel_code",
    "pixelcode",
    "test_event_code",
    "testeventcode",
    "product_id",
    "productid",
    "variant_id",
    "variantid",
  ]);

  // P0-7: 明确禁止的 PII 字段（包括 hash 形态）- 统一使用小写
  // v1.0 版本不包含任何 PCD/PII 处理，因此显式删除所有 PII 字段（包括 hash 形态）
  const piiFields = new Set([
    "email",
    "phone",
    "phone_number",
    "phonenumber",
    "name",
    "first_name",
    "firstname",
    "last_name",
    "lastname",
    "full_name",
    "fullname",
    "address",
    "street",
    "city",
    "state",
    "zip",
    "postal_code",
    "postalcode",
    "country",
    "ip",
    "ip_address",
    "ipaddress",
    "user_agent",
    "useragent",
    "latitude",
    "longitude",
    "location",
    "customer_id",
    "customerid",
    "user_id",
    "userid",
    // Hash 形态的字段（也属于 PII 处理范畴）
    // 注意：v1.0 版本不生成这些字段，但保留在防御性清理列表中，以防止第三方 payload 包含此类数据
    // Meta CAPI 标准缩写
    "em",
    "ph",
    "fn",
    "ln",
    "zp",
    "ct",
    "st",
    "user_data",
    "userdata",
    "external_id",
    "externalid",
    // 常见 hash 字段名变体
    "email_hash",
    "emailhash",
    "phone_hash",
    "phonehash",
    "hashed_email",
    "hashedemail",
    "hashed_phone",
    "hashedphone",
    "hashed_phone_number",
    "hashedphonenumber",
    "pre_hashed_user_data",
    "prehasheduserdata",
    "customer_email_hash",
    "customeremailhash",
    "customer_phone_hash",
    "customerphonehash",
  ]);

  // P0-7: 敏感凭证字段 - 统一使用小写
  const sensitiveKeys = new Set([
    "access_token",
    "accesstoken",
    "api_secret",
    "apisecret",
    "authorization",
  ]);

  const result: Record<string, unknown> = {};

  // P0-7: 严格白名单模式 - 只保留明确允许的字段，其他一律删除
  // 统一使用 lowercase 比较，确保字段名无论大小写都能正确匹配
  // 这样可以确保即使第三方 payload 包含未知的 PII 字段，也不会被存储
  for (const key of Object.keys(obj)) {
    const lowerKey = key.toLowerCase();
    
    // 防御性检查：如果字段名包含 PII 关键词，即使不在黑名单中也要删除
    // 但需要排除白名单中的字段（如 order_id, item_id 等）
    const piiKeywords = ["email", "phone", "address", "name", "customer", "user", "personal", "identify"];
    const containsPiiKeyword = piiKeywords.some(keyword => lowerKey.includes(keyword));
    
    // 先检查是否在白名单中（白名单优先）
    const isAllowed = allowedFields.has(lowerKey);
    
    // 如果不在白名单中，检查是否包含 PII 关键词
    if (!isAllowed && containsPiiKeyword) {
      // 不在白名单且包含 PII 关键词的字段一律删除
      continue;
    }
    
    // 明确禁止的 PII 字段（即使不在关键词列表中也要删除）
    if (piiFields.has(lowerKey)) {
      continue;
    }
    
    // 脱敏敏感凭证
    if (sensitiveKeys.has(lowerKey)) {
      result[key] = "***REDACTED***";
      continue;
    }
    
    // 严格白名单：只有明确在白名单中的字段才保留
    if (!isAllowed) {
      // 不在白名单中的字段一律删除（白名单模式）
      continue;
    }
    
    // 对于允许的字段，递归处理嵌套对象
    if (typeof obj[key] === "object" && obj[key] !== null) {
      result[key] = sanitizePII(obj[key]);
    } else {
      result[key] = obj[key];
    }
  }

  return result;
}

/**
 * 脱敏敏感凭证（access_token, api_secret 等）
 */
function sanitizeCredentials(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const sanitized = Array.isArray(payload) ? [...payload] : { ...payload as Record<string, unknown> };

  if (Array.isArray(sanitized)) {
    return sanitized.map(item => sanitizeCredentials(item));
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
      obj[key] = sanitizeCredentials(obj[key]);
    }
  }

  return obj;
}

/**
 * 创建 EventLog 记录（事件证据链核心）
 */
export interface CreateEventLogOptions {
  shopId: string;
  eventId: string; // 必填，canonical dedup key
  eventName: string;
  occurredAt: Date; // 事件发生时间
  normalizedEventJson: PixelEventPayload | Record<string, unknown>; // 标准化后的内部事件
  shopifyContextJson?: Record<string, unknown> | null; // Shopify 上下文（可选，脱敏后）
  source?: string; // 默认 "web_pixel"
}

export async function createEventLog(options: CreateEventLogOptions): Promise<string | null> {
  try {
    // 脱敏 shopifyContextJson 中的 PII
    const sanitizedContext = options.shopifyContextJson 
      ? sanitizePII(options.shopifyContextJson) as Record<string, unknown>
      : null;
    
    // 脱敏 normalizedEventJson 中的 PII
    const sanitizedEvent = sanitizePII(options.normalizedEventJson) as Record<string, unknown>;

    const eventLog = await prisma.eventLog.create({
      data: {
        id: generateSimpleId("evtlog"),
        shopId: options.shopId,
        source: options.source || "web_pixel",
        eventName: options.eventName,
        eventId: options.eventId,
        occurredAt: options.occurredAt,
        shopifyContextJson: sanitizedContext,
        normalizedEventJson: sanitizedEvent,
      },
    });

    return eventLog.id;
  } catch (error) {
    // 如果是唯一约束冲突（重复事件），返回 null 而不是抛出错误
    if (error instanceof Error && error.message.includes("unique") || error instanceof Error && error.message.includes("Unique")) {
      logger.debug("EventLog already exists (deduplication)", {
        shopId: options.shopId,
        eventId: options.eventId,
        eventName: options.eventName,
      });
      // 尝试查找已存在的记录
      const existing = await prisma.eventLog.findUnique({
        where: {
          shopId_eventId: {
            shopId: options.shopId,
            eventId: options.eventId,
          },
        },
      });
      return existing?.id || null;
    }

    // 记录失败不应阻塞事件发送流程
    logger.error("Failed to create EventLog", {
      shopId: options.shopId,
      eventId: options.eventId,
      eventName: options.eventName,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * 创建 DeliveryAttempt 记录（发送尝试）
 * 
 * 在发送前调用，创建 status=pending 的记录
 */
export interface CreateDeliveryAttemptOptions {
  eventLogId: string;
  shopId: string;
  destinationType: string; // ga4/meta/tiktok
  environment: "test" | "live"; // test/live
  requestPayloadJson: unknown; // 最终请求 payload（脱敏后）
}

export async function createDeliveryAttempt(
  options: CreateDeliveryAttemptOptions
): Promise<string | null> {
  try {
    // 脱敏 PII 和凭证
    const sanitizedPayload = sanitizePII(sanitizeCredentials(options.requestPayloadJson));

    const attempt = await prisma.deliveryAttempt.create({
      data: {
        id: generateSimpleId("delivery"),
        eventLogId: options.eventLogId,
        shopId: options.shopId,
        destinationType: options.destinationType,
        environment: options.environment,
        requestPayloadJson: sanitizedPayload as Record<string, unknown>,
        status: "pending",
      },
    });

    return attempt.id;
  } catch (error) {
    // 如果是唯一约束冲突（重复发送），标记为 skipped_dedup
    if (error instanceof Error && (error.message.includes("unique") || error.message.includes("Unique"))) {
      logger.debug("DeliveryAttempt already exists (deduplication)", {
        shopId: options.shopId,
        eventLogId: options.eventLogId,
        destinationType: options.destinationType,
        environment: options.environment,
      });
      
      // 查找已存在的记录并更新为 skipped_dedup
      const existing = await prisma.deliveryAttempt.findUnique({
        where: {
          shopId_eventLogId_destinationType_environment: {
            shopId: options.shopId,
            eventLogId: options.eventLogId,
            destinationType: options.destinationType,
            environment: options.environment,
          },
        },
      });
      
      if (existing && existing.status === "pending") {
        // 如果之前是 pending，更新为 skipped_dedup
        await prisma.deliveryAttempt.update({
          where: { id: existing.id },
          data: { status: "skipped_dedup" },
        });
      }
      
      return existing?.id || null;
    }

    // 记录失败不应阻塞事件发送流程
    logger.error("Failed to create DeliveryAttempt", {
      shopId: options.shopId,
      eventLogId: options.eventLogId,
      destinationType: options.destinationType,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * 更新 DeliveryAttempt 状态（发送完成后调用）
 */
export interface UpdateDeliveryAttemptOptions {
  attemptId: string;
  status: "ok" | "fail" | "skipped";
  errorCode?: string | null;
  errorDetail?: string | null;
  responseStatus?: number | null;
  responseBodySnippet?: string | null;
  latencyMs?: number | null;
}

export async function updateDeliveryAttempt(
  options: UpdateDeliveryAttemptOptions
): Promise<void> {
  try {
    await prisma.deliveryAttempt.update({
      where: { id: options.attemptId },
      data: {
        status: options.status,
        errorCode: options.errorCode || null,
        errorDetail: options.errorDetail || null,
        responseStatus: options.responseStatus || null,
        responseBodySnippet: options.responseBodySnippet 
          ? options.responseBodySnippet.substring(0, 2000) 
          : null,
        latencyMs: options.latencyMs || null,
      },
    });
  } catch (error) {
    logger.error("Failed to update DeliveryAttempt", {
      attemptId: options.attemptId,
      status: options.status,
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
    eventId?: string;
    eventName?: string;
    limit?: number;
    offset?: number;
    startDate?: Date;
    endDate?: Date;
  } = {}
): Promise<Array<{
  id: string;
  eventId: string;
  eventName: string;
  occurredAt: Date;
  normalizedEventJson: unknown;
  shopifyContextJson: unknown;
  createdAt: Date;
  deliveryAttempts: Array<{
    id: string;
    destinationType: string;
    environment: string;
    status: string;
    requestPayloadJson: unknown;
    errorCode: string | null;
    errorDetail: string | null;
    responseStatus: number | null;
    latencyMs: number | null;
    createdAt: Date;
  }>;
}>> {
  try {
    const logs = await prisma.eventLog.findMany({
      where: {
        shopId,
        ...(options.eventId && { eventId: options.eventId }),
        ...(options.eventName && { eventName: options.eventName }),
        ...(options.startDate && { createdAt: { gte: options.startDate } }),
        ...(options.endDate && { createdAt: { lte: options.endDate } }),
      },
      orderBy: { createdAt: "desc" },
      take: options.limit || 100,
      skip: options.offset || 0,
      include: {
        DeliveryAttempt: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    return logs.map(log => ({
      id: log.id,
      eventId: log.eventId,
      eventName: log.eventName,
      occurredAt: log.occurredAt,
      normalizedEventJson: log.normalizedEventJson,
      shopifyContextJson: log.shopifyContextJson,
      createdAt: log.createdAt,
      deliveryAttempts: log.DeliveryAttempt.map(attempt => ({
        id: attempt.id,
        destinationType: attempt.destinationType,
        environment: attempt.environment,
        status: attempt.status,
        requestPayloadJson: attempt.requestPayloadJson,
        errorCode: attempt.errorCode,
        errorDetail: attempt.errorDetail,
        responseStatus: attempt.responseStatus,
        latencyMs: attempt.latencyMs,
        createdAt: attempt.createdAt,
      })),
    }));
  } catch (error) {
    logger.error("Failed to get EventLogs", {
      shopId,
      options,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * P0-T5: 导出事件证据链数据为 CSV（脱敏后）
 * 
 * 只导出脱敏字段，不包含 PII
 */
export async function exportEventLogsAsCSV(
  shopId: string,
  options: {
    startDate?: Date;
    endDate?: Date;
    eventName?: string;
    limit?: number;
  } = {}
): Promise<string> {
  try {
    const logs = await getEventLogs(shopId, {
      startDate: options.startDate,
      endDate: options.endDate,
      eventName: options.eventName,
      limit: options.limit || 1000,
    });

    // CSV 头部
    const headers = [
      "Event ID",
      "Event Name",
      "Occurred At",
      "Destination",
      "Environment",
      "Status",
      "Error Code",
      "Latency (ms)",
      "Created At",
    ];

    // CSV 行
    const rows = logs.flatMap(log => {
      if (log.deliveryAttempts.length === 0) {
        // 如果没有 delivery attempts，只输出 event log 信息
        return [[
          log.eventId,
          log.eventName,
          log.occurredAt.toISOString(),
          "",
          "",
          "",
          "",
          "",
          log.createdAt.toISOString(),
        ]];
      }

      return log.deliveryAttempts.map(attempt => [
        log.eventId,
        log.eventName,
        log.occurredAt.toISOString(),
        attempt.destinationType,
        attempt.environment,
        attempt.status,
        attempt.errorCode || "",
        attempt.latencyMs?.toString() || "",
        attempt.createdAt.toISOString(),
      ]);
    });

    // 转义 CSV 字段
    function escapeCSV(value: string): string {
      if (value.includes(",") || value.includes('"') || value.includes("\n")) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    }

    // 构建 CSV
    const csvLines = [
      headers.map(escapeCSV).join(","),
      ...rows.map(row => row.map(cell => escapeCSV(String(cell || ""))).join(",")),
    ];

    return csvLines.join("\n");
  } catch (error) {
    logger.error("Failed to export EventLogs as CSV", {
      shopId,
      options,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 获取 DeliveryAttempt 统计（用于 Monitoring）
 */
export async function getDeliveryAttemptStats(
  shopId: string,
  options: {
    destinationType?: string;
    environment?: string;
    startDate?: Date;
    endDate?: Date;
  } = {}
): Promise<{
  total: number;
  ok: number;
  fail: number;
  skipped: number;
  skippedDedup: number;
  avgLatencyMs: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
}> {
  try {
    const attempts = await prisma.deliveryAttempt.findMany({
      where: {
        shopId,
        ...(options.destinationType && { destinationType: options.destinationType }),
        ...(options.environment && { environment: options.environment }),
        ...(options.startDate && { createdAt: { gte: options.startDate } }),
        ...(options.endDate && { createdAt: { lte: options.endDate } }),
      },
      select: {
        status: true,
        latencyMs: true,
      },
    });

    const total = attempts.length;
    const ok = attempts.filter(a => a.status === "ok").length;
    const fail = attempts.filter(a => a.status === "fail").length;
    const skipped = attempts.filter(a => a.status === "skipped").length;
    const skippedDedup = attempts.filter(a => a.status === "skipped_dedup").length;

    const latencies = attempts
      .filter(a => a.latencyMs !== null)
      .map(a => a.latencyMs!)
      .sort((a, b) => a - b);

    const avgLatencyMs = latencies.length > 0
      ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length
      : null;

    const p50LatencyMs = latencies.length > 0
      ? latencies[Math.floor(latencies.length * 0.5)]
      : null;

    const p95LatencyMs = latencies.length > 0
      ? latencies[Math.floor(latencies.length * 0.95)]
      : null;

    return {
      total,
      ok,
      fail,
      skipped,
      skippedDedup,
      avgLatencyMs: avgLatencyMs ? Math.round(avgLatencyMs) : null,
      p50LatencyMs,
      p95LatencyMs,
    };
  } catch (error) {
    logger.error("Failed to get DeliveryAttempt stats", {
      shopId,
      options,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      total: 0,
      ok: 0,
      fail: 0,
      skipped: 0,
      skippedDedup: 0,
      avgLatencyMs: null,
      p50LatencyMs: null,
      p95LatencyMs: null,
    };
  }
}
