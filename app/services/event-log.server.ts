import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { generateSimpleId } from "../utils/helpers";
import type { PixelEventPayload } from "../routes/api.pixel-events/types";

export function sanitizePII(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  const sanitized = Array.isArray(payload) ? [...payload] : { ...payload as Record<string, unknown> };
  if (Array.isArray(sanitized)) {
    return sanitized.map(item => sanitizePII(item));
  }
  const obj = sanitized as Record<string, unknown>;
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
  const sensitiveKeys = new Set([
    "access_token",
    "accesstoken",
    "api_secret",
    "apisecret",
    "authorization",
  ]);
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === "url") {
      if (typeof obj[key] === "string") {
        try {
          const u = new URL(obj[key] as string);
          result[key] = `${u.origin}${u.pathname}`;
        } catch {
          result[key] = "[REDACTED]";
        }
      } else {
        result[key] = "[REDACTED]";
      }
      continue;
    }
    if (lowerKey === "body") {
      result[key] = "[REDACTED]";
      continue;
    }
    const piiKeywords = ["email", "phone", "address", "name", "customer", "user", "personal", "identify"];
    const containsPiiKeyword = piiKeywords.some(keyword => lowerKey.includes(keyword));
    const isAllowed = allowedFields.has(lowerKey);
    if (!isAllowed && containsPiiKeyword) {
      continue;
    }
    if (piiFields.has(lowerKey)) {
      continue;
    }
    if (sensitiveKeys.has(lowerKey)) {
      result[key] = "***REDACTED***";
      continue;
    }
    if (!isAllowed) {
      continue;
    }
    if (typeof obj[key] === "object" && obj[key] !== null) {
      result[key] = sanitizePII(obj[key]);
    } else {
      result[key] = obj[key];
    }
  }
  return result;
}

function sanitizeCredentials(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  const sanitized = Array.isArray(payload) ? [...payload] : { ...payload as Record<string, unknown> };
  if (Array.isArray(sanitized)) {
    return sanitized.map(item => sanitizeCredentials(item));
  }
  const obj = sanitized as Record<string, unknown>;
  const sensitiveKeys = new Set([
    "access_token",
    "accesstoken",
    "api_secret",
    "apisecret",
    "test_event_code",
    "testeventcode",
    "api_key",
    "apikey",
  ]);
  for (const key of Object.keys(obj)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.has(lowerKey)) {
      obj[key] = "***REDACTED***";
    } else if (typeof obj[key] === "object" && obj[key] !== null) {
      obj[key] = sanitizeCredentials(obj[key]);
    }
  }
  return obj;
}

export interface CreateEventLogOptions {
  shopId: string;
  eventId: string;
  eventName: string;
  occurredAt: Date;
  normalizedEventJson: PixelEventPayload | Record<string, unknown>;
  shopifyContextJson?: Record<string, unknown> | null;
  source?: string;
}

