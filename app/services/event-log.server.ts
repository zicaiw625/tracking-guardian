import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { generateSimpleId } from "../utils/helpers";
import type { PixelEventPayload } from "../routes/api.pixel-events/types";

function sanitizePII(payload: unknown): unknown {
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
    const sanitizedContext = options.shopifyContextJson
      ? sanitizePII(options.shopifyContextJson) as Record<string, unknown>
      : null;
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
    if (error instanceof Error && error.message.includes("unique") || error instanceof Error && error.message.includes("Unique")) {
      logger.debug("EventLog already exists (deduplication)", {
        shopId: options.shopId,
        eventId: options.eventId,
        eventName: options.eventName,
      });
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
    logger.error("Failed to create EventLog", {
      shopId: options.shopId,
      eventId: options.eventId,
      eventName: options.eventName,
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
    if (error instanceof Error && (error.message.includes("unique") || error.message.includes("Unique"))) {
      logger.debug("DeliveryAttempt already exists (deduplication)", {
        shopId: options.shopId,
        eventLogId: options.eventLogId,
        destinationType: options.destinationType,
        environment: options.environment,
      });
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
        await prisma.deliveryAttempt.update({
          where: { id: existing.id },
          data: { status: "skipped_dedup" },
        });
      }
      return existing?.id || null;
    }
    logger.error("Failed to create DeliveryAttempt", {
      shopId: options.shopId,
      eventLogId: options.eventLogId,
      destinationType: options.destinationType,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

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
    function escapeCSV(value: string): string {
      if (value.includes(",") || value.includes('"') || value.includes("\n")) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
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
