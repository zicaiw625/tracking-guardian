

import { logger } from "../utils/logger.server";
import type { EventMapping } from "./event-mapping.server";

export interface NormalizedEventParams {
  event_name: string;
  value: number;
  currency: string;
  items?: Array<{
    item_id: string;
    item_name: string;
    price: number;
    quantity: number;
  }>;
  content_ids?: string[];
  contents?: Array<{
    id: string;
    quantity: number;
    item_price: number;
  }>;
  line_items?: Array<{
    product_id: string;
    product_name: string;
    product_price: number;
    quantity: number;
  }>;
  event_id?: string;
  transaction_id?: string;
  order_id?: string;
  order_quantity?: number;
  num_items?: number;
  [key: string]: unknown;
}

export interface ShopifyEventData {
  event_name: string;
  value?: number;
  currency?: string;
  items?: Array<{
    id?: string;
    item_id?: string;
    variant_id?: string;
    sku?: string;
    name?: string;
    product_name?: string;
    title?: string;
    price?: number;
    quantity?: number;
    product_id?: string;
    variant_id?: string;
  }>;
  order_id?: string;
  event_id?: string;
  checkout_token?: string;
  [key: string]: unknown;
}

export function normalizeEventParameters(
  shopifyEvent: ShopifyEventData,
  mapping: EventMapping,
  platform: string
): NormalizedEventParams {
  const normalized: NormalizedEventParams = {
    event_name: mapping.platformEvent,
    value: 0,
    currency: "USD",
  };

  if (shopifyEvent.value !== undefined && shopifyEvent.value !== null) {
    normalized.value = typeof shopifyEvent.value === "number"
      ? shopifyEvent.value
      : parseFloat(String(shopifyEvent.value)) || 0;
  }

  if (shopifyEvent.currency) {
    normalized.currency = String(shopifyEvent.currency).toUpperCase();
  }

  if (shopifyEvent.items && Array.isArray(shopifyEvent.items)) {
    normalized.items = normalizeItems(shopifyEvent.items);

    if (platform === "meta" || platform === "tiktok") {
      normalized.contents = convertToContentsFormat(shopifyEvent.items);
      normalized.content_ids = normalized.contents.map(c => c.id);
    }

    if (platform === "pinterest") {
      normalized.line_items = convertToLineItemsFormat(shopifyEvent.items);
      normalized.order_quantity = normalized.line_items.reduce(
        (sum, item) => sum + item.quantity,
        0
      );
    }

    if (platform === "meta") {
      normalized.num_items = normalized.contents.reduce(
        (sum, item) => sum + item.quantity,
        0
      );
    }
  }

  if (shopifyEvent.event_id) {
    normalized.event_id = String(shopifyEvent.event_id);
    if (platform === "google") {
      normalized.transaction_id = normalized.event_id;
    }
  }

  if (shopifyEvent.order_id) {
    normalized.order_id = String(shopifyEvent.order_id);
  }

  if (mapping.paramTransformations) {
    for (const [sourceKey, targetKey] of Object.entries(mapping.paramTransformations)) {
      if (sourceKey in normalized && !(targetKey in normalized)) {
        (normalized as Record<string, unknown>)[targetKey] = normalized[sourceKey as keyof NormalizedEventParams];
      }
    }
  }

  validateRequiredParams(normalized, mapping.requiredParams, platform);

  return normalized;
}

function normalizeItems(
  items: ShopifyEventData["items"]
): NormalizedEventParams["items"] {
  if (!items || !Array.isArray(items)) return undefined;

  return items
    .filter(item => item != null)
    .map(item => ({
      item_id: getItemId(item),
      item_name: getItemName(item),
      price: getItemPrice(item),
      quantity: getItemQuantity(item),
    }))
    .filter(item => item.item_id && item.item_name);
}

function convertToContentsFormat(
  items: ShopifyEventData["items"]
): Array<{ id: string; quantity: number; item_price: number }> {
  if (!items || !Array.isArray(items)) return [];

  return items
    .filter(item => item != null)
    .map(item => ({
      id: getItemId(item) || "",
      quantity: getItemQuantity(item),
      item_price: getItemPrice(item),
    }))
    .filter(item => item.id);
}

function convertToLineItemsFormat(
  items: ShopifyEventData["items"]
): Array<{ product_id: string; product_name: string; product_price: number; quantity: number }> {
  if (!items || !Array.isArray(items)) return [];

  return items
    .filter(item => item != null)
    .map(item => ({
      product_id: getItemId(item) || "",
      product_name: getItemName(item) || "",
      product_price: getItemPrice(item),
      quantity: getItemQuantity(item),
    }))
    .filter(item => item.product_id);
}

function getItemId(item: NonNullable<ShopifyEventData["items"]>[0]): string {
  return (
    item.id ||
    item.item_id ||
    item.variant_id ||
    item.sku ||
    item.product_id ||
    ""
  );
}

function getItemName(item: NonNullable<ShopifyEventData["items"]>[0]): string {
  return (
    item.name ||
    item.item_name ||
    item.product_name ||
    item.title ||
    ""
  );
}

function getItemPrice(item: NonNullable<ShopifyEventData["items"]>[0]): number {
  if (item.price !== undefined && item.price !== null) {
    return typeof item.price === "number"
      ? item.price
      : parseFloat(String(item.price)) || 0;
  }
  return 0;
}

function getItemQuantity(item: NonNullable<ShopifyEventData["items"]>[0]): number {
  if (item.quantity !== undefined && item.quantity !== null) {
    return typeof item.quantity === "number"
      ? item.quantity
      : parseInt(String(item.quantity), 10) || 1;
  }
  return 1;
}

function validateRequiredParams(
  params: NormalizedEventParams,
  requiredParams: string[],
  platform: string
): void {
  const missing: string[] = [];

  for (const param of requiredParams) {
    if (!(param in params) || params[param as keyof NormalizedEventParams] === undefined) {
      missing.push(param);
    }
  }

  if (missing.length > 0) {
    logger.warn("Missing required parameters", {
      platform,
      eventName: params.event_name,
      missingParams: missing,
    });
  }
}

export function normalizeCurrency(currency: string | undefined): string {
  if (!currency) return "USD";

  const upper = currency.toUpperCase();

  const validCurrencies = [
    "USD", "EUR", "GBP", "JPY", "CNY", "CAD", "AUD", "CHF", "HKD", "SGD",
    "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RUB", "INR", "BRL", "MXN",
  ];

  if (validCurrencies.includes(upper)) {
    return upper;
  }

  return upper;
}

export function normalizeValue(value: unknown): number {
  if (typeof value === "number") {
    return Math.max(0, value);
  }

  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? 0 : Math.max(0, parsed);
  }

  return 0;
}