export async function createEventLog(options: CreateEventLogOptions): Promise<string | null> {
  try {
    const sanitizedEventJson = sanitizePII(options.normalizedEventJson) as Record<string, unknown>;
    const sanitizedShopifyContextJson = options.shopifyContextJson ? sanitizePII(options.shopifyContextJson) as Record<string, unknown> : null;
    const eventLogId = generateSimpleId("eventlog");
    await prisma.eventLog.upsert({
      where: {
        shopId_eventId: {
          shopId: options.shopId,
          eventId: options.eventId,
        },
      },
      create: {
        id: eventLogId,
        shopId: options.shopId,
        eventId: options.eventId,
        eventName: options.eventName,
        source: options.source || "web_pixel",
        occurredAt: options.occurredAt,
        normalizedEventJson: sanitizedEventJson,
        shopifyContextJson: sanitizedShopifyContextJson,
      },
      update: {
        normalizedEventJson: sanitizedEventJson,
        shopifyContextJson: sanitizedShopifyContextJson,
      },
    });
    return eventLogId;
  } catch (error) {
    logger.error("Failed to create event log", {
      shopId: options.shopId,
      eventId: options.eventId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export interface CreateDeliveryAttemptOptions {
  eventLogId: string;
  shopId: string;
  destinationType: string;
  environment: "test" | "live";
  requestPayloadJson: unknown;
}

export async function createDeliveryAttempt(
  options: CreateDeliveryAttemptOptions
): Promise<string | null> {
  try {
    const sanitizedRequestPayload = sanitizePII(options.requestPayloadJson) as Record<string, unknown>;
    const attemptId = generateSimpleId("delivery");
    const platform = options.destinationType.split(":")[0];
    await prisma.deliveryAttempt.create({
      data: {
        id: attemptId,
        eventLogId: options.eventLogId,
        shopId: options.shopId,
        receiptId: null,
        destinationType: options.destinationType,
        platform,
        environment: options.environment,
        requestPayloadJson: sanitizedRequestPayload,
        status: "pending",
        ok: false,
        errorCode: null,
        errorDetail: null,
        httpStatus: null,
        responseBodySnippet: null,
        latencyMs: null,
        verificationRunId: null,
      },
    });
    return attemptId;
  } catch (error) {
    logger.error("Failed to create delivery attempt", {
      shopId: options.shopId,
      eventLogId: options.eventLogId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export interface UpdateDeliveryAttemptOptions {
  attemptId: string;
  status: "ok" | "fail" | "skipped" | "pending";
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
        ok: options.status === "ok",
        errorCode: options.errorCode || null,
        errorDetail: options.errorDetail || null,
        responseStatus: options.responseStatus || null,
        responseBodySnippet: options.responseBodySnippet ? (options.responseBodySnippet.length > 500 ? options.responseBodySnippet.substring(0, 500) : options.responseBodySnippet) : null,
        latencyMs: options.latencyMs || null,
      },
    });
  } catch (error) {
    logger.error("Failed to update delivery attempt", {
      attemptId: options.attemptId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

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
  source: string;
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
    const eventLogs = await prisma.eventLog.findMany({
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
    return eventLogs.map(log => {
      return {
        id: log.id,
        eventId: log.eventId,
        eventName: log.eventName,
        source: log.source,
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
          responseStatus: attempt.httpStatus,
          latencyMs: attempt.latencyMs,
          createdAt: attempt.createdAt,
        })),
      };
    });
  } catch (error) {
    logger.error("Failed to get event logs", {
      shopId,
      options,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

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
    const rows = logs.flatMap(log => {
      if (log.deliveryAttempts.length === 0) {
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
    function sanitizeForCSV(value: string): string {
      if (typeof value !== "string") {
        value = String(value);
      }
      const trimmed = value.trim();
      if (trimmed.length > 0 && /^[=+\-@]/.test(trimmed)) {
        return `'${value}`;
      }
      return value;
    }

    function escapeCSV(value: string): string {
      const sanitized = sanitizeForCSV(value);
      if (sanitized.includes(",") || sanitized.includes('"') || sanitized.includes("\n")) {
        return `"${sanitized.replace(/"/g, '""')}"`;
      }
      return sanitized;
    }
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
    const skippedDedup = attempts.filter(a => a.status === "skipped" && a.errorCode === "deduplicated").length;
    const latencies = attempts.filter(a => a.latencyMs !== null).map(a => a.latencyMs!);
    const avgLatencyMs = latencies.length > 0 ? Math.round(latencies.reduce((sum, l) => sum + l, 0) / latencies.length) : null;
    const sortedLatencies = [...latencies].sort((a, b) => a - b);
    const p50LatencyMs = sortedLatencies.length > 0 ? sortedLatencies[Math.floor(sortedLatencies.length * 0.5)] : null;
    const p95LatencyMs = sortedLatencies.length > 0 ? sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] : null;
    return {
      total,
      ok,
      fail,
      skipped,
      skippedDedup,
      avgLatencyMs,
      p50LatencyMs,
      p95LatencyMs,
    };
  } catch (error) {
    logger.error("Failed to get delivery attempt stats", {
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
