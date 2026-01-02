

import type { PixelEventPayload } from "~/routes/api.pixel-events/types";
import { normalizeParameterValue } from "./mapping.server";


export interface CanonicalEvent {
  eventName: string;
  timestamp: number;
  shopDomain: string;
  
  
  orderId: string | null;
  checkoutToken: string | null;
  orderNumber: string | null;
  
  
  value: number;
  currency: string;
  
  
  items: CanonicalItem[];
  
  
  metadata: Record<string, unknown>;
}

export interface CanonicalItem {
  id: string; 
  name: string;
  price: number;
  quantity: number;
  sku?: string;
  variantId?: string;
  productId?: string;
  category?: string;
}


export function normalizeEvent(
  payload: PixelEventPayload
): CanonicalEvent {
  const data = payload.data || {};
  
  
  const orderId = normalizeOrderIdentifier(data.orderId);
  const checkoutToken = normalizeCheckoutToken(data.checkoutToken);
  const orderNumber = data.orderNumber ? String(data.orderNumber) : null;
  
  
  const value = normalizeValue(data.value);
  const currency = normalizeCurrency(data.currency || "USD");
  
  
  const items = normalizeItems(data.items);
  
  
  const metadata: Record<string, unknown> = {};
  const excludedKeys = new Set([
    "orderId", "checkoutToken", "orderNumber",
    "value", "currency", "items",
    "productId", "productTitle", "price", "quantity",
  ]);
  
  for (const [key, value] of Object.entries(data)) {
    if (!excludedKeys.has(key) && value !== undefined && value !== null) {
      metadata[key] = value;
    }
  }
  
  return {
    eventName: payload.eventName,
    timestamp: payload.timestamp,
    shopDomain: payload.shopDomain,
    orderId,
    checkoutToken,
    orderNumber,
    value,
    currency,
    items,
    metadata,
  };
}


function normalizeOrderIdentifier(orderId: unknown): string | null {
  if (!orderId) return null;
  
  const str = String(orderId);
  
  
  const gidMatch = str.match(/gid:\/\/shopify\/Order\/(\d+)/i);
  if (gidMatch) {
    return gidMatch[1];
  }
  
  
  if (/^\d+$/.test(str)) {
    return str;
  }
  
  return str;
}


function normalizeCheckoutToken(token: unknown): string | null {
  if (!token) return null;
  const str = String(token).trim();
  return str.length > 0 ? str : null;
}


function normalizeValue(value: unknown): number {
  if (typeof value === "number") {
    return Math.max(0, Math.round(value * 100) / 100);
  }
  
  if (typeof value === "string") {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      return Math.max(0, Math.round(num * 100) / 100);
    }
  }
  
  return 0;
}


function normalizeCurrency(currency: unknown): string {
  if (typeof currency === "string") {
    const normalized = currency.toUpperCase().trim();
    
    if (/^[A-Z]{3}$/.test(normalized)) {
      return normalized;
    }
  }
  return "USD"; 
}


function normalizeItems(items: unknown): CanonicalItem[] {
  if (!Array.isArray(items)) {
    return [];
  }
  
  return items
    .filter(item => item !== null && item !== undefined)
    .map(item => {
      const itemObj = item as Record<string, unknown>;
      
      
      const id = 
        extractString(itemObj.product_id) ||
        extractString(itemObj.variant_id) ||
        extractString(itemObj.id) ||
        extractString(itemObj.sku) ||
        "";
      
      
      const name = 
        extractString(itemObj.name) ||
        extractString(itemObj.title) ||
        extractString(itemObj.productTitle) ||
        "";
      
      
      const price = normalizeItemPrice(itemObj.price || itemObj.item_price);
      
      
      const quantity = normalizeQuantity(itemObj.quantity);
      
      
      const sku = extractString(itemObj.sku);
      
      
      const variantId = extractString(itemObj.variant_id || itemObj.variantId);
      
      
      const productId = extractString(itemObj.product_id || itemObj.productId);
      
      
      const category = extractString(itemObj.category || itemObj.product_type);
      
      return {
        id,
        name,
        price,
        quantity,
        ...(sku && { sku }),
        ...(variantId && { variantId }),
        ...(productId && { productId }),
        ...(category && { category }),
      };
    })
    .filter(item => item.id.length > 0); 
}


