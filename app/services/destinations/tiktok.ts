import { postJson } from "~/utils/http";
import type { TikTokCredentials } from "~/types";
import type { InternalEventPayload, SendEventResult } from "./types";
import { S2S_FETCH_TIMEOUT_MS } from "./types";

const TIKTOK_EVENTS_API = process.env.TIKTOK_API_VERSION
  ? `https://business-api.tiktok.com/open_api/${process.env.TIKTOK_API_VERSION}/event/track`
  : "https://business-api.tiktok.com/open_api/v1.3/event/track";

const EVENT_NAME_MAP: Record<string, string> = {
  purchase: "CompletePayment",
  add_to_cart: "AddToCart",
  view_item: "ViewContent",
  begin_checkout: "InitiateCheckout",
};

function tiktokEventName(name: string): string {
  return EVENT_NAME_MAP[name] ?? name;
}

function toTiktokContents(items: unknown): Array<{ content_id: string; content_type: string; price: number; quantity: number }> {
  if (!Array.isArray(items)) return [];
  return items
    .filter((i): i is Record<string, unknown> => i != null && typeof i === "object")
    .map((i) => ({
      content_id: String(i.id ?? i.variant_id ?? i.product_id ?? "").trim(),
      content_type: "product",
      price: typeof i.price === "number" ? i.price : parseFloat(String(i.price ?? 0)) || 0,
      quantity: typeof i.quantity === "number" ? Math.max(1, i.quantity) : Math.max(1, parseInt(String(i.quantity ?? 1), 10) || 1),
    }))
    .filter((i) => i.content_id);
}

function numericValue(v: unknown): number {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const n = parseFloat(String(v));
  return Number.isNaN(n) ? 0 : n;
}

export async function sendEvent(
  event: InternalEventPayload,
  credentials: TikTokCredentials
): Promise<SendEventResult> {
  const pixelCode = credentials.pixelId;
  const { accessToken, testEventCode } = credentials;

  if (!event.ip || !event.user_agent) {
    return { ok: false, error: "Dropped: missing ip or user_agent" };
  }

  const contents = toTiktokContents(event.items);
  const payload: Record<string, unknown> = {
    event: tiktokEventName(event.event_name),
    event_id: event.event_id,
    timestamp: new Date(event.occurred_at).toISOString().replace(/\.\d{3}Z$/, "Z"),
    context: {
      ip: event.ip ?? undefined,
      user_agent: event.user_agent ?? undefined,
      page: {
        url: event.page_url ?? undefined,
        referrer: event.referrer ?? undefined,
      },
    },
    properties: {
      contents,
      value: numericValue(event.value),
      currency: event.currency ?? "USD",
      content_type: "product",
    },
    pixel_code: pixelCode,
  };
  if (testEventCode) {
    payload.test_event_code = testEventCode;
  }
  const body = { data: { events: [payload] } };
  try {
    const res = await postJson(TIKTOK_EVENTS_API, body, {
      timeout: S2S_FETCH_TIMEOUT_MS,
      headers: {
        "Access-Token": accessToken,
      },
    });
    const json = (res.data && typeof res.data === "object" ? res.data : {}) as Record<string, any>;
    const code = (json as { code?: number }).code;
    if (res.ok && code === 0) {
      return { ok: true, statusCode: res.status };
    }
    const errMsg = (json as { message?: string }).message ?? res.statusText ?? `HTTP ${res.status}`;
    return { ok: false, statusCode: res.status, error: errMsg };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
