

import crypto from "crypto";
import { logger } from "../utils/logger.server";

export interface GenerateEventIdOptions {
  orderId?: string;
  checkoutToken?: string;
  platform: string;
  eventType: string;
  timestampBucket?: number;
  shopDomain?: string;
}

export function generateEventId(options: GenerateEventIdOptions): string {
  const {
    orderId,
    checkoutToken,
    platform,
    eventType,
    timestampBucket,
    shopDomain,
  } = options;

  if (eventType === "purchase" || eventType === "checkout_completed") {
    if (!orderId) {
      logger.warn("Missing orderId for purchase event, falling back to checkoutToken", {
        checkoutToken,
        platform,
        shopDomain,
      });
      if (checkoutToken) {
        return generateEventIdFromToken(checkoutToken, platform, eventType);
      }
      throw new Error("Cannot generate event ID for purchase event without orderId or checkoutToken");
    }

    return generateEventIdFromOrder(orderId, platform, eventType);
  }

  const identifier = orderId || checkoutToken;
  if (!identifier) {
    throw new Error("Cannot generate event ID without orderId or checkoutToken");
  }

  const bucket = timestampBucket || getCurrentTimestampBucket();
  return generateEventIdFromIdentifier(identifier, platform, eventType, bucket);
}

function generateEventIdFromOrder(
  orderId: string,
  platform: string,
  eventType: string
): string {
  const normalizedOrderId = normalizeOrderId(orderId);
  const content = `${normalizedOrderId}:${platform}:${eventType}`;
  return hashContent(content);
}

function generateEventIdFromToken(
  checkoutToken: string,
  platform: string,
  eventType: string
): string {
  const content = `${checkoutToken}:${platform}:${eventType}`;
  return hashContent(content);
}

function generateEventIdFromIdentifier(
  identifier: string,
  platform: string,
  eventType: string,
  timestampBucket: number
): string {
  const content = `${identifier}:${platform}:${eventType}:${timestampBucket}`;
  return hashContent(content);
}

function normalizeOrderId(orderId: string): string {

  const gidMatch = orderId.match(/gid:\/\/shopify\/Order\/(\d+)/i);
  if (gidMatch) {
    return gidMatch[1];
  }

  if (/^\d+$/.test(orderId)) {
    return orderId;
  }

  return orderId;
}

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").substring(0, 32);
}

function getCurrentTimestampBucket(): number {
  const now = Math.floor(Date.now() / 1000);

  return Math.floor(now / 300) * 300;
}

export function isValidEventId(eventId: string): boolean {

  return /^[a-f0-9]{32}$/i.test(eventId);
}

export function getEventIdFieldName(platform: string): string {
  switch (platform) {
    case "google":
      return "transaction_id";
    case "meta":
      return "event_id";
    case "tiktok":
      return "event_id";
    case "pinterest":
      return "event_id";
    default:
      return "event_id";
  }
}

export interface EventDeduplicationCheck {
  eventId: string;
  platform: string;
  orderId?: string;
  timestamp: Date;
}

export function generateDedupKey(eventId: string, platform: string): string {
  return `${platform}:${eventId}`;
}

export interface DeduplicationStrategy {
  strategy: "client_priority" | "server_priority" | "first_wins";
  graceWindowSeconds?: number;
}

export const DEFAULT_DEDUP_STRATEGY: DeduplicationStrategy = {
  strategy: "server_priority",
  graceWindowSeconds: 60,
};

export function shouldSendEvent(
  eventId: string,
  source: "client" | "server",
  strategy: DeduplicationStrategy = DEFAULT_DEDUP_STRATEGY
): boolean {

  switch (strategy.strategy) {
    case "server_priority":

      return source === "server";

    case "client_priority":

      return source === "client";

    case "first_wins":

      return true;

    default:
      return true;
  }
}

