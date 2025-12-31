export interface EventMapping {
  shopifyEvent: string;
  platformEvent: string;
  requiredParams: string[];
  optionalParams: string[];
  paramTransformations?: Record<string, string>;
}

export interface PlatformEventMapping {
  platform: string;
  mappings: Record<string, EventMapping>;
}

export const STANDARD_EVENT_MAPPINGS: Record<string, PlatformEventMapping> = {
  google: {
    platform: "google",
    mappings: {
      checkout_completed: {
        shopifyEvent: "checkout_completed",
        platformEvent: "purchase",
        requiredParams: ["value", "currency", "transaction_id"],
        optionalParams: ["items", "coupon", "shipping", "tax"],
        paramTransformations: {
          transaction_id: "event_id",
          items: "items",
        },
      },
      checkout_started: {
        shopifyEvent: "checkout_started",
        platformEvent: "begin_checkout",
        requiredParams: ["value", "currency"],
        optionalParams: ["items", "coupon"],
      },
      add_to_cart: {
        shopifyEvent: "add_to_cart",
        platformEvent: "add_to_cart",
        requiredParams: ["value", "currency", "items"],
        optionalParams: [],
      },
      view_item: {
        shopifyEvent: "view_item",
        platformEvent: "view_item",
        requiredParams: ["value", "currency", "items"],
        optionalParams: [],
      },
      remove_from_cart: {
        shopifyEvent: "remove_from_cart",
        platformEvent: "remove_from_cart",
        requiredParams: ["value", "currency", "items"],
        optionalParams: [],
      },
    },
  },
  meta: {
    platform: "meta",
    mappings: {
      checkout_completed: {
        shopifyEvent: "checkout_completed",
        platformEvent: "Purchase",
        requiredParams: ["value", "currency", "event_id"],
        optionalParams: ["contents", "content_ids", "content_type", "num_items", "order_id"],
        paramTransformations: {
          items: "contents",
          event_id: "event_id",
        },
      },
      checkout_started: {
        shopifyEvent: "checkout_started",
        platformEvent: "InitiateCheckout",
        requiredParams: ["value", "currency"],
        optionalParams: ["contents", "content_ids", "num_items"],
        paramTransformations: {
          items: "contents",
        },
      },
      add_to_cart: {
        shopifyEvent: "add_to_cart",
        platformEvent: "AddToCart",
        requiredParams: ["value", "currency", "contents"],
        optionalParams: ["content_ids", "content_type", "num_items"],
        paramTransformations: {
          items: "contents",
        },
      },
      view_item: {
        shopifyEvent: "view_item",
        platformEvent: "ViewContent",
        requiredParams: ["value", "currency", "contents"],
        optionalParams: ["content_ids", "content_type"],
        paramTransformations: {
          items: "contents",
        },
      },
    },
  },
  tiktok: {
    platform: "tiktok",
    mappings: {
      checkout_completed: {
        shopifyEvent: "checkout_completed",
        platformEvent: "CompletePayment",
        requiredParams: ["value", "currency", "event_id"],
        optionalParams: ["contents", "content_type", "quantity"],
        paramTransformations: {
          items: "contents",
          event_id: "event_id",
        },
      },
      checkout_started: {
        shopifyEvent: "checkout_started",
        platformEvent: "InitiateCheckout",
        requiredParams: ["value", "currency"],
        optionalParams: ["contents", "content_type", "quantity"],
        paramTransformations: {
          items: "contents",
        },
      },
      add_to_cart: {
        shopifyEvent: "add_to_cart",
        platformEvent: "AddToCart",
        requiredParams: ["value", "currency", "contents"],
        optionalParams: ["content_type", "quantity"],
        paramTransformations: {
          items: "contents",
        },
      },
      view_item: {
        shopifyEvent: "view_item",
        platformEvent: "ViewContent",
        requiredParams: ["value", "currency", "contents"],
        optionalParams: ["content_type"],
        paramTransformations: {
          items: "contents",
        },
      },
    },
  },
  pinterest: {
    platform: "pinterest",
    mappings: {
      checkout_completed: {
        shopifyEvent: "checkout_completed",
        platformEvent: "checkout",
        requiredParams: ["value", "currency", "order_quantity"],
        optionalParams: ["line_items", "order_id"],
        paramTransformations: {
          items: "line_items",
        },
      },
      add_to_cart: {
        shopifyEvent: "add_to_cart",
        platformEvent: "add_to_cart",
        requiredParams: ["value", "currency"],
        optionalParams: ["line_items", "order_quantity"],
        paramTransformations: {
          items: "line_items",
        },
      },
      view_item: {
        shopifyEvent: "view_item",
        platformEvent: "page_visit",
        requiredParams: ["value", "currency"],
        optionalParams: ["line_items"],
        paramTransformations: {
          items: "line_items",
        },
      },
    },
  },
};

export function getPlatformEventMapping(platform: string): PlatformEventMapping | null {
  return STANDARD_EVENT_MAPPINGS[platform] || null;
}

export function getEventMapping(
  platform: string,
  shopifyEvent: string
): EventMapping | null {
  const platformMapping = getPlatformEventMapping(platform);
  if (!platformMapping) return null;

  return platformMapping.mappings[shopifyEvent] || null;
}

export function mergeEventMappings(
  platform: string,
  customMappings: Record<string, string>
): Record<string, EventMapping> {
  const platformMapping = getPlatformEventMapping(platform);
  if (!platformMapping) return {};

  const merged: Record<string, EventMapping> = { ...platformMapping.mappings };

  for (const [shopifyEvent, customPlatformEvent] of Object.entries(customMappings)) {
    if (merged[shopifyEvent]) {
      merged[shopifyEvent] = {
        ...merged[shopifyEvent],
        platformEvent: customPlatformEvent,
      };
    }
  }

  return merged;
}

export function validateEventMapping(
  platform: string,
  shopifyEvent: string,
  platformEvent: string
): { valid: boolean; error?: string } {
  const platformMapping = getPlatformEventMapping(platform);
  if (!platformMapping) {
    return {
      valid: false,
      error: `不支持的平台: ${platform}`,
    };
  }

  const standardMapping = platformMapping.mappings[shopifyEvent];
  if (!standardMapping) {
    return {
      valid: false,
      error: `不支持的 Shopify 事件: ${shopifyEvent}`,
    };
  }

  return { valid: true };
}

export function getRecommendedMappings(platforms: string[]): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};

  for (const platform of platforms) {
    const platformMapping = getPlatformEventMapping(platform);
    if (!platformMapping) continue;

    result[platform] = {};
    for (const [shopifyEvent, mapping] of Object.entries(platformMapping.mappings)) {
      result[platform][shopifyEvent] = mapping.platformEvent;
    }
  }

  return result;
}

