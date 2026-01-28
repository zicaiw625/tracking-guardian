import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";
import type { PixelEventPayload } from "~/lib/pixel-events/types";
import { generateCanonicalEventId } from "../event-normalizer.server";
import { parallelLimit } from "~/utils/helpers";
import { isReceiptHmacMatched } from "~/utils/common";

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

export async function processEventPipeline(
  shopId: string,
  payload: PixelEventPayload,
  eventId: string | null,
  destinations: string[] | Array<{ platform: string; configId?: string; platformId?: string }>,
  _environment?: "test" | "live",
  _pipelineOptions?: { skipDelivery?: boolean }
): Promise<EventPipelineResult> {
  const validation = validateEventPayload(payload);
  if (!validation.valid) {
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
      hasItems: normalizedItemsForEventId.length > 0,
      hasOrderId: !!normalizedPayload.data?.orderId,
      hasCheckoutToken: !!normalizedPayload.data?.checkoutToken,
    });
  } else {
    logger.debug(`Using provided eventId for ${payload.eventName}`, {
      shopId,
      eventName: payload.eventName,
      hasOrderId: !!normalizedPayload.data?.orderId,
      hasCheckoutToken: !!normalizedPayload.data?.checkoutToken,
    });
  }
  return {
    success: true,
    eventId: finalEventId || undefined,
    destinations: destinationConfigs.map(d => d.platform),
  };
}

export async function processBatchEvents(
  shopId: string,
  events: Array<{
    payload: PixelEventPayload;
    eventId: string | null;
    destinations: string[];
  }>,
  environment?: "test" | "live",
  options?: { persistOnly?: boolean }
): Promise<EventPipelineResult[]> {
  const concurrency = Number(process.env.PIPELINE_CONCURRENCY || 5);
  const pipelineOptions = options?.persistOnly ? { skipDelivery: true } : undefined;
  return parallelLimit(events, concurrency, async (event) => {
    try {
      return await processEventPipeline(shopId, event.payload, event.eventId, event.destinations, environment, pipelineOptions);
    } catch (e) {
      logger.error("processEventPipeline threw", e, { shopId, eventId: event.eventId });
      return { success: false, eventId: event.eventId ?? undefined, destinations: event.destinations, errors: [String(e)] };
    }
  });
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
  const matchedReceipts = receipts.filter((r) => isReceiptHmacMatched(r.payloadJson));
  const stats = {
    total: matchedReceipts.length,
    success: 0,
    failed: 0,
    deduplicated: 0,
    byDestination: {} as Record<string, { total: number; success: number; failed: number }>,
  };
  for (const receipt of matchedReceipts) {
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
