

import type {
  PixelEventPayload,
  PixelEventName,
  ValidationResult,
} from "./types";

import {
  CHECKOUT_TOKEN_PATTERN,
  CHECKOUT_TOKEN_MIN_LENGTH,
  CHECKOUT_TOKEN_MAX_LENGTH,
  ORDER_ID_PATTERN,
  SHOP_DOMAIN_PATTERN,
  MIN_REASONABLE_TIMESTAMP,
  MAX_FUTURE_TIMESTAMP_MS,
} from '~/schemas/pixel-event';

function validateBodyStructure(
  body: unknown
): { valid: true; data: Record<string, unknown> } | ValidationResult {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Invalid request body", code: "invalid_body" };
  }
  return { valid: true, data: body as Record<string, unknown> };
}

/**
 * P0-1: 标准化事件字段名
 * 支持两种格式：
 * 1. PRD 格式：event_name, event_id, ts, context, data
 * 2. 内部格式：eventName, nonce, timestamp, shopDomain, data
 */
function normalizeEventFields(
  data: Record<string, unknown>
): {
  eventName: string;
  timestamp: number;
  shopDomain: string;
  eventId?: string;
  nonce?: string;
  context?: unknown;
} | null {
  // 检测是否为 PRD 格式（优先检查 event_name）
  const isPRDFormat = "event_name" in data;
  
  let eventName: string | undefined;
  let timestamp: number | undefined;
  let shopDomain: string | undefined;
  let eventId: string | undefined;
  let nonce: string | undefined;
  let context: unknown | undefined;

  if (isPRDFormat) {
    // PRD 格式：event_name, event_id, ts, context, data
    eventName = data.event_name as string | undefined;
    timestamp = data.ts as number | undefined;
    eventId = data.event_id as string | undefined;
    context = data.context;
    // PRD 格式中 shopDomain 可能在 context 中，或作为顶层字段
    shopDomain = (data.shopDomain || (context as Record<string, unknown>)?.shopDomain) as string | undefined;
  } else {
    // 内部格式：eventName, nonce, timestamp, shopDomain, data
    eventName = data.eventName as string | undefined;
    timestamp = data.timestamp as number | undefined;
    shopDomain = data.shopDomain as string | undefined;
    nonce = data.nonce as string | undefined;
    eventId = data.eventId as string | undefined;
  }

  if (!eventName || typeof eventName !== "string") {
    return null;
  }

  if (!shopDomain || typeof shopDomain !== "string") {
    return null;
  }

  if (timestamp === undefined || timestamp === null) {
    return null;
  }

  if (typeof timestamp !== "number") {
    return null;
  }

  return {
    eventName,
    timestamp,
    shopDomain,
    eventId,
    nonce,
    context,
  };
}

function validateRequiredFields(
  data: Record<string, unknown>
): ValidationResult | null {
  // P0-1: 先标准化字段名
  const normalized = normalizeEventFields(data);
  if (!normalized) {
    // 检查具体缺失的字段
    const isPRDFormat = "event_name" in data;
    if (isPRDFormat) {
      if (!data.event_name || typeof data.event_name !== "string") {
        return { valid: false, error: "Missing event_name", code: "missing_event_name" };
      }
      if (data.ts === undefined || data.ts === null) {
        return { valid: false, error: "Missing ts", code: "missing_timestamp" };
      }
      if (typeof data.ts !== "number") {
        return { valid: false, error: "Invalid ts type", code: "invalid_timestamp_type" };
      }
    } else {
      if (!data.eventName || typeof data.eventName !== "string") {
        return { valid: false, error: "Missing eventName", code: "missing_event_name" };
      }
      if (data.timestamp === undefined || data.timestamp === null) {
        return { valid: false, error: "Missing timestamp", code: "missing_timestamp" };
      }
      if (typeof data.timestamp !== "number") {
        return { valid: false, error: "Invalid timestamp type", code: "invalid_timestamp_type" };
      }
    }
    
    // 检查 shopDomain（可能在 context 中）
    const shopDomain = data.shopDomain || (data.context as Record<string, unknown>)?.shopDomain;
    if (!shopDomain || typeof shopDomain !== "string") {
      return { valid: false, error: "Missing shopDomain", code: "missing_shop_domain" };
    }
    
    // 如果到达这里，说明有其他问题，返回通用错误
    return { valid: false, error: "Invalid event format", code: "invalid_body" };
  }

  const { shopDomain, timestamp } = normalized;

  if (!SHOP_DOMAIN_PATTERN.test(shopDomain)) {
    return {
      valid: false,
      error: "Invalid shop domain format",
      code: "invalid_shop_domain_format",
    };
  }

  const now = Date.now();
  if (
    timestamp < MIN_REASONABLE_TIMESTAMP ||
    timestamp > now + MAX_FUTURE_TIMESTAMP_MS
  ) {
    return {
      valid: false,
      error: "Timestamp outside reasonable range",
      code: "invalid_timestamp_value",
    };
  }

  return null;
}

