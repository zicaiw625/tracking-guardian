import { randomUUID, createHash } from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { hashValueSync, normalizeOrderId as normalizeOrderIdForReceipt, encrypt } from "../../utils/crypto.server";
import { ORDER_WEBHOOK_COLLECT_IP_UA, ORDER_WEBHOOK_ENABLED } from "../../utils/config.server";
import { evaluatePlatformConsentWithStrategy } from "../../utils/platform-consent";
import type { ConsentState } from "../../utils/platform-consent";
import type { WebhookContext, WebhookHandlerResult, ShopWithPixelConfigs } from "../types";

function consentFromReceiptPayload(payloadJson: unknown): ConsentState | null {
  if (payloadJson == null || typeof payloadJson !== "object") return null;
  const raw = (payloadJson as { consent?: unknown }).consent;
  if (raw == null || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const marketing = typeof c.marketing === "boolean" ? c.marketing : undefined;
  const analytics = typeof c.analytics === "boolean" ? c.analytics : undefined;
  const saleOfDataAllowed = typeof c.saleOfDataAllowed === "boolean" ? c.saleOfDataAllowed : typeof c.saleOfData === "boolean" ? c.saleOfData : undefined;
  if (marketing === undefined && analytics === undefined && saleOfDataAllowed === undefined) return null;
  return { marketing, analytics, saleOfDataAllowed };
}

function normalizeOrderId(id: unknown): string {
  const s = String(id);
  if (s.startsWith("gid://")) {
    const segment = s.split("/").pop();
    return segment ?? s;
  }
  return s;
}

function normalizePhoneForHash(phone: string): string {
  return phone.replace(/\D/g, "").trim();
}

interface OrdersPaidPayload {
  id?: unknown;
  total_price?: unknown;
  currency?: unknown;
  line_items?: Array<{
    id?: unknown;
    title?: string;
    quantity?: number;
    price?: string | number;
    variant_id?: unknown;
    product_id?: unknown;
  }>;
  email?: string | null;
  billing_address?: { phone?: string | null } | null;
  default_address?: { phone?: string | null } | null;
  client_details?: {
    browser_ip?: string | null;
    user_agent?: string | null;
  };
}

function parseOrdersPaidPayload(payload: unknown): {
  orderId: string;
  totalPrice: number;
  currency: string;
  items: Array<{ id: string; name: string; price: number; quantity: number }>;
  email: string | null;
  phone: string | null;
  ip: string | null;
  user_agent: string | null;
} | null {
  if (payload == null || typeof payload !== "object") return null;
  const obj = payload as OrdersPaidPayload;
  const id = obj.id;
  const totalPriceRaw = obj.total_price;
  const currencyRaw = obj.currency;
  if (id == null || totalPriceRaw == null || currencyRaw == null) return null;
  const orderId = normalizeOrderId(id);
  const totalPrice = typeof totalPriceRaw === "string" ? parseFloat(totalPriceRaw) : Number(totalPriceRaw);
  const currency = String(currencyRaw).trim();
  if (orderId === "" || !Number.isFinite(totalPrice) || currency.length !== 3) return null;
  const lineItems = Array.isArray(obj.line_items) ? obj.line_items : [];
  const items = lineItems
    .filter((item): item is NonNullable<typeof item> => item != null && typeof item === "object")
    .map((item) => {
      const price = typeof item.price === "string" ? parseFloat(item.price) : Number(item.price ?? 0);
      const quantity = typeof item.quantity === "number" ? Math.max(1, item.quantity) : 1;
      const idStr = String(item.variant_id ?? item.product_id ?? item.id ?? "").trim();
      return {
        id: idStr || randomUUID(),
        name: String(item.title ?? "").trim() || "Unknown",
        price: Number.isFinite(price) ? price : 0,
        quantity,
      };
    })
    .filter((i) => i.id);
  const email = typeof obj.email === "string" && obj.email.trim() ? obj.email.trim().toLowerCase() : null;
  const phoneRaw = obj.billing_address?.phone ?? obj.default_address?.phone;
  const phone = typeof phoneRaw === "string" && phoneRaw.trim() ? phoneRaw.trim() : null;
  const ip = typeof obj.client_details?.browser_ip === "string" ? obj.client_details.browser_ip : null;
  const user_agent = typeof obj.client_details?.user_agent === "string" ? obj.client_details.user_agent : null;
  return { orderId, totalPrice, currency, items, email, phone, ip, user_agent };
}

export async function handleOrdersPaid(
  context: WebhookContext,
  shopRecord: ShopWithPixelConfigs | null
): Promise<WebhookHandlerResult> {
  const { shop, payload } = context;
  if (!shopRecord) {
    logger.info(`orders/paid received for unknown shop ${shop}, acknowledging`);
    return { success: true, status: 200, message: "OK" };
  }
  if (!ORDER_WEBHOOK_ENABLED) {
    return { success: true, status: 200, message: "OK" };
  }
  const parsed = parseOrdersPaidPayload(payload);
  if (!parsed) {
    logger.warn(`orders/paid invalid payload for ${shop}`);
    return { success: true, status: 200, message: "OK" };
  }
  const shopId = shopRecord.id;
  const rawIp = ORDER_WEBHOOK_COLLECT_IP_UA ? parsed.ip : null;
  const rawUserAgent = ORDER_WEBHOOK_COLLECT_IP_UA ? parsed.user_agent : null;
  try {
    const existingInternal = await prisma.internalEvent.findUnique({
      where: {
        shopId_event_id_event_name: {
          shopId,
          event_id: parsed.orderId,
          event_name: "purchase",
        },
      },
      select: { id: true },
    });
    if (existingInternal) {
      await prisma.orderSummary.upsert({
        where: { shopId_orderId: { shopId, orderId: parsed.orderId } },
        create: {
          id: randomUUID(),
          shopId,
          orderId: parsed.orderId,
          totalPrice: parsed.totalPrice,
          currency: parsed.currency,
        },
        update: { totalPrice: parsed.totalPrice, currency: parsed.currency },
      });
      return { success: true, status: 200, message: "OK", orderId: parsed.orderId };
    }

    const normalizedOrderIdForReceipt = normalizeOrderIdForReceipt(parsed.orderId);
    const receipt = await prisma.pixelEventReceipt.findFirst({
      where: {
        shopId,
        eventType: "purchase",
        OR: [
          { orderKey: normalizedOrderIdForReceipt },
          { altOrderKey: normalizedOrderIdForReceipt },
        ],
      },
      orderBy: { pixelTimestamp: "desc" },
      select: { payloadJson: true },
    });
    const consentState = consentFromReceiptPayload(receipt?.payloadJson ?? null);

    let receiptPageUrl: string | null = null;
    if (receipt?.payloadJson && typeof receipt.payloadJson === "object") {
      const d = (receipt.payloadJson as { data?: { url?: string } }).data;
      if (typeof d?.url === "string") {
        receiptPageUrl = d.url;
      }
    }

    const s2sConfigs = await prisma.pixelConfig.findMany({
      where: {
        shopId,
        serverSideEnabled: true,
        platform: { in: ["google", "meta", "tiktok"] },
        isActive: true,
      },
      select: { platform: true },
    });
    const destinationsByPlatform: Record<string, "GA4" | "META" | "TIKTOK"> = {
      google: "GA4",
      meta: "META",
      tiktok: "TIKTOK",
    };
    const allS2sDestinations = s2sConfigs
      .map((c) => destinationsByPlatform[c.platform])
      .filter(Boolean) as ("GA4" | "META" | "TIKTOK")[];
    const s2sDestinations: ("GA4" | "META" | "TIKTOK")[] = [];
    for (const dest of allS2sDestinations) {
      // P0-2: TikTok requires IP/UA. If missing, skip.
      if (dest === "TIKTOK" && !rawIp && !rawUserAgent) {
        continue;
      }

      // P0: Meta requires UA + URL for website events.
      if (dest === "META") {
        const hasUA = !!rawUserAgent;
        const hasUrl = !!receiptPageUrl; // parsed.page_url is null
        if (!hasUA || !hasUrl) {
           continue;
        }
      }

      const platform = dest === "GA4" ? "google" : dest === "META" ? "meta" : "tiktok";
      // P0-1: Google (GA4) is dual-use, but treating as marketing forces marketing consent.
      // We should pass false for google, or rely on platform config logic if updated.
      // Here we explicitly set treatAsMarketing = false for google to allow analytics-only consent.
      const treatAsMarketing = platform !== "google"; 
      
      // P0-3: Use evaluatePlatformConsentWithStrategy to support weak/balanced modes
      // This ensures we don't drop orders just because pixel receipt is missing (e.g. adblocker)
      const decision = evaluatePlatformConsentWithStrategy(
        platform, 
        shopRecord.consentStrategy ?? "strict", // fallback to strict if undefined
        consentState, 
        receipt != null, // hasPixelReceipt
        treatAsMarketing
      );
      
      if (decision.allowed) s2sDestinations.push(dest);
    }

    const hasMarketingAllowed = s2sDestinations.some((d) => d === "META" || d === "TIKTOK");
    const userDataHashed: Record<string, string> = {};
    if (hasMarketingAllowed && parsed.email) {
      userDataHashed.em = hashValueSync(parsed.email.toLowerCase().trim());
    }
    if (hasMarketingAllowed && parsed.phone) {
      userDataHashed.ph = hashValueSync(normalizePhoneForHash(parsed.phone));
    }

    const consentPurposes =
      consentState != null
        ? { marketing: consentState.marketing, analytics: consentState.analytics, saleOfDataAllowed: consentState.saleOfDataAllowed }
        : Prisma.JsonNull;

    // Process IP/UA
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
    const user_agent = rawUserAgent ? createHash("sha256").update(rawUserAgent).digest("hex") : null;

    const now = Date.now();
    await prisma.$transaction(async (tx) => {
      const internalEvent = await tx.internalEvent.create({
        data: {
          id: randomUUID(),
          shopId,
          source: "order_webhook",
          event_name: "purchase",
          event_id: parsed.orderId,
          client_id: null,
          timestamp: BigInt(now),
          occurred_at: new Date(now),
          ip: ip,
          ip_encrypted: rawIp ? encrypt(rawIp) : null,
          user_agent: user_agent,
          user_agent_encrypted: rawUserAgent ? encrypt(rawUserAgent) : null,
          page_url: receiptPageUrl,
          referrer: null,
          querystring: null,
          currency: parsed.currency,
          value: parsed.totalPrice,
          transaction_id: parsed.orderId,
          items: parsed.items,
          user_data_hashed: Object.keys(userDataHashed).length > 0 ? userDataHashed : Prisma.JsonNull,
          consent_purposes: consentPurposes,
        },
      });
      for (const destination of s2sDestinations) {
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
      await tx.orderSummary.upsert({
        where: { shopId_orderId: { shopId, orderId: parsed.orderId } },
        create: {
          id: randomUUID(),
          shopId,
          orderId: parsed.orderId,
          totalPrice: parsed.totalPrice,
          currency: parsed.currency,
        },
        update: { totalPrice: parsed.totalPrice, currency: parsed.currency },
      });
    });
    return { success: true, status: 200, message: "OK", orderId: parsed.orderId };
  } catch (error) {
    logger.error("orders/paid handler failed", { shop, orderId: parsed.orderId, error });
    return { success: false, status: 500, message: "Order paid write failed", orderId: parsed.orderId };
  }
}
