import { randomUUID, createHash } from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "~/db.server";
import { normalizeOrderId, encrypt, decrypt } from "~/utils/crypto.server";
import { getBoolEnv } from "~/utils/config.server";
import { logger } from "~/utils/logger.server";
import type { ProcessedEvent } from "~/lib/pixel-events/ingest-pipeline.server";
import type { IngestRequestContext } from "~/lib/pixel-events/ingest-queue.server";
import type { DispatchDestination } from "./queue";
import { checkAndReserveBillingSlot, releaseBillingSlot } from "~/services/billing/gate.server";
import { getPlanOrDefault } from "~/services/billing/plans";
import type { PlanId } from "~/services/billing/plans";
import { resolveEffectivePlan } from "~/services/billing/effective-plan.server";

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

function sanitizeStoredUrl(urlStr: string | null | undefined): string | null {
  if (!urlStr) return null;
  try {
    const url = new URL(urlStr);
    return `${url.protocol}//${url.hostname}${url.pathname}`;
  } catch {
    return null;
  }
}

export async function persistInternalEventsAndDispatchJobs(
  shopId: string,
  processedEvents: ProcessedEvent[],
  requestContext: IngestRequestContext | undefined,
  environment: "test" | "live"
): Promise<void> {
  if (!getBoolEnv("SERVER_SIDE_CONVERSIONS_ENABLED", false)) return;
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
  const shopForBilling = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { plan: true, entitledUntil: true },
  });
  const effectivePlan = resolveEffectivePlan(shopForBilling?.plan, shopForBilling?.entitledUntil);
  const billingPlan = getPlanOrDefault(effectivePlan);
  const planId = billingPlan.id as PlanId;
  const blockedPurchaseOrderIds = new Set<string>();
  const reservedPurchaseOrderYearMonth = new Map<string, string>();
  const purchaseOrderIds = Array.from(
    new Set(
      processedEvents
        .filter((event) => event.payload.eventName === "checkout_completed")
        .map((event) => event.payload.data?.orderId ?? event.orderId ?? null)
        .filter((orderId): orderId is string => typeof orderId === "string" && orderId.length > 0)
        .map((orderId) => normalizeOrderId(orderId))
    )
  );
  for (const orderId of purchaseOrderIds) {
    const reservation = await checkAndReserveBillingSlot(shopId, planId, orderId);
    if (!reservation.ok) {
      throw new Error(`Failed to reserve billing slot: ${reservation.error.message}`);
    }
    if (!reservation.value.success) {
      blockedPurchaseOrderIds.add(orderId);
      logger.warn("Billing gate blocked purchase event dispatch", {
        shopId,
        orderId,
        planId,
        current: reservation.value.current,
        limit: reservation.value.limit,
      });
      continue;
    }
    if (!reservation.value.alreadyCounted) {
      reservedPurchaseOrderYearMonth.set(orderId, reservation.value.yearMonth);
    }
  }

  let rawIp = requestContext?.ip ?? null;
  if (!rawIp && requestContext?.ip_encrypted) {
    try {
      rawIp = decrypt(requestContext.ip_encrypted);
    } catch {
      rawIp = null;
    }
  }
  const ip_encrypted = requestContext?.ip_encrypted ?? (rawIp ? encrypt(rawIp) : null);
  let ip = rawIp;
  if (ip) {
    if (ip.includes(".") && ip.split(".").length === 4) {
      const parts = ip.split(".");
      parts[3] = "0";
      ip = parts.join(".");
    } else {
      ip = createHash("sha256").update(ip).digest("hex");
    }
  }

  let rawUa = requestContext?.user_agent ?? null;
  if (!rawUa && requestContext?.user_agent_encrypted) {
    try {
      rawUa = decrypt(requestContext.user_agent_encrypted);
    } catch {
      rawUa = null;
    }
  }
  const user_agent_encrypted = requestContext?.user_agent_encrypted ?? (rawUa ? encrypt(rawUa) : null);
  const user_agent = rawUa ? createHash("sha256").update(rawUa).digest("hex") : null;
  const page_url = sanitizeStoredUrl(requestContext?.page_url);
  const referrer = sanitizeStoredUrl(requestContext?.referrer);

  try {
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

      // Use canonical event data if available, otherwise fallback to payload
      const value = event.canonical ? event.canonical.value : numericValue(event.payload.data?.value ?? 0);
      const currency = event.canonical ? event.canonical.currency : (event.payload.data?.currency ?? "USD");
      
      // For items, we need to map CanonicalEvent items (camelCase) to InternalEvent items (snake_case/legacy format if needed)
      // InternalEvent.items is Json, so we can store the clean canonical items or the raw ones.
      // Usually InternalEvent items should be somewhat standardized.
      // Let's use canonical items if available, but they have id/name/price/quantity.
      // The old logic used payload.data.items which was raw.
      const items = event.canonical?.items ?? (Array.isArray(event.payload.data?.items) ? event.payload.data?.items : []);

      const transactionId = event.payload.eventName === "checkout_completed" ? (event.payload.data?.orderId ?? event.orderId ?? null) : null;
      
      // P0-4: Unify event_id for purchase events to match webhook (orderId)
      // This prevents duplicate events/dispatch jobs for the same order
      let eventId = event.eventId ?? randomUUID();
      if (internalEventName === "purchase" && transactionId) {
        eventId = normalizeOrderId(transactionId);
      }
      if (internalEventName === "purchase" && blockedPurchaseOrderIds.has(eventId)) {
        continue;
      }

      const consentPurposes = event.payload.consent
        ? { marketing: event.payload.consent.marketing, analytics: event.payload.consent.analytics }
        : null;
      const timestampMs = event.payload.timestamp;
      const occurredAtMs = event.payload.occurredAt ?? timestampMs;
      const occurredAt = new Date(occurredAtMs);

      const uniqueWhere = {
        shopId_event_id_event_name: {
          shopId,
          event_id: eventId,
          event_name: internalEventName,
        },
      } as const;
      let internalEvent = await tx.internalEvent.findUnique({
        where: uniqueWhere,
        select: { id: true },
      });
      let didCreateInternalEvent = false;
      if (!internalEvent) {
        try {
          internalEvent = await tx.internalEvent.create({
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
            select: { id: true },
          });
          didCreateInternalEvent = true;
        } catch (error) {
          // Concurrent worker may have inserted the same event_id already.
          if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
            throw error;
          }
          internalEvent = await tx.internalEvent.findUnique({
            where: uniqueWhere,
            select: { id: true },
          });
          if (!internalEvent) {
            throw error;
          }
        }
      }
      if (internalEventName === "purchase" && reservedPurchaseOrderYearMonth.has(eventId)) {
        const yearMonth = reservedPurchaseOrderYearMonth.get(eventId)!;
        if (!didCreateInternalEvent) {
          await tx.$executeRaw`
            UPDATE "MonthlyUsage"
            SET "sentCount" = GREATEST("sentCount" - 1, 0), "updatedAt" = NOW()
            WHERE "shopId" = ${shopId}
              AND "yearMonth" = ${yearMonth}
          `;
        }
        reservedPurchaseOrderYearMonth.delete(eventId);
      }

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
  } catch (error) {
    for (const yearMonth of reservedPurchaseOrderYearMonth.values()) {
      await releaseBillingSlot(shopId, yearMonth);
    }
    throw error;
  }
}