function validateConsentFormat(
  consent: unknown
): ValidationResult | null {
  if (consent === undefined) {
    return null;
  }

  if (typeof consent !== "object" || consent === null) {
    return { valid: false, error: "Invalid consent format", code: "invalid_consent_format" };
  }

  const consentObj = consent as Record<string, unknown>;

  if (consentObj.marketing !== undefined && typeof consentObj.marketing !== "boolean") {
    return {
      valid: false,
      error: "consent.marketing must be boolean",
      code: "invalid_consent_format",
    };
  }

  if (consentObj.analytics !== undefined && typeof consentObj.analytics !== "boolean") {
    return {
      valid: false,
      error: "consent.analytics must be boolean",
      code: "invalid_consent_format",
    };
  }

  if (consentObj.saleOfData !== undefined && typeof consentObj.saleOfData !== "boolean") {
    return {
      valid: false,
      error: "consent.saleOfData must be boolean",
      code: "invalid_consent_format",
    };
  }

  return null;
}

function validateCheckoutCompletedFields(
  eventData: Record<string, unknown> | undefined
): ValidationResult | null {
  if (!eventData?.orderId && !eventData?.checkoutToken) {
    return {
      valid: false,
      error: "Missing orderId and checkoutToken for checkout_completed event",
      code: "missing_order_identifiers",
    };
  }

  if (eventData?.checkoutToken) {
    const token = String(eventData.checkoutToken);
    if (
      token.length < CHECKOUT_TOKEN_MIN_LENGTH ||
      token.length > CHECKOUT_TOKEN_MAX_LENGTH
    ) {
      return {
        valid: false,
        error: "Invalid checkoutToken length",
        code: "invalid_checkout_token_format",
      };
    }
    if (!CHECKOUT_TOKEN_PATTERN.test(token)) {
      return {
        valid: false,
        error: "Invalid checkoutToken format",
        code: "invalid_checkout_token_format",
      };
    }
  }

  if (eventData?.orderId) {
    const orderIdStr = String(eventData.orderId);
    if (!ORDER_ID_PATTERN.test(orderIdStr)) {
      return {
        valid: false,
        error: "Invalid orderId format",
        code: "invalid_order_id_format",
      };
    }
  }

  if (eventData?.value !== undefined) {
    const val = Number(eventData.value);
    if (isNaN(val) || val < 0) {
      return {
        valid: false,
        error: "Invalid order value",
        code: "invalid_body",
      };
    }
  }

  if (eventData?.currency) {
    if (typeof eventData.currency !== "string" || !/^[A-Z]{3}$/.test(eventData.currency)) {
      return {
        valid: false,
        error: "Invalid currency format (must be 3-letter ISO code)",
        code: "invalid_body",
      };
    }
  }

  return null;
}

