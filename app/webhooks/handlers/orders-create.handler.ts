import { randomUUID } from "crypto";
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
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

function parseOrderPayload(payload: unknown): { orderId: string; totalPrice: number; currency: string } | null {
  if (payload == null || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  const id = obj.id;
  const totalPriceRaw = obj.total_price;
  const currencyRaw = obj.currency;
  if (id == null || totalPriceRaw == null || currencyRaw == null) return null;
  const orderId = normalizeOrderId(id);
  const totalPrice = typeof totalPriceRaw === "string" ? parseFloat(totalPriceRaw) : Number(totalPriceRaw);
  const currency = String(currencyRaw).trim();
  if (orderId === "" || !Number.isFinite(totalPrice) || currency.length !== 3) return null;
  return { orderId, totalPrice, currency };
}

export async function handleOrdersCreate(
  context: WebhookContext,
  shopRecord: ShopWithPixelConfigs | null
): Promise<WebhookHandlerResult> {
  const { shop, payload } = context;
  if (!shopRecord) {
    logger.info(`orders/create received for unknown shop ${shop}, acknowledging`);
    return { success: true, status: 200, message: "OK" };
  }
  if (!ORDER_WEBHOOK_ENABLED) {
    return { success: true, status: 200, message: "OK" };
  }
  const parsed = parseOrderPayload(payload);
  if (!parsed) {
    logger.warn(`orders/create invalid payload for ${shop}`);
    return { success: true, status: 200, message: "OK" };
  }
  try {
    await prisma.orderSummary.upsert({
      where: {
        shopId_orderId: { shopId: shopRecord.id, orderId: parsed.orderId },
      },
      create: {
        id: randomUUID(),
        shopId: shopRecord.id,
        orderId: parsed.orderId,
        totalPrice: parsed.totalPrice,
        currency: parsed.currency,
      },
      update: {
        totalPrice: parsed.totalPrice,
        currency: parsed.currency,
      },
    });
    return { success: true, status: 200, message: "OK", orderId: parsed.orderId };
  } catch (error) {
    logger.error("orders/create handler failed", { shop, orderId: parsed.orderId, error });
    return { success: false, status: 500, message: "Order summary write failed", orderId: parsed.orderId };
  }
}
