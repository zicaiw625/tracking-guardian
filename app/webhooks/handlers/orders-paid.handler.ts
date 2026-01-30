import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { hashValueSync } from "../../utils/crypto.server";
import { ORDER_WEBHOOK_ENABLED } from "../../utils/config.server";
import type { WebhookContext, WebhookHandlerResult, ShopWithPixelConfigs } from "../types";

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
}

function parseOrdersPaidPayload(payload: unknown): {
  orderId: string;
  totalPrice: number;
  currency: string;
  items: Array<{ id: string; name: string; price: number; quantity: number }>;
  email: string | null;
  phone: string | null;
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
  return { orderId, totalPrice, currency, items, email, phone };
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
    const s2sDestinations = s2sConfigs
      .map((c) => destinationsByPlatform[c.platform])
      .filter(Boolean) as ("GA4" | "META" | "TIKTOK")[];

    const userDataHashed: Record<string, string> = {};
    if (parsed.email) {
      userDataHashed.em = hashValueSync(parsed.email.toLowerCase().trim());
    }
    if (parsed.phone) {
      userDataHashed.ph = hashValueSync(normalizePhoneForHash(parsed.phone));
    }

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
          ip: null,
          user_agent: null,
          page_url: null,
          referrer: null,
          querystring: null,
          currency: parsed.currency,
          value: parsed.totalPrice,
          transaction_id: parsed.orderId,
          items: parsed.items,
          user_data_hashed: Object.keys(userDataHashed).length > 0 ? userDataHashed : Prisma.JsonNull,
          consent_purposes: Prisma.JsonNull,
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
