import { randomUUID, createHash } from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "~/db.server";
import { checkInitialConsent } from "~/lib/pixel-events/consent-filter";
import { getEffectiveConsentCategory } from "~/utils/platform-consent";
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
  requestContext: IngestRequestContext | undefined
): Promise<void> {
  if (process.env.SERVER_SIDE_CONVERSIONS_ENABLED !== "true") return;
  const s2sConfigs = await prisma.pixelConfig.findMany({
    where: {
      shopId,
      serverSideEnabled: true,
      platform: { in: ["google", "meta", "tiktok"] },
      isActive: true,
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

  // Anonymize IP to reduce PII storage risk
  const rawIp = requestContext?.ip ?? null;
  const ip = rawIp ? createHash("sha256").update(rawIp).digest("hex") : null;
  const user_agent = requestContext?.user_agent ?? null;
  const page_url = requestContext?.page_url ?? null;
  const referrer = requestContext?.referrer ?? null;

  await prisma.$transaction(async (tx) => {
    for (const event of processedEvents) {
      const eventName = event.payload.eventName === "checkout_completed" ? "purchase" : event.payload.eventName;
      const internalEventName = toInternalEventName(eventName);
      const consentResult = checkInitialConsent(event.payload.consent);
      const allowedDestinations: DispatchDestination[] = [];
      for (const dest of s2sDestinations) {
        const platform = dest === "GA4" ? "google" : dest === "META" ? "meta" : "tiktok";
        const category = getEffectiveConsentCategory(platform, false);
        if (category === "analytics" && consentResult.hasAnalyticsConsent) allowedDestinations.push(dest);
        if (category === "marketing" && consentResult.hasMarketingConsent) allowedDestinations.push(dest);
      }
      if (allowedDestinations.length === 0) continue;

      const eventId = event.eventId ?? randomUUID();
      const value = numericValue(event.payload.data?.value ?? 0);
      const currency = event.payload.data?.currency ?? "USD";
      const items = event.payload.data?.items ?? [];
      const transactionId = event.payload.eventName === "checkout_completed" ? (event.payload.data?.orderId ?? event.orderId ?? null) : null;
      const consentPurposes = event.payload.consent
        ? { marketing: event.payload.consent.marketing, analytics: event.payload.consent.analytics }
        : null;
      const timestampMs = event.payload.timestamp;
      const occurredAt = new Date(timestampMs);

      const internalEvent = await tx.internalEvent.create({
        data: {
          id: randomUUID(),
          shopId,
          source: "web_pixel",
          event_name: internalEventName,
          event_id: eventId,
          client_id: null,
          timestamp: BigInt(timestampMs),
          occurred_at: occurredAt,
          ip,
          user_agent,
          page_url,
          referrer,
          querystring: null,
          currency,
          value,
          transaction_id: transactionId,
          items: Array.isArray(items) ? items : [],
          user_data_hashed: Prisma.JsonNull,
          consent_purposes: consentPurposes ?? Prisma.JsonNull,
        },
      });

      for (const destination of allowedDestinations) {
        await tx.eventDispatchJob.create({
          data: {
            id: randomUUID(),
            internal_event_id: internalEvent.id,
            destination,
            status: "PENDING",
            attempts: 0,
            next_retry_at: new Date(),
            updatedAt: new Date(),
          },
        });
      }
    }
  });
}
