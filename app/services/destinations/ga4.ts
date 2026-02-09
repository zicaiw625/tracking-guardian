import { postJson } from "~/utils/http";
import type { GoogleCredentials } from "~/types";
import type { InternalEventPayload, SendEventResult } from "./types";
import { S2S_FETCH_TIMEOUT_MS } from "./types";

const GA4_MP_URL = "https://www.google-analytics.com/mp/collect";
const GA4_MP_URL_EU = "https://region1.google-analytics.com/mp/collect";

function toGa4Items(items: unknown): Array<{ item_id: string; item_name: string; price: number; quantity: number }> {
  if (!Array.isArray(items)) return [];
  return items
    .filter((i): i is Record<string, unknown> => i != null && typeof i === "object")
    .map((i) => ({
      item_id: String(i.id ?? i.variant_id ?? i.product_id ?? "").trim(),
      item_name: String(i.name ?? i.item_name ?? "").trim() || "Unknown",
      price: typeof i.price === "number" ? i.price : parseFloat(String(i.price ?? 0)) || 0,
      quantity: typeof i.quantity === "number" ? Math.max(1, i.quantity) : Math.max(1, parseInt(String(i.quantity ?? 1), 10) || 1),
    }))
    .filter((i) => i.item_id);
}

function numericValue(v: unknown): number {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const n = parseFloat(String(v));
  return Number.isNaN(n) ? 0 : n;
}

export async function sendEvent(
  event: InternalEventPayload,
  credentials: GoogleCredentials
): Promise<SendEventResult> {
  const { measurementId, apiSecret, region } = credentials;
  const clientId = event.client_id ?? `s2s_${event.event_id}`;
  const params: Record<string, unknown> = {
    // P1-1: Add engagement_time_msec to ensure events are treated as engaging
    engagement_time_msec: 1,
    // P1: session_id must be a number (Date.now() or timestamp)
    session_id: event.transaction_id ? undefined : Date.now(), 
    value: numericValue(event.value),
    currency: event.currency ?? "USD",
  };
  if (event.transaction_id) {
    params.transaction_id = event.transaction_id;
  }
  const items = toGa4Items(event.items);
  if (items.length > 0) {
    params.items = items;
  }
  const body = {
    client_id: clientId,
    events: [
      {
        name: event.event_name,
        params,
      },
    ],
  };
  // P1: Support EU endpoint
  const baseUrl = region === "eu" ? GA4_MP_URL_EU : GA4_MP_URL;
  const url = `${baseUrl}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
  try {
    const res = await postJson(url, body, {
      timeout: S2S_FETCH_TIMEOUT_MS,
    });
    if (res.ok) {
      return { ok: true, statusCode: res.status };
    }
    const errorText = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    return { ok: false, statusCode: res.status, error: errorText || `HTTP ${res.status}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
