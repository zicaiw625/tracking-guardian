import { Platform } from "~/utils/constants";

export interface ParsedEventData {
  value?: number;
  currency?: string;
  itemCount?: number;
  contentIds?: string[];
  raw?: Record<string, unknown>;
}

export function parseEventPayload(platform: string, payload: any): ParsedEventData {
  const result: ParsedEventData = {};

  if (!payload) return result;

  try {
    if (platform === Platform.GOOGLE) {
      const events = payload.events as Array<Record<string, unknown>> | undefined;
      if (events && events.length > 0) {
        const params = events[0].params as Record<string, unknown> | undefined;
        if (params) {
          result.value = typeof params.value === "number" ? params.value : undefined;
          result.currency = typeof params.currency === "string" ? params.currency : undefined;
          if (Array.isArray(params.items)) {
            result.itemCount = params.items.length;
          }
          result.raw = params;
        }
      }
    } else if (platform === Platform.META || platform === Platform.FACEBOOK) {
      const data = payload.data as Array<Record<string, unknown>> | undefined;
      if (data && data.length > 0) {
        const customData = data[0].custom_data as Record<string, unknown> | undefined;
        if (customData) {
          result.value = typeof customData.value === "number" ? customData.value : undefined;
          result.currency = typeof customData.currency === "string" ? customData.currency : undefined;
          if (Array.isArray(customData.contents)) {
            result.itemCount = customData.contents.length;
            result.contentIds = customData.contents
              .map((c: any) => c.id)
              .filter((id: any) => typeof id === "string" || typeof id === "number")
              .map(String);
          }
          result.raw = customData;
        }
      }
    } else if (platform === Platform.TIKTOK) {
      const data = payload.data as Array<Record<string, unknown>> | undefined;
      if (data && data.length > 0) {
        const properties = data[0].properties as Record<string, unknown> | undefined;
        if (properties) {
          result.value = typeof properties.value === "number" ? properties.value : undefined;
          result.currency = typeof properties.currency === "string" ? properties.currency : undefined;
          if (Array.isArray(properties.contents)) {
            result.itemCount = properties.contents.length;
            result.contentIds = properties.contents
              .map((c: any) => c.content_id)
              .filter((id: any) => typeof id === "string" || typeof id === "number")
              .map(String);
          }
          result.raw = properties;
        }
      }
    }
  } catch {
    // Silently fail parsing and return empty result
  }

  return result;
}
