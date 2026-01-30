import type { GoogleCredentials } from "~/types";
import type { InternalEventPayload, SendEventResult } from "./types";

const GA4_MP_URL = "https://www.google-analytics.com/mp/collect";

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
  const { measurementId, apiSecret } = credentials;
  const clientId = event.client_id ?? `s2s_${event.event_id}`;
  const params: Record<string, unknown> = {
    engagement_time_msec: 1,
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
  const url = `${GA4_MP_URL}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      return { ok: true, statusCode: res.status };
    }
    const text = await res.text();
    return { ok: false, statusCode: res.status, error: text || `HTTP ${res.status}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
