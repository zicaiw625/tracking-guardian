import { postJson } from "~/utils/http";
import { decrypt } from "~/utils/crypto.server";
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
  let ip = event.ip;
  if (event.ip_encrypted) {
    try {
      ip = decrypt(event.ip_encrypted);
    } catch {
      // Fallback
    }
  }
  if (ip) userData.client_ip_address = ip;

  let user_agent = event.user_agent;
  if (event.user_agent_encrypted) {
    try {
      user_agent = decrypt(event.user_agent_encrypted);
    } catch {
      // Fallback
    }
  }
  if (user_agent) userData.client_user_agent = user_agent;

  // P2: Validation - Meta requires client_user_agent and event_source_url when action_source=website
  if (!userData.client_user_agent) {
    return { ok: false, error: "Validation Error: Missing client_user_agent (required for action_source=website)" };
  }
  if (!event.page_url) {
    return { ok: false, error: "Validation Error: Missing event_source_url (required for action_source=website)" };
  }

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
  const baseUrl = `${META_GRAPH_BASE}/${pixelId}/events`;
  const fallbackUrl = `${baseUrl}?access_token=${encodeURIComponent(accessToken)}`;
  const sendToMeta = async (url: string) => {
    const res = await postJson(url, body, {
      timeout: S2S_FETCH_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const json = (res.data && typeof res.data === "object" ? res.data : {}) as Record<string, any>;
    const errMsg = (json as { error?: { message?: string } }).error?.message ?? res.statusText ?? `HTTP ${res.status}`;
    return { res, json, errMsg };
  };

  try {
    let { res, json, errMsg } = await sendToMeta(baseUrl);
    if (!res.ok && (res.status === 401 || res.status === 403)) {
      ({ res, json, errMsg } = await sendToMeta(fallbackUrl));
    }

    if (res.ok && !json.error) {
      return { ok: true, statusCode: res.status };
    }
    return { ok: false, statusCode: res.status, error: errMsg };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
