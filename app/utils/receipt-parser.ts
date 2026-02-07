
import { extractPlatformFromPayload } from "./common";

export interface ParsedEventData {
  value?: number;
  currency?: string;
  items?: number; // count of items
  orderId?: string;
  platform: string;
}

export function extractEventData(payloadJson: unknown): ParsedEventData {
  const payload = payloadJson as Record<string, unknown> | null;
  const platform = extractPlatformFromPayload(payload) || "unknown";

  if (!payload) {
    return { platform };
  }

  const data = payload.data as Record<string, unknown> | undefined;
  let value: number | undefined;
  let currency: string | undefined;
  let items: number | undefined;
  let orderId: string | undefined;

  // Helper to safely parse numbers from potential strings
  const safeParseFloat = (val: unknown): number | undefined => {
    if (typeof val === "number") return val;
    if (typeof val === "string") {
      let clean = val.trim();
      if (clean === "") return undefined;

      // Handle European format where comma is decimal separator (e.g. 1.200,50)
      // Heuristic: if both . and , exist
      if (clean.includes(".") && clean.includes(",")) {
        const lastDotIndex = clean.lastIndexOf(".");
        const lastCommaIndex = clean.lastIndexOf(",");
        if (lastCommaIndex > lastDotIndex) {
            // Comma is likely the decimal separator (1.200,50)
            clean = clean.replace(/\./g, "").replace(",", ".");
        } else {
            // Dot is likely the decimal separator (1,200.50)
            clean = clean.replace(/,/g, "");
        }
      } else if (clean.includes(",")) {
         // Only comma. Could be 1,50 (1.50) or 1,200 (1200).
         // If it ends with ,xxx (3 digits), it's likely a thousands separator.
         // If it ends with ,xx or ,x (1-2 digits), it's likely a decimal separator.
         if (/,\d{3}$/.test(clean)) {
             // Likely thousands separator (1,000)
             clean = clean.replace(/,/g, "");
         } else if (/,\d{1,2}$/.test(clean)) {
             // Likely decimal separator (1,50)
             clean = clean.replace(",", ".");
             // Remove any remaining commas (though unlikely to have multiple if strict)
             clean = clean.replace(/,/g, "");
         } else {
             // Default: remove commas
             clean = clean.replace(/,/g, "");
         }
      }

      // Remove currency symbols and other non-numeric chars, keeping dot and minus
      clean = clean.replace(/[^0-9.-]+/g, "");
      
      if (clean === "") return undefined;
      const num = Number(clean);
      return isNaN(num) ? undefined : num;
    }
    return undefined;
  };

  // 1. Generic / Default structure
  if (data) {
    value = safeParseFloat(data.value);
    currency = data.currency as string | undefined;
    const dataItems = data.items as Array<unknown> | undefined;
    items = dataItems ? dataItems.length : undefined;
    if (data.orderId) orderId = String(data.orderId);
  }

  // 2. Platform-specific overrides
  if (platform === "google") {
    const events = payload.events as Array<Record<string, unknown>> | undefined;
    if (events && events.length > 0) {
      const params = events[0].params as Record<string, unknown> | undefined;
      value = safeParseFloat(params?.value);
      currency = params?.currency as string | undefined;
      items = Array.isArray(params?.items) ? params.items.length : undefined;
      if (params?.transaction_id) orderId = String(params.transaction_id);
    }
  } else if (platform === "meta" || platform === "facebook") {
    const eventsData = payload.data as Array<Record<string, unknown>> | undefined;
    if (eventsData && eventsData.length > 0) {
      // Meta often puts data in the first element of the 'data' array
      const customData = eventsData[0].custom_data as Record<string, unknown> | undefined;
      value = safeParseFloat(customData?.value);
      currency = customData?.currency as string | undefined;
      items = Array.isArray(customData?.contents) ? customData.contents.length : undefined;
      if (customData?.order_id) orderId = String(customData.order_id);
    }
  } else if (platform === "tiktok") {
    const eventsData = payload.data as Array<Record<string, unknown>> | undefined;
    if (eventsData && eventsData.length > 0) {
      // TikTok also uses 'data' array
      const properties = eventsData[0].properties as Record<string, unknown> | undefined;
      value = safeParseFloat(properties?.value);
      currency = properties?.currency as string | undefined;
      items = Array.isArray(properties?.contents) ? properties.contents.length : undefined;
      if (properties?.order_id) orderId = String(properties.order_id);
    }
  }

  return {
    value,
    currency,
    items,
    orderId,
    platform,
  };
}
