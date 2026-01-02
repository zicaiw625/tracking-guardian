

import { logger } from "../utils/logger.server";
import type { PixelEventPayload } from "../routes/api.pixel-events/types";
import { mapEventToPlatform } from "./events/mapping.server";
import { normalizeEventParameters } from "./event-parameter-normalization.server";
import type { EventMapping } from "./event-mapping";


export interface CanonicalEvent {
  eventName: string; 
  timestamp: number;
  shopDomain: string;
  
  
  orderId?: string | null;
  checkoutToken?: string | null;
  
  
  value: number;
  currency: string;
  
  
  items?: Array<{
    id: string;
    name: string;
    price: number;
    quantity: number;
    variantId?: string;
    sku?: string;
  }>;
  
  
  eventId: string;
  
  
  rawData: Record<string, unknown>;
}


export interface PlatformEventParams {
  eventName: string; 
  parameters: Record<string, unknown>;
  eventId?: string;
  isValid: boolean;
  missingParameters: string[];
}


export function normalizeToCanonical(
  payload: PixelEventPayload,
  eventId: string
): CanonicalEvent {
  const data = payload.data || {};
  
  
  const value = normalizeValue(data.value);
  const currency = normalizeCurrency(data.currency);
  
  
  const items = normalizeItems(data.items);
  
  return {
    eventName: payload.eventName,
    timestamp: payload.timestamp,
    shopDomain: payload.shopDomain,
    orderId: data.orderId || null,
    checkoutToken: data.checkoutToken || null,
    value,
    currency,
    items,
    eventId,
    rawData: data,
  };
}


export function mapToPlatform(
  canonical: CanonicalEvent,
  platform: string
): PlatformEventParams {
  
  const payload: PixelEventPayload = {
    eventName: canonical.eventName,
    timestamp: canonical.timestamp,
    shopDomain: canonical.shopDomain,
    data: {
      ...canonical.rawData,
      value: canonical.value,
      currency: canonical.currency,
      items: canonical.items?.map(item => ({
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        variant_id: item.variantId,
        sku: item.sku,
      })),
      orderId: canonical.orderId,
      checkoutToken: canonical.checkoutToken,
      event_id: canonical.eventId,
    },
  };
  
  const mapped = mapEventToPlatform(
    canonical.eventName,
    platform,
    payload
  );
  
  return {
    eventName: mapped.eventName,
    parameters: {
      ...mapped.parameters,
      event_id: canonical.eventId,
    },
    eventId: canonical.eventId,
    isValid: mapped.isValid,
    missingParameters: mapped.missingParameters,
  };
}


export function generateCanonicalEventId(
  orderId: string | null | undefined,
  checkoutToken: string | null | undefined,
  eventName: string,
  shopDomain: string,
  items?: Array<{ id: string; quantity: number }>
): string {
  const crypto = require("crypto");
  
  
  let identifier: string;
  if (orderId) {
    identifier = normalizeOrderId(orderId);
  } else if (checkoutToken) {
    identifier = checkoutToken;
  } else {
    
    logger.warn("Generating event ID without orderId or checkoutToken", {
      eventName,
      shopDomain,
    });
    identifier = `${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  }
  
  
  let itemsHash = "";
  if (items && items.length > 0) {
    const itemsKey = items
      .map(item => `${item.id}:${item.quantity}`)
      .sort()
      .join(",");
    itemsHash = crypto
      .createHash("sha256")
      .update(itemsKey)
      .digest("hex")
      .substring(0, 8);
  }
  
  
  const input = `${shopDomain}:${identifier}:${eventName}:${itemsHash}`;
  return crypto
    .createHash("sha256")
    .update(input, "utf8")
    .digest("hex")
    .substring(0, 32);
}


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


function normalizeCurrency(currency: unknown): string {
  if (typeof currency === "string") {
    const upper = currency.toUpperCase().trim();
    
    if (/^[A-Z]{3}$/.test(upper)) {
      return upper;
    }
  }
  
  return "USD"; 
}


function normalizeItems(
  items: unknown
): CanonicalEvent["items"] {
  if (!Array.isArray(items)) {
    return undefined;
  }
  
  return items
    .filter(item => item != null && typeof item === "object")
    .map(item => {
      const itemObj = item as Record<string, unknown>;
      
      
      const id =
        String(itemObj.id || itemObj.item_id || itemObj.variant_id || itemObj.sku || itemObj.product_id || "").trim();
      
      
      const name =
        String(itemObj.name || itemObj.item_name || itemObj.title || itemObj.product_name || "").trim();
      
      
      const price = normalizeValue(itemObj.price);
      
      
      const quantity =
        typeof itemObj.quantity === "number"
          ? Math.max(1, Math.floor(itemObj.quantity))
          : typeof itemObj.quantity === "string"
          ? Math.max(1, parseInt(itemObj.quantity, 10) || 1)
          : 1;
      
      
      const variantId = itemObj.variant_id
        ? String(itemObj.variant_id).trim()
        : undefined;
      const sku = itemObj.sku ? String(itemObj.sku).trim() : undefined;
      
      return {
        id,
        name,
        price,
        quantity,
        variantId,
        sku,
      };
    })
    .filter(item => item.id && item.name); 
}


function normalizeOrderId(orderId: string): string {
  
  const gidMatch = orderId.match(/gid:\/\/shopify\/Order\/(\d+)/i);
  if (gidMatch) {
    return gidMatch[1];
  }
  
  
  return orderId.trim();
}


export function validatePlatformEvent(
  platformEvent: PlatformEventParams
): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  if (!platformEvent.isValid) {
    errors.push(`Missing required parameters: ${platformEvent.missingParameters.join(", ")}`);
  }
  
  if (!platformEvent.eventName) {
    errors.push("Missing event name");
  }
  
  if (!platformEvent.eventId) {
    errors.push("Missing event ID");
  }
  
  return {
    isValid: errors.length === 0,
    errors,
  };
}


export function exportVisualPayload(
  canonical: CanonicalEvent,
  platformParams: PlatformEventParams
): {
  canonical: CanonicalEvent;
  platform: {
    eventName: string;
    parameters: Record<string, unknown>;
    validation: {
      isValid: boolean;
      missingParameters: string[];
    };
  };
} {
  return {
    canonical,
    platform: {
      eventName: platformParams.eventName,
      parameters: platformParams.parameters,
      validation: {
        isValid: platformParams.isValid,
        missingParameters: platformParams.missingParameters,
      },
    },
  };
}
