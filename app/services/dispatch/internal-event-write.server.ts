import { randomUUID, createHash } from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "~/db.server";
import { normalizeOrderId, encrypt } from "~/utils/crypto.server";
import type { ProcessedEvent } from "~/lib/pixel-events/ingest-pipeline.server";
import type { IngestRequestContext } from "~/lib/pixel-events/ingest-queue.server";
import type { DispatchDestination } from "./queue";

const SHOPIFY_TO_INTERNAL_EVENT: Record<string, string> = {
  checkout_completed: "purchase",
  product_added_to_cart: "add_to_cart",
  product_viewed: "view_item",
  checkout_started: "begin_checkout",
  page_viewed: "page_view",
};

function toInternalEventName(shopifyEventName: string): string {
  return SHOPIFY_TO_INTERNAL_EVENT[shopifyEventName] ?? shopifyEventName;
}

function numericValue(v: unknown): number {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const n = parseFloat(String(v));
  return Number.isNaN(n) ? 0 : n;
}

export async function persistInternalEventsAndDispatchJobs(
  shopId: string,
  processedEvents: ProcessedEvent[],
  requestContext: IngestRequestContext | undefined,
  environment: "test" | "live"
): Promise<void> {
  if (process.env.SERVER_SIDE_CONVERSIONS_ENABLED !== "true") return;
  const s2sConfigs = await prisma.pixelConfig.findMany({
    where: {
      shopId,
      serverSideEnabled: true,
      platform: { in: ["google", "meta", "tiktok"] },
      isActive: true,
      environment,
    },
    select: { platform: true },
  });
  const destinationsByPlatform: Record<string, DispatchDestination> = {
    google: "GA4",
    meta: "META",
    tiktok: "TIKTOK",
  };
  const s2sDestinations = s2sConfigs
    .map((c) => destinationsByPlatform[c.platform])
    .filter(Boolean) as DispatchDestination[];

  if (s2sDestinations.length === 0) return;

  // P1-3: Anonymize IP and UA for privacy compliance
  const rawIp = requestContext?.ip ?? null;
  const ip_encrypted = rawIp ? encrypt(rawIp) : null;
  let ip = rawIp;
  if (ip) {
    if (ip.includes(".") && ip.split(".").length === 4) {
      // IPv4: Anonymize last octet (e.g., 1.2.3.4 -> 1.2.3.0)
      const parts = ip.split(".");
      parts[3] = "0";
      ip = parts.join(".");
    } else {
      // IPv6 or other: Hash
      ip = createHash("sha256").update(ip).digest("hex");
    }
  }
  
  // Hash user agent
  const rawUa = requestContext?.user_agent ?? null;
  const user_agent_encrypted = rawUa ? encrypt(rawUa) : null;
  const user_agent = rawUa ? createHash("sha256").update(rawUa).digest("hex") : null;
  const page_url = requestContext?.page_url ?? null;
  const referrer = requestContext?.referrer ?? null;

  await prisma.$transaction(async (tx) => {
    for (const event of processedEvents) {
      const eventName = event.payload.eventName === "checkout_completed" ? "purchase" : event.payload.eventName;
      const internalEventName = toInternalEventName(eventName);
      // Reuse the consent filtering logic from ingestion pipeline
      // event.platformsToRecord contains platforms that passed consent and config checks
      const allowedDestinations: DispatchDestination[] = [];
      
      for (const platformName of event.destinations) {
        const dest = destinationsByPlatform[platformName];
        if (dest && s2sDestinations.includes(dest)) {
          allowedDestinations.push(dest);
        }
      }

      if (allowedDestinations.length === 0) continue;

      const value = numericValue(event.payload.data?.value ?? 0);
      const currency = event.payload.data?.currency ?? "USD";
      const items = event.payload.data?.items ?? [];
      const transactionId = event.payload.eventName === "checkout_completed" ? (event.payload.data?.orderId ?? event.orderId ?? null) : null;
      
      // P0-4: Unify event_id for purchase events to match webhook (orderId)
      // This prevents duplicate events/dispatch jobs for the same order
      let eventId = event.eventId ?? randomUUID();
      if (internalEventName === "purchase" && transactionId) {
        eventId = normalizeOrderId(transactionId);
      }

      const consentPurposes = event.payload.consent
        ? { marketing: event.payload.consent.marketing, analytics: event.payload.consent.analytics }
        : null;
      const timestampMs = event.payload.timestamp;
      const occurredAt = new Date(timestampMs);

      // Upsert to avoid duplicates if webhook/pixel race occurs
      // We prioritize the existing entry if it exists (idempotency)
      const internalEvent = await tx.internalEvent.upsert({
        where: {
          shopId_event_id_event_name: {
            shopId,
            event_id: eventId,
            event_name: internalEventName,
          }
        },
        update: {}, // Do nothing if exists
        create: {
          id: randomUUID(),
          shopId,
          source: "web_pixel",
          event_name: internalEventName,
          event_id: eventId,
          client_id: null,
          timestamp: BigInt(timestampMs),
          occurred_at: occurredAt,
          ip,
          ip_encrypted,
          user_agent,
          user_agent_encrypted,
          page_url,
          referrer,
          querystring: null,
          currency,
          value,
          transaction_id: transactionId,
          items: Array.isArray(items) ? items : [],
          user_data_hashed: Prisma.JsonNull,
          consent_purposes: consentPurposes ?? Prisma.JsonNull,
          environment,
        },
      });

      // Only create dispatch jobs if we actually created a new event (or if we want to retry, but usually we don't want duplicate jobs)
      // However, upsert returns the object whether created or updated. 
      // If it was updated (already existed), we might already have jobs. 
      // To avoid duplicate jobs, we should check if jobs exist or just assume if the event existed, jobs were handled.
      // A simple heuristic: check if occurred_at matches (unlikely to be exact same ms if different source) 
      // or just check if we can check if it was created. Prisma upsert doesn't tell us.
      // But since we did update: {}, if it existed, nothing changed.
      // If we want to strictly avoid duplicate jobs for the SAME event_id, we should check if jobs exist.
      
      // P1-2: Fix race condition using createMany with skipDuplicates
      if (allowedDestinations.length > 0) {
        await tx.eventDispatchJob.createMany({
          data: allowedDestinations.map((destination) => ({
            id: randomUUID(),
            internal_event_id: internalEvent.id,
            destination,
            status: "PENDING",
            attempts: 0,
            next_retry_at: new Date(),
            updatedAt: new Date(),
          })),
          skipDuplicates: true,
        });
      }
    }
  });
}
