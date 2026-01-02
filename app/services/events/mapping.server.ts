

import type { PixelEventPayload } from "~/routes/api.pixel-events/types";

export interface EventMapping {
  shopifyEvent: string;
  platformEvent: string;
  parameterMapping: Record<string, string>;
  requiredParameters: string[];
}

export const EVENT_MAPPINGS: Record<string, Record<string, EventMapping>> = {
  google: {
    checkout_completed: {
      shopifyEvent: "checkout_completed",
      platformEvent: "purchase",
      parameterMapping: {
        value: "value",
        currency: "currency",
        items: "items",
        order_id: "transaction_id",
      },
      requiredParameters: ["value", "currency", "items"],
    },
    product_added_to_cart: {
      shopifyEvent: "product_added_to_cart",
      platformEvent: "add_to_cart",
      parameterMapping: {
        value: "value",
        currency: "currency",
        items: "items",
      },
      requiredParameters: ["value", "currency", "items"],
    },
    product_viewed: {
      shopifyEvent: "product_viewed",
      platformEvent: "view_item",
      parameterMapping: {
        value: "value",
        currency: "currency",
        items: "items",
      },
      requiredParameters: ["value", "currency", "items"],
    },
    checkout_started: {
      shopifyEvent: "checkout_started",
      platformEvent: "begin_checkout",
      parameterMapping: {
        value: "value",
        currency: "currency",
        items: "items",
      },
      requiredParameters: ["value", "currency"],
    },
  },
  meta: {
    checkout_completed: {
      shopifyEvent: "checkout_completed",
      platformEvent: "Purchase",
      parameterMapping: {
        value: "value",
        currency: "currency",
        content_ids: "content_ids",
        contents: "contents",
        order_id: "order_id",
      },
      requiredParameters: ["value", "currency"],
    },
    product_added_to_cart: {
      shopifyEvent: "product_added_to_cart",
      platformEvent: "AddToCart",
      parameterMapping: {
        value: "value",
        currency: "currency",
        content_ids: "content_ids",
        contents: "contents",
      },
      requiredParameters: ["value", "currency"],
    },
    product_viewed: {
      shopifyEvent: "product_viewed",
      platformEvent: "ViewContent",
      parameterMapping: {
        value: "value",
        currency: "currency",
        content_ids: "content_ids",
        contents: "contents",
      },
      requiredParameters: ["value", "currency"],
    },
    checkout_started: {
      shopifyEvent: "checkout_started",
      platformEvent: "InitiateCheckout",
      parameterMapping: {
        value: "value",
        currency: "currency",
        content_ids: "content_ids",
        contents: "contents",
      },
      requiredParameters: ["value", "currency"],
    },
  },
  tiktok: {
    checkout_completed: {
      shopifyEvent: "checkout_completed",
      platformEvent: "CompletePayment",
      parameterMapping: {
        value: "value",
        currency: "currency",
        content_type: "content_type",
        content_id: "content_id",
        contents: "contents",
        order_id: "order_id",
      },
      requiredParameters: ["value", "currency"],
    },
    product_added_to_cart: {
      shopifyEvent: "product_added_to_cart",
      platformEvent: "AddToCart",
      parameterMapping: {
        value: "value",
        currency: "currency",
        content_type: "content_type",
        content_id: "content_id",
        contents: "contents",
      },
      requiredParameters: ["value", "currency"],
    },
    product_viewed: {
      shopifyEvent: "product_viewed",
      platformEvent: "ViewContent",
      parameterMapping: {
        value: "value",
        currency: "currency",
        content_type: "content_type",
        content_id: "content_id",
        contents: "contents",
      },
      requiredParameters: ["value", "currency"],
    },
    checkout_started: {
      shopifyEvent: "checkout_started",
      platformEvent: "InitiateCheckout",
      parameterMapping: {
        value: "value",
        currency: "currency",
        content_type: "content_type",
        content_id: "content_id",
        contents: "contents",
      },
      requiredParameters: ["value", "currency"],
    },
  },
  pinterest: {
    checkout_completed: {
      shopifyEvent: "checkout_completed",
      platformEvent: "checkout",
      parameterMapping: {
        value: "value",
        currency: "currency",
        order_id: "order_id",
        line_items: "line_items",
      },
      requiredParameters: ["value", "currency"],
    },
    product_added_to_cart: {
      shopifyEvent: "product_added_to_cart",
      platformEvent: "addtocart",
      parameterMapping: {
        value: "value",
        currency: "currency",
        product_id: "product_id",
        quantity: "quantity",
      },
      requiredParameters: ["value", "currency"],
    },
    product_viewed: {
      shopifyEvent: "product_viewed",
      platformEvent: "pagevisit",
      parameterMapping: {
        value: "value",
        currency: "currency",
        product_id: "product_id",
      },
      requiredParameters: ["value", "currency"],
    },
    checkout_started: {
      shopifyEvent: "checkout_started",
      platformEvent: "initiatecheckout",
      parameterMapping: {
        value: "value",
        currency: "currency",
        line_items: "line_items",
      },
      requiredParameters: ["value", "currency"],
    },
  },
  snapchat: {
    checkout_completed: {
      shopifyEvent: "checkout_completed",
      platformEvent: "PURCHASE",
      parameterMapping: {
        value: "price",
        currency: "currency",
        transaction_id: "transaction_id",
        items: "items",
      },
      requiredParameters: ["price", "currency"],
    },
    product_added_to_cart: {
      shopifyEvent: "product_added_to_cart",
      platformEvent: "ADD_CART",
      parameterMapping: {
        value: "price",
        currency: "currency",
        item_ids: "item_ids",
        quantity: "quantity",
      },
      requiredParameters: ["price", "currency"],
    },
    product_viewed: {
      shopifyEvent: "product_viewed",
      platformEvent: "VIEW_CONTENT",
      parameterMapping: {
        value: "price",
        currency: "currency",
        item_ids: "item_ids",
      },
      requiredParameters: ["price", "currency"],
    },
    checkout_started: {
      shopifyEvent: "checkout_started",
      platformEvent: "START_CHECKOUT",
      parameterMapping: {
        value: "price",
        currency: "currency",
        item_ids: "item_ids",
      },
      requiredParameters: ["price", "currency"],
    },
  },
};

