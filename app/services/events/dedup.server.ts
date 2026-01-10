import { generateEventId as generateCryptoEventId } from "~/utils/crypto.server";
import type { PixelEventPayload } from "~/routes/api.pixel-events/types";

export interface DeduplicationResult {
  eventId: string;
  isDuplicate: boolean;
  existingEventId?: string;
  deduplicationKey: string;
}

export function generateEventId(
  shopDomain: string,
  orderId: string | null,
  eventName: string,
  checkoutToken?: string | null
): string {
  if (orderId) {
    return generateCryptoEventId(orderId, eventName, shopDomain);
  }
  if (checkoutToken) {
    const hashInput = `${shopDomain}:${checkoutToken}:${eventName}`;
    return require("crypto")
      .createHash("sha256")
      .update(hashInput, "utf8")
      .digest("hex")
      .substring(0, 32);
  }
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  const hashInput = `${shopDomain}:${timestamp}:${random}:${eventName}`;
  return require("crypto")
    .createHash("sha256")
    .update(hashInput, "utf8")
    .digest("hex")
    .substring(0, 32);
}

export function generateDeduplicationKey(
  shopId: string,
  eventId: string,
  destinationType: string
): string {
  return `${shopId}:${eventId}:${destinationType}`;
}

export function extractDeduplicationInfo(
  payload: PixelEventPayload,
  shopDomain: string
): {
  orderId: string | null;
  checkoutToken: string | null;
  eventName: string;
} {
  return {
    orderId: payload.data?.orderId || null,
    checkoutToken: payload.data?.checkoutToken || null,
    eventName: payload.eventName,
  };
}

export function createDeduplicationResult(
  eventId: string,
  isDuplicate: boolean,
  existingEventId?: string
): DeduplicationResult {
  return {
    eventId,
    isDuplicate,
    existingEventId,
    deduplicationKey: eventId,
  };
}

export function isValidEventId(eventId: string): boolean {
  return /^[a-f0-9]{32}$/i.test(eventId);
}

export function generateHybridDeduplicationKey(
  clientEventId: string | null,
  serverEventId: string,
  destinationType: string
): string {
  if (clientEventId && isValidEventId(clientEventId)) {
    return `${destinationType}:client:${clientEventId}`;
  }
  return `${destinationType}:server:${serverEventId}`;
}
