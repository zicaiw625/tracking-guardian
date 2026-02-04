import { postJson } from "~/utils/http";
import type { MetaCredentials } from "~/types";
import type { InternalEventPayload, SendEventResult } from "./types";
import { S2S_FETCH_TIMEOUT_MS } from "./types";

const META_GRAPH_BASE = process.env.META_GRAPH_VERSION 
  ? `https://graph.facebook.com/${process.env.META_GRAPH_VERSION}` 
  : "https://graph.facebook.com/v20.0";

const EVENT_NAME_MAP: Record<string, string> = {
  purchase: "Purchase",
  add_to_cart: "AddToCart",
  view_item: "ViewContent",
  begin_checkout: "InitiateCheckout",
};

function metaEventName(name: string): string {
  return EVENT_NAME_MAP[name] ?? name;
}

function toMetaContents(items: unknown): Array<{ id: string; quantity: number; item_price: number }> {
  if (!Array.isArray(items)) return [];
  return items
    .filter((i): i is Record<string, unknown> => i != null && typeof i === "object")
    .map((i) => ({
      id: String(i.id ?? i.variant_id ?? i.product_id ?? "").trim(),
      quantity: typeof i.quantity === "number" ? Math.max(1, i.quantity) : Math.max(1, parseInt(String(i.quantity ?? 1), 10) || 1),
      item_price: typeof i.price === "number" ? i.price : parseFloat(String(i.price ?? 0)) || 0,
    }))
    .filter((i) => i.id);
}

function numericValue(v: unknown): number {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const n = parseFloat(String(v));
  return Number.isNaN(n) ? 0 : n;
}

export async function sendEvent(
  event: InternalEventPayload,
  credentials: MetaCredentials
): Promise<SendEventResult> {
  const { pixelId, accessToken, testEventCode } = credentials;
  const userData: Record<string, string> = {};
  if (event.user_data_hashed && typeof event.user_data_hashed === "object") {
    const ud = event.user_data_hashed as Record<string, unknown>;
    if (typeof ud.em === "string") userData.em = ud.em;
    if (typeof ud.ph === "string") userData.ph = ud.ph;
    if (typeof ud.fn === "string") userData.fn = ud.fn;
    if (typeof ud.ln === "string") userData.ln = ud.ln;
  }

  // Add IP and User Agent to user_data (CAPI requirement)
  if (event.ip) userData.client_ip_address = event.ip;
  if (event.user_agent) userData.client_user_agent = event.user_agent;

  const eventTime = Math.floor(Number(event.timestamp) / 1000);

  // Prepare custom_data for business data
  const customData: Record<string, unknown> = {
    value: numericValue(event.value),
    currency: event.currency ?? "USD",
  };
  const contents = toMetaContents(event.items);
  if (contents.length > 0) {
    customData.content_ids = contents.map((c) => c.id);
    customData.contents = contents;
  }

  const payload: Record<string, unknown> = {
    event_name: metaEventName(event.event_name),
    event_time: eventTime,
    event_id: event.event_id,
    action_source: "website",
    user_data: userData,
    event_source_url: event.page_url ?? undefined,
    custom_data: customData,
  };

  const data = [payload];
  const body: Record<string, unknown> = { data };
  if (testEventCode) {
    body.test_event_code = testEventCode;
  }
  const url = `${META_GRAPH_BASE}/${pixelId}/events`;
  try {
    const res = await postJson(url, body, {
      timeout: S2S_FETCH_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const json = (res.data && typeof res.data === "object" ? res.data : {}) as Record<string, any>;
    
    if (res.ok && !json.error) {
      return { ok: true, statusCode: res.status };
    }
    const errMsg = (json as { error?: { message?: string } }).error?.message ?? res.statusText ?? `HTTP ${res.status}`;
    return { ok: false, statusCode: res.status, error: errMsg };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