function normalizeItemPrice(price: unknown): number {
  if (typeof price === "number") {
    return Math.max(0, Math.round(price * 100) / 100);
  }
  
  if (typeof price === "string") {
    const num = parseFloat(price);
    if (!isNaN(num)) {
      return Math.max(0, Math.round(num * 100) / 100);
    }
  }
  
  
  if (price && typeof price === "object") {
    const priceObj = price as Record<string, unknown>;
    const amount = priceObj.amount || priceObj.value;
    return normalizeItemPrice(amount);
  }
  
  return 0;
}


function normalizeQuantity(quantity: unknown): number {
  if (typeof quantity === "number") {
    return Math.max(1, Math.round(quantity));
  }
  
  if (typeof quantity === "string") {
    const num = parseInt(quantity, 10);
    if (!isNaN(num)) {
      return Math.max(1, num);
    }
  }
  
  return 1; 
}


function extractString(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}


export function generateDeduplicationKey(
  canonicalEvent: CanonicalEvent
): string {
  const { createHash } = require("crypto");
  
  
  const identifier = canonicalEvent.orderId || canonicalEvent.checkoutToken || "";
  
  
  const itemsHash = generateItemsHash(canonicalEvent.items);
  
  
  const keyInput = `${canonicalEvent.shopDomain}:${identifier}:${canonicalEvent.eventName}:${itemsHash}`;
  
  return createHash("sha256")
    .update(keyInput, "utf8")
    .digest("hex")
    .substring(0, 32);
}


function generateItemsHash(items: CanonicalItem[]): string {
  const { createHash } = require("crypto");
  
  if (items.length === 0) {
    return "empty";
  }
  
  
  const sortedItems = [...items]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(item => `${item.id}:${item.quantity}`)
    .join(",");
  
  return createHash("sha256")
    .update(sortedItems, "utf8")
    .digest("hex")
    .substring(0, 16);
}


export function validateCanonicalEvent(
  event: CanonicalEvent
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  
  if (!event.eventName || event.eventName.trim().length === 0) {
    errors.push("eventName is required");
  }
  
  
  if (!event.timestamp || event.timestamp <= 0) {
    errors.push("timestamp is required and must be positive");
  }
  
  
  if (!event.shopDomain || event.shopDomain.trim().length === 0) {
    errors.push("shopDomain is required");
  }
  
  
  if (event.eventName === "checkout_completed" || event.eventName === "purchase") {
    if (!event.orderId && !event.checkoutToken) {
      errors.push("orderId or checkoutToken is required for purchase events");
    }
  }
  
  
  if (event.value < 0) {
    errors.push("value must be non-negative");
  }
  
  
  if (!/^[A-Z]{3}$/.test(event.currency)) {
    errors.push("currency must be a valid ISO 4217 code (3 uppercase letters)");
  }
  
  
  const eventsWithItems = [
    "checkout_completed",
    "checkout_started",
    "product_added_to_cart",
    "purchase",
  ];
  
  if (eventsWithItems.includes(event.eventName)) {
    if (event.items.length === 0) {
      errors.push(`items array is required for ${event.eventName} events`);
    }
    
    
    for (let i = 0; i < event.items.length; i++) {
      const item = event.items[i];
      if (!item.id || item.id.trim().length === 0) {
        errors.push(`items[${i}].id is required`);
      }
      if (item.price < 0) {
        errors.push(`items[${i}].price must be non-negative`);
      }
      if (item.quantity < 1) {
        errors.push(`items[${i}].quantity must be at least 1`);
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

