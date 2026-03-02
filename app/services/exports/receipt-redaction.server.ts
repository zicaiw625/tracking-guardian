import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";
import { extractEventData } from "~/utils/receipt-parser";

type ReceiptPayload = Prisma.JsonValue | null;

export interface EvidenceReceiptRow {
  eventType: string;
  platform: string;
  pixelTimestamp: string;
  orderKeyHash: string;
  value: number | null;
  currency: string | null;
  itemsCount: number;
  hmacMatched: boolean;
  trustLevel: string;
  payloadJson: Record<string, unknown>;
}

function hashValue(input: string | null | undefined): string {
  if (!input) return "";
  return createHash("sha256").update(input).digest("hex");
}

function sanitizeItems(items: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        id: typeof row.id === "string" ? row.id : undefined,
        sku: typeof row.sku === "string" ? row.sku : undefined,
        quantity: typeof row.quantity === "number" ? row.quantity : undefined,
        price: typeof row.price === "number" ? row.price : undefined,
      };
    });
}

export function redactReceiptPayload(payloadJson: ReceiptPayload): Record<string, unknown> {
  if (!payloadJson || typeof payloadJson !== "object" || Array.isArray(payloadJson)) {
    return {};
  }
  const payload = payloadJson as Record<string, unknown>;
  const data = payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : {};
  return {
    eventName: typeof payload.eventName === "string" ? payload.eventName : undefined,
    eventId: typeof payload.eventId === "string" ? payload.eventId : undefined,
    data: {
      orderId: typeof data.orderId === "string" ? hashValue(data.orderId) : undefined,
      value: typeof data.value === "number" ? data.value : undefined,
      currency: typeof data.currency === "string" ? data.currency : undefined,
      items: sanitizeItems(data.items),
      itemsCount: Array.isArray(data.items) ? data.items.length : 0,
    },
    consent: payload.consent && typeof payload.consent === "object" ? payload.consent : undefined,
  };
}

export function buildEvidenceRow(input: {
  eventType: string;
  platform: string;
  pixelTimestamp: Date;
  orderKey: string | null;
  totalValue: Prisma.Decimal | null;
  currency: string | null;
  hmacMatched: boolean;
  trustLevel: string;
  payloadJson: ReceiptPayload;
}): EvidenceReceiptRow {
  const parsed = extractEventData(input.payloadJson);
  const payload = redactReceiptPayload(input.payloadJson);
  const derivedItems =
    payload.data && typeof payload.data === "object" && Array.isArray((payload.data as Record<string, unknown>).items)
      ? ((payload.data as Record<string, unknown>).items as unknown[])
      : [];
  return {
    eventType: input.eventType,
    platform: input.platform,
    pixelTimestamp: input.pixelTimestamp.toISOString(),
    orderKeyHash: hashValue(input.orderKey),
    value: input.totalValue ? Number(input.totalValue) : parsed.value ?? null,
    currency: input.currency ?? parsed.currency ?? null,
    itemsCount: derivedItems.length,
    hmacMatched: input.hmacMatched,
    trustLevel: input.trustLevel,
    payloadJson: payload,
  };
}
