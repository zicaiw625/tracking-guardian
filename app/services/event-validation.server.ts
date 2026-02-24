import prisma from "../db.server";
import { extractPlatformFromPayload } from "../utils/common";

export interface EventValidationResult {
  eventId: string;
  orderId: string;
  platform: string;
  eventType: string;
  isValid: boolean;
  missingParams: string[];
  invalidParams: Array<{
    param: string;
    reason: string;
  }>;
}

export interface ValidationSummary {
  total: number;
  valid: number;
  invalid: number;
  validityRate: number;
  missingParamsCount: Record<string, number>;
}

export function validateEventParams(log: {
  orderValue: number | string | null;
  currency: string | null;
  eventId: string | null;
  platform: string;
  eventType: string;
}): EventValidationResult {
  const missingParams: string[] = [];
  const invalidParams: Array<{ param: string; reason: string }> = [];
  if (!log.orderValue || log.orderValue === null) {
    missingParams.push("value");
  } else if (typeof log.orderValue === "number" && log.orderValue <= 0) {
    invalidParams.push({ param: "value", reason: "Order value must be greater than 0" });
  }
  if (!log.currency || log.currency.trim() === "") {
    missingParams.push("currency");
  } else if (log.currency.length !== 3) {
    invalidParams.push({ param: "currency", reason: "Currency code must be a 3-letter ISO code" });
  }
  if (log.eventType === "purchase" && !log.eventId) {
    missingParams.push("event_id");
  }
  return {
    eventId: log.eventId || "",
    orderId: "",
    platform: log.platform,
    eventType: log.eventType,
    isValid: missingParams.length === 0 && invalidParams.length === 0,
    missingParams,
    invalidParams,
  };
}

export async function validateEvents(
  shopId: string,
  options: {
    since?: Date;
    platform?: string;
    eventType?: string;
    limit?: number;
  } = {}
): Promise<{
  results: EventValidationResult[];
  summary: ValidationSummary;
}> {
  const { since, platform, eventType, limit = 1000 } = options;
  const where: {
    shopId: string;
    createdAt?: { gte: Date };
    platform?: string;
    eventType?: string;
  } = {
    shopId,
  };
  if (since) {
    where.createdAt = { gte: since };
  }
  if (eventType) {
    where.eventType = eventType;
  }
  const receipts = await prisma.pixelEventReceipt.findMany({
    where,
    select: {
      id: true,
      orderKey: true,
      payloadJson: true,
      eventType: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const receiptsToProcess = platform
    ? receipts.filter((r) => extractPlatformFromPayload(r.payloadJson as Record<string, unknown> | null) === platform)
    : receipts;
  const results: EventValidationResult[] = receiptsToProcess.map((receipt) => {
    const payload = receipt.payloadJson as Record<string, unknown> | null;
    const platform = extractPlatformFromPayload(payload);
    if (!platform) {
      return {
        eventId: receipt.id,
        orderId: receipt.orderKey || "",
        platform: "unknown",
        eventType: receipt.eventType,
        isValid: false,
        missingParams: ["platform"],
        invalidParams: [],
      };
    }
    const data = payload?.data as Record<string, unknown> | undefined;
    let value: number | null = (data?.value as number) || null;
    let currency: string | null = (data?.currency as string) || null;
    if (platform === "google") {
      const events = payload?.events as Array<Record<string, unknown>> | undefined;
      if (events && events.length > 0) {
        const params = events[0].params as Record<string, unknown> | undefined;
        if (params?.value !== undefined) value = (params.value as number) || null;
        if (params?.currency) currency = String(params.currency);
      }
    } else if (platform === "meta" || platform === "facebook") {
      const eventsData = payload?.data as Array<Record<string, unknown>> | undefined;
      if (eventsData && eventsData.length > 0) {
        const customData = eventsData[0].custom_data as Record<string, unknown> | undefined;
        if (customData?.value !== undefined) value = (customData.value as number) || null;
        if (customData?.currency) currency = String(customData.currency);
      }
    } else if (platform === "tiktok") {
      const eventsData = payload?.data as Array<Record<string, unknown>> | undefined;
      if (eventsData && eventsData.length > 0) {
        const properties = eventsData[0].properties as Record<string, unknown> | undefined;
        if (properties?.value !== undefined) value = (properties.value as number) || null;
        if (properties?.currency) currency = String(properties.currency);
      }
    }
    const validation = validateEventParams({
      orderValue: value,
      currency: currency,
      eventId: receipt.id,
      platform,
      eventType: receipt.eventType,
    });
    return {
      ...validation,
      orderId: receipt.orderKey || "",
    };
  });
  const valid = results.filter((r) => r.isValid).length;
  const invalid = results.length - valid;
  const missingParamsCount: Record<string, number> = {};
  results.forEach((result) => {
    result.missingParams.forEach((param) => {
      missingParamsCount[param] = (missingParamsCount[param] || 0) + 1;
    });
  });
  const summary: ValidationSummary = {
    total: results.length,
    valid,
    invalid,
    validityRate: results.length > 0 ? (valid / results.length) * 100 : 0,
    missingParamsCount,
  };
  return { results, summary };
}
