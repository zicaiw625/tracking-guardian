import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";
import type { PixelEventPayload } from "~/lib/pixel-events/types";
import { sendPixelEventToPlatform } from "./pixel-event-sender.server";
import { generateCanonicalEventId } from "../event-normalizer.server";
import { generateSimpleId, parallelLimit } from "~/utils/helpers";

function extractPlatformFromPayload(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  if (payload.platform && typeof payload.platform === "string") {
    return payload.platform;
  }
  if (payload.destination && typeof payload.destination === "string") {
    return payload.destination;
  }
  return null;
}

export interface EventPipelineResult {
  success: boolean;
  eventId?: string;
  destinations?: string[];
  errors?: string[];
  deduplicated?: boolean;
}

export interface EventValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateEventPayload(
  payload: PixelEventPayload
): EventValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!payload.eventName) {
    errors.push("eventName is required");
  }
  if (!payload.timestamp) {
    errors.push("timestamp is required");
  }
  if (!payload.shopDomain) {
    errors.push("shopDomain is required");
  }
  if (payload.data) {
    const data = payload.data;
    if (payload.eventName === "checkout_completed") {
      if (!data.value && data.value !== 0) {
        errors.push("value is required for purchase events");
      }
      if (!data.currency) {
        errors.push("currency is required for purchase events");
      }
      if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
        warnings.push("items array is empty or missing for purchase event");
      }
    } else {
      if (payload.eventName !== "page_viewed") {
        if (data.value === undefined || data.value === null) {
          warnings.push(`value is recommended for ${payload.eventName} events`);
        }
        if (!data.currency) {
          warnings.push(`currency is recommended for ${payload.eventName} events`);
        }
      }
    }
    if (data.items && Array.isArray(data.items)) {
      if (data.items.length === 0 && payload.eventName !== "page_viewed") {
        warnings.push(`items array is empty for ${payload.eventName} event`);
      }
      data.items.forEach((item: unknown, index: number) => {
        if (typeof item !== "object" || item === null) {
          errors.push(`items[${index}] must be an object`);
          return;
        }
        const itemObj = item as Record<string, unknown>;
        if (!itemObj.id && !itemObj.productId && !itemObj.variantId && !itemObj.product_id && !itemObj.variant_id) {
          warnings.push(`items[${index}] missing id, productId, or variantId`);
        }
      });
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export async function checkDeliveryDeduplication(
  shopId: string,
  eventLogId: string,
  destinationType: string,
  environment: "test" | "live"
): Promise<{ isDuplicate: boolean }> {
  try {
    const existing = await prisma.deliveryAttempt.findUnique({
      where: {
        shopId_eventLogId_destinationType_environment: {
          shopId,
          eventLogId,
          destinationType,
          environment,
        },
      },
      select: {
        id: true,
        status: true,
      },
    });
    if (existing && existing.status === "ok") {
      return { isDuplicate: true };
    }
    return { isDuplicate: false };
  } catch (error) {
    logger.error("Failed to check delivery deduplication", {
      shopId,
      eventLogId,
      destinationType,
      environment,
      error,
    });
    return { isDuplicate: false };
  }
}

function isObject(value: unknown): value is object {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function logEvent(
  shopId: string,
  eventName: string,
  eventId: string | null,
  payload: PixelEventPayload,
  destinationType: string | null,
  status: "ok" | "fail",
  errorCode?: string,
  errorDetail?: string,
  httpStatus?: number | null,
  responseBody?: string | null,
  latencyMs?: number | null,
  requestPayload?: unknown
): Promise<void> {
  if (!eventId || !destinationType) {
    return;
  }
  try {
    const { sanitizePII } = await import("../event-log.server");
    const canonicalPayload: PixelEventPayload = {
      eventName: payload.eventName,
      timestamp: payload.timestamp,
      shopDomain: payload.shopDomain,
      nonce: payload.nonce,
      consent: payload.consent,
      data: {
        orderId: payload.data?.orderId || undefined,
        orderNumber: payload.data?.orderNumber || undefined,
        value: payload.data?.value || 0,
        currency: payload.data?.currency || "USD",
        tax: payload.data?.tax,
        shipping: payload.data?.shipping,
        checkoutToken: payload.data?.checkoutToken || undefined,
        items: payload.data?.items || [],
        itemCount: payload.data?.itemCount,
        url: payload.data?.url || undefined,
        title: payload.data?.title || undefined,
        productId: payload.data?.productId || undefined,
        productTitle: payload.data?.productTitle || undefined,
        price: payload.data?.price,
        quantity: payload.data?.quantity,
        environment: payload.data?.environment || undefined,
      },
    };
    const sanitizedPayload = sanitizePII(canonicalPayload) as PixelEventPayload;
    let eventLog = await prisma.eventLog.findUnique({
      where: {
        shopId_eventId: {
          shopId,
          eventId,
        },
      },
    });
    if (!eventLog) {
      const eventLogId = generateSimpleId("eventlog");
      eventLog = await prisma.eventLog.create({
        data: {
          id: eventLogId,
          shopId,
          eventId,
          eventName,
          source: "web_pixel",
          occurredAt: new Date(payload.timestamp),
          normalizedEventJson: sanitizedPayload as unknown as Record<string, unknown>,
          shopifyContextJson: null,
        },
      });
    }
    const platform = destinationType.split(":")[0];
    const environment = (payload.data as { environment?: "test" | "live" })?.environment || "live";
    const sanitizedRequestPayload = requestPayload ? sanitizePII(requestPayload) : null;
    const safePayload = sanitizedRequestPayload && isObject(sanitizedRequestPayload) ? (sanitizedRequestPayload as unknown as Record<string, unknown>) : {};
    await prisma.deliveryAttempt.upsert({
      where: {
        shopId_eventLogId_destinationType_environment: {
          shopId,
          eventLogId: eventLog.id,
          destinationType,
          environment,
        },
      },
      create: {
        id: generateSimpleId("delivery"),
        eventLogId: eventLog.id,
        shopId,
        receiptId: eventId,
        destinationType,
        platform,
        environment,
        requestPayloadJson: safePayload,
        status: status === "ok" ? "ok" : "fail",
        ok: status === "ok",
        errorCode: errorCode || null,
        errorDetail: errorDetail || null,
        httpStatus: httpStatus || null,
        responseBodySnippet: responseBody ? (responseBody.length > 500 ? responseBody.substring(0, 500) : responseBody) : null,
        latencyMs: latencyMs || null,
        verificationRunId: null,
      },
      update: {
        status: status === "ok" ? "ok" : "fail",
        ok: status === "ok",
        errorCode: errorCode || null,
        errorDetail: errorDetail || null,
        httpStatus: httpStatus || null,
        responseBodySnippet: responseBody ? (responseBody.length > 500 ? responseBody.substring(0, 500) : responseBody) : null,
        latencyMs: latencyMs || null,
        requestPayloadJson: sanitizedRequestPayload && isObject(sanitizedRequestPayload) ? (sanitizedRequestPayload as unknown as Record<string, unknown>) : undefined,
      },
    });
  } catch (error) {
    logger.warn("Failed to log delivery attempt", {
      shopId,
      eventId,
      destinationType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function processEventPipeline(
  shopId: string,
  payload: PixelEventPayload,
  eventId: string | null,
  destinations: string[] | Array<{ platform: string; configId?: string; platformId?: string }>,
  environment?: "test" | "live"
): Promise<EventPipelineResult> {
  const validation = validateEventPayload(payload);
  if (!validation.valid) {
      await logEvent(
        shopId,
        payload.eventName,
        eventId,
        payload,
        null,
        "fail",
        "validation_failed",
        validation.errors.join("; "),
        null,
        null,
        null,
        null
      );
        const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { shopDomain: true },
    });
    if (shop) {
      const { metrics } = await import("../../utils/metrics-collector");
      metrics.pxValidateFailed(shop.shopDomain, "pipeline_validation_failed");
    }
    return {
      success: false,
      errors: validation.errors,
    };
  }
  const destinationConfigs: Array<{ platform: string; configId?: string; platformId?: string }> =
    destinations.length > 0 && typeof destinations[0] === 'string'
      ? (destinations as string[]).map(d => ({ platform: d }))
      : (destinations as Array<{ platform: string; configId?: string; platformId?: string }>);
  function normalizeValue(value: unknown): number {
    if (typeof value === "number") {
      return Math.max(0, Math.round(value * 100) / 100);
    }
    if (typeof value === "string") {
      const parsed = parseFloat(value);
      return isNaN(parsed) ? 0 : Math.max(0, Math.round(parsed * 100) / 100);
    }
    return 0;
  }
  function normalizeCurrency(currency: unknown, eventName: string): string {
    if (currency === null || currency === undefined) {
      const requiresCurrency = ["checkout_completed", "purchase", "product_added_to_cart", "checkout_started", "product_viewed"].includes(eventName);
      if (requiresCurrency) {
        logger.warn(`Missing currency for ${eventName} event, using USD as fallback. This may indicate a data quality issue. Pixel should always send currency from checkout/cart data.`, {
          eventName,
          shopId,
        });
      }
      return "USD";
    }
    if (typeof currency === "string") {
      const upper = currency.toUpperCase().trim();
      if (/^[A-Z]{3}$/.test(upper)) {
        return upper;
      }
    }
    logger.warn("Invalid currency format, defaulting to USD", {
      currency,
      currencyType: typeof currency,
      eventName,
      shopId,
    });
    return "USD";
  }
  let normalizedValue: number | undefined;
  if (payload.eventName === "page_viewed") {
    normalizedValue = 0;
  } else if (payload.data?.value !== undefined) {
    normalizedValue = normalizeValue(payload.data.value);
  } else if (payload.data?.items && Array.isArray(payload.data.items) && payload.data.items.length > 0) {
    normalizedValue = payload.data.items.reduce((sum: number, item: unknown) => {
      const itemObj = item as Record<string, unknown>;
      const price = normalizeValue(itemObj.price);
      const quantity = typeof itemObj.quantity === "number"
        ? Math.max(1, Math.floor(itemObj.quantity))
        : typeof itemObj.quantity === "string"
        ? Math.max(1, parseInt(itemObj.quantity, 10) || 1)
        : 1;
      return sum + (price * quantity);
    }, 0);
  } else {
    normalizedValue = 0;
  }
  const normalizedCurrency = normalizeCurrency(payload.data?.currency, payload.eventName);
  let normalizedItems: Array<{
    id: string;
    name: string;
    price: number;
    quantity: number;
  }> | undefined;
  if (payload.eventName === "page_viewed") {
    normalizedItems = [];
  } else if (payload.data?.items && Array.isArray(payload.data.items)) {
    normalizedItems = payload.data.items
      .filter(item => item != null && typeof item === "object")
      .map(item => {
        const itemObj = item as Record<string, unknown>;
        const id = String(
          itemObj.variantId ||
          itemObj.variant_id ||
          itemObj.productId ||
          itemObj.product_id ||
          itemObj.id ||
          ""
        ).trim();
        const name = String(
          itemObj.name ||
          itemObj.item_name ||
          itemObj.title ||
          itemObj.product_name ||
          itemObj.productTitle ||
          ""
        ).trim() || "Unknown";
        const price = itemObj.price !== undefined ? normalizeValue(itemObj.price) : 0;
        const quantity = typeof itemObj.quantity === "number"
          ? Math.max(1, Math.floor(itemObj.quantity))
          : typeof itemObj.quantity === "string"
          ? Math.max(1, parseInt(itemObj.quantity, 10) || 1)
          : 1;
        return {
          id,
          name,
          price,
          quantity,
        };
      })
      .filter(item => item.id);
  }
  const normalizedPayload: PixelEventPayload = {
    eventName: payload.eventName,
    timestamp: payload.timestamp,
    shopDomain: payload.shopDomain,
    nonce: payload.nonce,
    consent: payload.consent,
    data: {
      orderId: payload.data?.orderId || undefined,
      orderNumber: payload.data?.orderNumber || undefined,
      value: normalizedValue !== undefined ? normalizedValue : 0,
      currency: normalizedCurrency,
      tax: payload.data?.tax,
      shipping: payload.data?.shipping,
      checkoutToken: payload.data?.checkoutToken || undefined,
      items: normalizedItems || [],
      itemCount: payload.data?.itemCount,
      url: payload.data?.url || undefined,
      title: payload.data?.title || undefined,
      productId: payload.data?.productId || undefined,
      productTitle: payload.data?.productTitle || undefined,
      price: payload.data?.price,
      quantity: payload.data?.quantity,
      environment: payload.data?.environment || undefined,
    },
  };
  let finalEventId = eventId;
  if (!finalEventId) {
    const normalizedItemsForEventId = normalizedItems?.map(item => ({
      id: item.id,
      quantity: item.quantity,
    })) || [];
    finalEventId = generateCanonicalEventId(
      normalizedPayload.data?.orderId || null,
      normalizedPayload.data?.checkoutToken || null,
      normalizedPayload.eventName,
      normalizedPayload.shopDomain,
      normalizedItemsForEventId.length > 0 ? normalizedItemsForEventId : undefined,
      "v2",
      payload.nonce || null
    );
    logger.debug(`Generated canonical eventId for ${payload.eventName}`, {
      shopId,
      eventName: payload.eventName,
      eventId: finalEventId,
      hasItems: normalizedItemsForEventId.length > 0,
      orderId: normalizedPayload.data?.orderId || null,
      checkoutToken: normalizedPayload.data?.checkoutToken || null,
    });
  } else {
    logger.debug(`Using provided eventId for ${payload.eventName}`, {
      shopId,
      eventName: payload.eventName,
      eventId: finalEventId,
      orderId: normalizedPayload.data?.orderId || null,
      checkoutToken: normalizedPayload.data?.checkoutToken || null,
    });
  }
  const { sanitizePII } = await import("../event-log.server");
  const canonicalPayload: PixelEventPayload = {
    eventName: normalizedPayload.eventName,
    timestamp: normalizedPayload.timestamp,
    shopDomain: normalizedPayload.shopDomain,
    nonce: normalizedPayload.nonce,
    consent: normalizedPayload.consent,
    data: {
      orderId: normalizedPayload.data?.orderId || undefined,
      orderNumber: normalizedPayload.data?.orderNumber || undefined,
      value: normalizedPayload.data?.value || 0,
      currency: normalizedPayload.data?.currency || "USD",
      tax: normalizedPayload.data?.tax,
      shipping: normalizedPayload.data?.shipping,
      checkoutToken: normalizedPayload.data?.checkoutToken || undefined,
      items: normalizedPayload.data?.items || [],
      itemCount: normalizedPayload.data?.itemCount,
      url: normalizedPayload.data?.url || undefined,
      title: normalizedPayload.data?.title || undefined,
      productId: normalizedPayload.data?.productId || undefined,
      productTitle: normalizedPayload.data?.productTitle || undefined,
      price: normalizedPayload.data?.price,
      quantity: normalizedPayload.data?.quantity,
      environment: normalizedPayload.data?.environment || undefined,
    },
  };
  const sanitizedPayload = sanitizePII(canonicalPayload) as PixelEventPayload;
  let eventLog = await prisma.eventLog.findUnique({
    where: {
      shopId_eventId: {
        shopId,
        eventId: finalEventId,
      },
    },
  });
  if (!eventLog) {
    const eventLogId = generateSimpleId("eventlog");
    eventLog = await prisma.eventLog.create({
      data: {
        id: eventLogId,
        shopId,
        eventId: finalEventId,
        eventName: normalizedPayload.eventName,
        source: "web_pixel",
        occurredAt: new Date(normalizedPayload.timestamp),
        normalizedEventJson: sanitizedPayload as unknown as Record<string, unknown>,
        shopifyContextJson: null,
      },
    });
  }
  const destinationNames = destinationConfigs.map(d => d.platform);
  logger.info(`Routing ${normalizedPayload.eventName} event to ${destinationConfigs.length} destination(s)`, {
    shopId,
    eventId: finalEventId,
    eventName: normalizedPayload.eventName,
    destinations: destinationNames,
    configCount: destinationConfigs.length,
    normalizedValue: normalizedPayload.data.value,
    normalizedCurrency: normalizedPayload.data.currency,
    itemsCount: normalizedPayload.data.items?.length || 0,
    hasOrderId: !!normalizedPayload.data.orderId,
    hasCheckoutToken: !!normalizedPayload.data.checkoutToken,
  });
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { shopDomain: true },
  });
  const shopDomain = shop?.shopDomain || null;
  const metricsModule = shopDomain ? await import("../../utils/metrics-collector") : null;
  const sendPromises = destinationConfigs.map(async (destConfig) => {
    const destination = destConfig.platform;
    const destinationType = destConfig.configId
      ? `${destination}:${destConfig.configId}`
      : destConfig.platformId
      ? `${destination}:${destConfig.platformId}`
      : destination;
    const env = environment || (normalizedPayload.data as { environment?: "test" | "live" })?.environment || "live";
    const dedupResult = await checkDeliveryDeduplication(
      shopId,
      eventLog!.id,
      destinationType,
      env
    );
      if (dedupResult.isDuplicate) {
        logger.info("Event delivery deduplicated", {
          shopId,
          eventId: finalEventId,
          destination: destConfig.platform,
          configId: destConfig.configId,
          platformId: destConfig.platformId,
          destinationType,
        });
        if (shopDomain && metricsModule) {
          metricsModule.metrics.pxDedupDropped(shopDomain, destinationType);
        }
      await logEvent(
        shopId,
        normalizedPayload.eventName,
        finalEventId,
        normalizedPayload,
        destinationType,
        "ok",
        "deduplicated",
        "Event was already successfully delivered to this destination",
        null,
        null,
        null,
        null
      );
      return {
        success: true,
        platform: destination,
        deduplicated: true,
      };
    }
    try {
      logger.debug(`Sending ${normalizedPayload.eventName} to ${destination}`, {
        shopId,
        eventId: finalEventId,
        eventName: normalizedPayload.eventName,
        platform: destination,
        configId: destConfig.configId,
        platformId: destConfig.platformId,
      });
      let eventIdForSend = finalEventId;
      if (!eventIdForSend) {
        logger.error(`Missing eventId for ${normalizedPayload.eventName} event, generating fallback ID`, {
          shopId,
          eventName: normalizedPayload.eventName,
          destination,
          configId: destConfig.configId,
        });
        eventIdForSend = generateCanonicalEventId(
          normalizedPayload.data?.orderId || null,
          normalizedPayload.data?.checkoutToken || null,
          normalizedPayload.eventName,
          normalizedPayload.shopDomain,
          normalizedItems?.map(item => ({ id: item.id, quantity: item.quantity })) || undefined,
          "v2",
          payload.nonce || null
        );
      }
      const sendStartTime = Date.now();
      const sendResult = await sendPixelEventToPlatform(
        shopId,
        destination,
        normalizedPayload,
        eventIdForSend,
        destConfig.configId,
        destConfig.platformId,
        env
      );
      const sendLatencyMs = Date.now() - sendStartTime;
      if (shopDomain && metricsModule) {
        if (sendResult.success) {
          metricsModule.metrics.pxDestinationOk(shopDomain, destinationType);
        } else {
          metricsModule.metrics.pxDestinationFail(shopDomain, destinationType, sendResult.error || "unknown");
        }
        metricsModule.metrics.pxDestinationLatency(shopDomain, destinationType, sendLatencyMs);
      }
      await logEvent(
        shopId,
        normalizedPayload.eventName,
        finalEventId,
        normalizedPayload,
        destinationType,
        sendResult.ok ?? sendResult.success ? "ok" : "fail",
        sendResult.ok ?? sendResult.success ? undefined : (sendResult.errorCode || "send_failed"),
        sendResult.error || null,
        sendResult.httpStatus ?? null,
        sendResult.responseBody ?? null,
        sendResult.latencyMs ?? sendLatencyMs,
        sendResult.requestPayload
      );
      if (sendResult.success) {
        logger.info(`Successfully sent ${normalizedPayload.eventName} to ${destination}`, {
          shopId,
          eventId: finalEventId,
          eventName: normalizedPayload.eventName,
          platform: destination,
          configId: destConfig.configId,
          platformId: destConfig.platformId,
          latencyMs: sendLatencyMs,
        });
      } else {
        logger.warn(`Failed to send ${normalizedPayload.eventName} to ${destination}`, {
          shopId,
          eventName: normalizedPayload.eventName,
          eventId: finalEventId,
          platform: destination,
          configId: destConfig.configId,
          platformId: destConfig.platformId,
          error: sendResult.error,
          latencyMs: sendLatencyMs,
        });
      }
      return sendResult;
    } catch (error) {
      logger.error(`Error sending ${normalizedPayload.eventName} to ${destination}`, {
        shopId,
        eventName: normalizedPayload.eventName,
        eventId,
        platform: destination,
        configId: destConfig.configId,
        platformId: destConfig.platformId,
        error: error instanceof Error ? error.message : String(error),
      });
      await logEvent(
        shopId,
        normalizedPayload.eventName,
        finalEventId,
        normalizedPayload,
        destinationType,
        "fail",
        "send_error",
        error instanceof Error ? error.message : String(error),
        null,
        null,
        null,
        null
      );
      return {
        success: false,
        platform: destination,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  const results = await Promise.allSettled(sendPromises);
  const successCount = results.filter(
    (r) => r.status === "fulfilled" && r.value.success
  ).length;
  const deduplicatedCount = results.filter(
    (r) => r.status === "fulfilled" && (r.value as { deduplicated?: boolean }).deduplicated
  ).length;
  logger.info(`Event ${normalizedPayload.eventName} routing completed - sent to destinations`, {
    shopId,
    eventId: finalEventId,
    eventName: normalizedPayload.eventName,
    totalDestinations: destinationConfigs.length,
    successful: successCount,
    failed: destinationConfigs.length - successCount - deduplicatedCount,
    deduplicated: deduplicatedCount,
    normalizedValue: normalizedPayload.data.value,
    normalizedCurrency: normalizedPayload.data.currency,
    itemsCount: normalizedPayload.data.items?.length || 0,
    eventIdSource: eventId ? "from_client" : "generated_by_server",
    hasOrderId: !!normalizedPayload.data.orderId,
    hasCheckoutToken: !!normalizedPayload.data.checkoutToken,
  });
  const hasDeduplicated = results.some(
    (r) => r.status === "fulfilled" && (r.value as { deduplicated?: boolean }).deduplicated
  );
  return {
    success: true,
    eventId: finalEventId || undefined,
    destinations: destinationNames,
    deduplicated: hasDeduplicated,
  };
}

export async function processBatchEvents(
  shopId: string,
  events: Array<{
    payload: PixelEventPayload;
    eventId: string | null;
    destinations: string[];
  }>,
  environment?: "test" | "live"
): Promise<EventPipelineResult[]> {
  const concurrency = Number(process.env.PIPELINE_CONCURRENCY || 5);
  return parallelLimit(events, concurrency, (event) =>
    processEventPipeline(shopId, event.payload, event.eventId, event.destinations, environment)
  );
}

export async function getEventStats(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<{
  total: number;
  success: number;
  failed: number;
  deduplicated: number;
  byDestination: Record<string, { total: number; success: number; failed: number }>;
}> {
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    select: {
      payloadJson: true,
    },
  });
  const stats = {
    total: receipts.length,
    success: 0,
    failed: 0,
    deduplicated: 0,
    byDestination: {} as Record<string, { total: number; success: number; failed: number }>,
  };
  for (const receipt of receipts) {
    const payload = receipt.payloadJson as Record<string, unknown> | null;
    const data = payload?.data as Record<string, unknown> | undefined;
    const hasValue = typeof data?.value === "number" && data.value > 0;
    const hasCurrency = !!data?.currency;
    if (hasValue && hasCurrency) {
      stats.success++;
    } else {
      stats.failed++;
    }
    const dest = extractPlatformFromPayload(payload) || "unknown";
    if (!stats.byDestination[dest]) {
      stats.byDestination[dest] = { total: 0, success: 0, failed: 0 };
    }
    stats.byDestination[dest].total++;
    if (hasValue && hasCurrency) {
      stats.byDestination[dest].success++;
    } else {
      stats.byDestination[dest].failed++;
    }
  }
  return stats;
}