export function validateRequest(body: unknown): ValidationResult {

  const bodyResult = validateBodyStructure(body);
  if (!bodyResult.valid) {
    return bodyResult as ValidationResult;
  }
  const data = (bodyResult as { valid: true; data: Record<string, unknown> }).data;

  const requiredFieldsError = validateRequiredFields(data);
  if (requiredFieldsError) {
    return requiredFieldsError;
  }

  // P0-1: 标准化字段名
  const normalized = normalizeEventFields(data);
  if (!normalized) {
    return { valid: false, error: "Invalid event format", code: "invalid_body" };
  }

  const { eventName, timestamp, shopDomain, eventId, nonce, context } = normalized;

  // P0-1: 处理 consent（可能在 context 中，也可能在顶层）
  const consent = (data.consent || (context as Record<string, unknown>)?.consent) as PixelEventPayload["consent"] | undefined;
  const consentError = validateConsentFormat(consent);
  if (consentError) {
    return consentError;
  }

  // P0-1: 处理 data（PRD 格式中 data 是必需的）
  const eventData = (data.data || (context as Record<string, unknown>)?.data) as PixelEventPayload["data"] | undefined;

  if (eventName === "checkout_completed") {
    const checkoutError = validateCheckoutCompletedFields(eventData as Record<string, unknown> | undefined);
    if (checkoutError) {
      return checkoutError;
    }
  }

  // P0-1: 构建标准化后的 payload
  // eventId 优先使用 PRD 格式的 event_id，其次使用内部的 eventId，最后使用 nonce
  const finalEventId = eventId || nonce;

  return {
    valid: true,
    payload: {
      eventName: eventName as PixelEventName,
      timestamp,
      shopDomain,
      nonce: finalEventId, // 将 eventId 映射到 nonce 字段（保持向后兼容）
      consent,
      data: eventData || {},
    },
  };
}

export function isPrimaryEvent(eventName: string, mode: "purchase_only" | "full_funnel" = "purchase_only"): boolean {
  if (mode === "full_funnel") {

    const fullFunnelEvents = [
      "checkout_completed",
      "checkout_started",
      "checkout_contact_info_submitted",
      "checkout_shipping_info_submitted",
      "payment_info_submitted",
      "page_viewed",
      "product_added_to_cart",
      "product_viewed",
    ];
    return fullFunnelEvents.includes(eventName);
  }

  return eventName === "checkout_completed";
}

export interface PixelConfig {
  schema_version: "1";
  mode: "purchase_only" | "full_funnel";
  enabled_platforms: string;
  strictness: "strict" | "balanced";
}

export const DEFAULT_PIXEL_CONFIG: PixelConfig = {
  schema_version: "1",
  // v1 默认使用 purchase_only（仅收集结账完成事件），符合隐私最小化原则
  mode: "purchase_only",
  enabled_platforms: "meta,tiktok,google",
  strictness: "strict",
};

export function parsePixelConfig(configStr?: string): PixelConfig {
  if (!configStr) {
    return DEFAULT_PIXEL_CONFIG;
  }

  try {
    const parsed = JSON.parse(configStr);

    if (parsed.schema_version !== "1") {
      return DEFAULT_PIXEL_CONFIG;
    }

    return {
      schema_version: "1",
      mode: parsed.mode === "full_funnel" ? "full_funnel" : "purchase_only",
      enabled_platforms: typeof parsed.enabled_platforms === "string"
        ? parsed.enabled_platforms
        : DEFAULT_PIXEL_CONFIG.enabled_platforms,
      strictness: parsed.strictness === "balanced" ? "balanced" : "strict",
    };
  } catch {
    return DEFAULT_PIXEL_CONFIG;
  }
}

export function isPlatformEnabled(config: PixelConfig, platform: string): boolean {
  const normalizedPlatform = platform.toLowerCase();
  const enabledPlatforms = config.enabled_platforms.toLowerCase().split(",").map(p => p.trim());

  const platformAliases: Record<string, string[]> = {
    google: ["google", "ga4", "analytics"],
    meta: ["meta", "facebook", "fb"],
    tiktok: ["tiktok", "tt"],
  };

  for (const [canonical, aliases] of Object.entries(platformAliases)) {
    if (aliases.includes(normalizedPlatform)) {
      return enabledPlatforms.some(p => aliases.includes(p) || p === canonical);
    }
  }

  return enabledPlatforms.includes(normalizedPlatform);
}

