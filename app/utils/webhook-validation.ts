import { logger } from "./logger";
import type { OrderWebhookPayload } from "../types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  payload?: OrderWebhookPayload;
}

export function validateOrderWebhookPayload(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { valid: false, errors: ["Payload must be a non-null object"] };
  }

  const payload = data as Record<string, unknown>;

  if (typeof payload.id !== "number" || isNaN(payload.id)) {
    errors.push("Missing or invalid 'id' field (must be a number)");
  }

  if (payload.order_number !== undefined && payload.order_number !== null) {
    if (typeof payload.order_number !== "number") {
      errors.push("'order_number' must be a number if present");
    }
  }

  if (payload.total_price !== undefined && payload.total_price !== null) {
    if (typeof payload.total_price !== "string") {
      errors.push("'total_price' must be a string if present");
    }
  }

  if (payload.currency !== undefined && payload.currency !== null) {
    if (typeof payload.currency !== "string") {
      errors.push("'currency' must be a string if present");
    } else if (payload.currency.length > 10) {
      errors.push("'currency' is too long (max 10 characters)");
    }
  }

  if (payload.checkout_token !== undefined && payload.checkout_token !== null) {
    if (typeof payload.checkout_token !== "string") {
      errors.push("'checkout_token' must be a string if present");
    } else if (payload.checkout_token.length > 128) {
      errors.push("'checkout_token' is too long (max 128 characters)");
    }
  }

  if (payload.line_items !== undefined && payload.line_items !== null) {
    if (!Array.isArray(payload.line_items)) {
      errors.push("'line_items' must be an array if present");
    } else if (payload.line_items.length > 1000) {
      errors.push("'line_items' has too many items (max 1000)");
    }
  }

  if (payload.billing_address !== undefined && payload.billing_address !== null) {
    if (typeof payload.billing_address !== "object" || Array.isArray(payload.billing_address)) {
      errors.push("'billing_address' must be an object if present");
    }
  }

  if (payload.customer !== undefined && payload.customer !== null) {
    if (typeof payload.customer !== "object" || Array.isArray(payload.customer)) {
      errors.push("'customer' must be an object if present");
    }
  }

  if (payload.total_shipping_price_set !== undefined && payload.total_shipping_price_set !== null) {
    if (typeof payload.total_shipping_price_set !== "object" || Array.isArray(payload.total_shipping_price_set)) {
      errors.push("'total_shipping_price_set' must be an object if present");
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const sanitizedPayload: OrderWebhookPayload = {
    id: payload.id as number,
    order_number: sanitizeNumber(payload.order_number),
    total_price: sanitizeString(payload.total_price),
    currency: sanitizeString(payload.currency),
    checkout_token: sanitizeString(payload.checkout_token),
    total_tax: sanitizeString(payload.total_tax),
    processed_at: sanitizeString(payload.processed_at),
    email: sanitizeString(payload.email),
    phone: sanitizeString(payload.phone),
    total_shipping_price_set: sanitizeShippingPriceSet(payload.total_shipping_price_set),
    customer: sanitizeCustomer(payload.customer),
    billing_address: sanitizeBillingAddress(payload.billing_address),
    line_items: sanitizeLineItems(payload.line_items),
  };

  return { valid: true, errors: [], payload: sanitizedPayload };
}

export function parseOrderWebhookPayload(
  data: unknown,
  shopDomain: string
): OrderWebhookPayload | null {
  const result = validateOrderWebhookPayload(data);

  if (!result.valid) {
    logger.warn(`[P1] Invalid order webhook payload from ${shopDomain}`, {
      errors: result.errors,
      payloadType: typeof data,
      hasId: data && typeof data === "object" ? "id" in data : false,
    });
    return null;
  }

  return result.payload!;
}

function sanitizeString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  return value.length > 10000 ? value.substring(0, 10000) : value;
}

function sanitizeNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || isNaN(value)) return null;
  return value;
}

function sanitizeShippingPriceSet(value: unknown): OrderWebhookPayload["total_shipping_price_set"] {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  
  const set = value as Record<string, unknown>;
  if (!set.shop_money || typeof set.shop_money !== "object") {
    return { shop_money: null };
  }
  
  const shopMoney = set.shop_money as Record<string, unknown>;
  return {
    shop_money: {
      amount: sanitizeString(shopMoney.amount),
      currency_code: sanitizeString(shopMoney.currency_code),
    },
  };
}

function sanitizeCustomer(value: unknown): OrderWebhookPayload["customer"] {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  
  const customer = value as Record<string, unknown>;
  return {
    first_name: sanitizeString(customer.first_name),
    last_name: sanitizeString(customer.last_name),
  };
}

function sanitizeBillingAddress(value: unknown): OrderWebhookPayload["billing_address"] {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  
  const address = value as Record<string, unknown>;
  return {
    phone: sanitizeString(address.phone),
    first_name: sanitizeString(address.first_name),
    last_name: sanitizeString(address.last_name),
    city: sanitizeString(address.city),
    province: sanitizeString(address.province),
    country_code: sanitizeString(address.country_code),
    zip: sanitizeString(address.zip),
  };
}

function sanitizeLineItems(value: unknown): OrderWebhookPayload["line_items"] {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return null;
  
  const items = value.slice(0, 1000);
  
  return items.map((item) => {
    if (!item || typeof item !== "object") {
      return {
        product_id: undefined,
        variant_id: undefined,
        sku: undefined,
        title: undefined,
        name: undefined,
        quantity: undefined,
        price: undefined,
      };
    }
    
    const lineItem = item as Record<string, unknown>;
    return {
      product_id: typeof lineItem.product_id === "number" ? lineItem.product_id : undefined,
      variant_id: typeof lineItem.variant_id === "number" ? lineItem.variant_id : undefined,
      sku: typeof lineItem.sku === "string" ? lineItem.sku : undefined,
      title: typeof lineItem.title === "string" ? lineItem.title.substring(0, 500) : undefined,
      name: typeof lineItem.name === "string" ? lineItem.name.substring(0, 500) : undefined,
      quantity: typeof lineItem.quantity === "number" ? lineItem.quantity : undefined,
      price: typeof lineItem.price === "string" ? lineItem.price : undefined,
    };
  });
}
