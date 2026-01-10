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
  logger.debug("createEventLog called but eventLog table no longer exists", {
    shopId: options.shopId,
    eventId: options.eventId,
    eventName: options.eventName,
  });
  return null;
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
  logger.debug("createDeliveryAttempt called but deliveryAttempt table no longer exists", {
    shopId: options.shopId,
    eventLogId: options.eventLogId,
    destinationType: options.destinationType,
    environment: options.environment,
  });
  return null;
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
  logger.debug("updateDeliveryAttempt called but deliveryAttempt table no longer exists", {
    attemptId: options.attemptId,
    status: options.status,
  });
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
    const receipts = await prisma.pixelEventReceipt.findMany({
      where: {
        shopId,
        ...(options.eventName && { eventType: options.eventName }),
        ...(options.startDate && { createdAt: { gte: options.startDate } }),
        ...(options.endDate && { createdAt: { lte: options.endDate } }),
      },
      orderBy: { createdAt: "desc" },
      take: options.limit || 100,
      skip: options.offset || 0,
      select: {
        id: true,
        eventType: true,
        pixelTimestamp: true,
        createdAt: true,
        payloadJson: true,
        platform: true,
      },
    });
    return receipts.map(receipt => ({
      id: receipt.id,
      eventId: receipt.id,
      eventName: receipt.eventType,
      source: "web_pixel",
      occurredAt: receipt.pixelTimestamp,
      normalizedEventJson: receipt.payloadJson,
      shopifyContextJson: null,
      createdAt: receipt.createdAt,
      deliveryAttempts: [],
    }));
  } catch (error) {
    logger.error("Failed to get PixelEventReceipts", {
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
  logger.debug("getDeliveryAttemptStats called but deliveryAttempt table no longer exists", {
    shopId,
    options,
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
