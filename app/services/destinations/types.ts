export const S2S_FETCH_TIMEOUT_MS = 20_000;

export interface InternalEventPayload {
  id: string;
  shopId: string;
  source: string;
  event_name: string;
  event_id: string;
  client_id: string | null;
  timestamp: bigint;
  occurred_at: Date;
  ip: string | null;
  ip_encrypted?: string | null;
  user_agent: string | null;
  user_agent_encrypted?: string | null;
  page_url: string | null;
  referrer: string | null;
  querystring: string | null;
  currency: string | null;
  value: unknown;
  transaction_id: string | null;
  items: unknown;
  user_data_hashed: unknown;
  consent_purposes: unknown;
}

export interface SendEventResult {
  ok: boolean;
  statusCode?: number;
  error?: string;
}