export function mapEventToPlatform(
  shopifyEvent: string,
  platform: string,
  payload: PixelEventPayload
): {
  eventName: string;
  parameters: Record<string, unknown>;
  isValid: boolean;
  missingParameters: string[];
} {
  const mapping = EVENT_MAPPINGS[platform]?.[shopifyEvent];

  if (!mapping) {
    return {
      eventName: shopifyEvent,
      parameters: {},
      isValid: false,
      missingParameters: [],
    };
  }

  const parameters: Record<string, unknown> = {};
  const missingParameters: string[] = [];

  for (const [shopifyKey, platformKey] of Object.entries(mapping.parameterMapping)) {
    const value = getNestedValue(payload.data, shopifyKey);
    if (value !== undefined) {
      parameters[platformKey] = value;
    }
  }

  for (const requiredParam of mapping.requiredParameters) {
    if (parameters[requiredParam] === undefined) {
      missingParameters.push(requiredParam);
    }
  }

  if (payload.data?.items && Array.isArray(payload.data.items)) {
    if (platform === "meta") {
      parameters.content_ids = payload.data.items.map((item: unknown) => {
        const itemObj = item as Record<string, unknown>;
        return itemObj.product_id || itemObj.variant_id || itemObj.sku;
      }).filter(Boolean);

      parameters.contents = payload.data.items.map((item: unknown) => {
        const itemObj = item as Record<string, unknown>;
        return {
          id: itemObj.product_id || itemObj.variant_id || itemObj.sku,
          quantity: itemObj.quantity || 1,
          item_price: itemObj.price || 0,
        };
      });
    } else if (platform === "tiktok") {
      parameters.contents = payload.data.items.map((item: unknown) => {
        const itemObj = item as Record<string, unknown>;
        return {
          content_id: itemObj.product_id || itemObj.variant_id || itemObj.sku,
          content_type: "product",
          price: itemObj.price || 0,
          quantity: itemObj.quantity || 1,
        };
      });
    } else if (platform === "pinterest") {
      parameters.line_items = payload.data.items.map((item: unknown) => {
        const itemObj = item as Record<string, unknown>;
        return {
          product_id: itemObj.product_id || itemObj.variant_id || itemObj.sku,
          quantity: itemObj.quantity || 1,
          unit_price: itemObj.price || 0,
        };
      });
    } else if (platform === "snapchat") {
      parameters.item_ids = payload.data.items.map((item: unknown) => {
        const itemObj = item as Record<string, unknown>;
        return itemObj.product_id || itemObj.variant_id || itemObj.sku;
      }).filter(Boolean);

      parameters.items = payload.data.items.map((item: unknown) => {
        const itemObj = item as Record<string, unknown>;
        return {
          item_id: itemObj.product_id || itemObj.variant_id || itemObj.sku,
          item_category: itemObj.product_type || "product",
          price: itemObj.price || 0,
          quantity: itemObj.quantity || 1,
        };
      });
    }
  }

  return {
    eventName: mapping.platformEvent,
    parameters,
    isValid: missingParameters.length === 0,
    missingParameters,
  };
}

function getNestedValue(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== "object" || obj === null) {
    return undefined;
  }

  const keys = path.split(".").filter(key => key.length > 0);
  if (keys.length === 0) {
    return undefined;
  }

  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    
    if (typeof current !== "object") {
      return undefined;
    }

    // 检查是否是数组，如果是数组则不支持嵌套访问
    if (Array.isArray(current)) {
      return undefined;
    }

    // 使用更安全的类型检查
    if (typeof current === "object" && current !== null && !Array.isArray(current)) {
      const record = current as Record<string, unknown>;
      if (key in record) {
        current = record[key];
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }
  }

  return current;
}

export function normalizeParameterValue(
  value: unknown,
  parameterName: string,
  platform: string
): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (parameterName === "currency") {
    if (typeof value === "string") {
      return value.toUpperCase().trim();
    }
  }

  if (parameterName === "value" || parameterName.includes("price")) {
    if (typeof value === "number") {
      return Math.round(value * 100) / 100;
    }
    if (typeof value === "string") {
      const num = parseFloat(value);
      return isNaN(num) ? undefined : Math.round(num * 100) / 100;
    }
  }

  if (Array.isArray(value)) {
    return value.filter(item => item !== null && item !== undefined);
  }

  return value;
}

