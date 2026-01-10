import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }
  const eventLogId = params.eventLogId;
  if (!eventLogId) {
    return json({ error: "Event log ID is required" }, { status: 400 });
  }
  try {
    const receipt = await prisma.pixelEventReceipt.findFirst({
      where: {
        id: eventLogId,
        shopId: shop.id,
      },
      select: {
        id: true,
        eventType: true,
        orderKey: true,
        platform: true,
        pixelTimestamp: true,
        createdAt: true,
        payloadJson: true,
      },
    });
    if (!receipt) {
      return json({ error: "Event receipt not found" }, { status: 404 });
    }
    const payload = receipt.payloadJson as Record<string, unknown> | null;
    return json({
      id: receipt.id,
      eventId: receipt.id,
      eventName: receipt.eventType,
      source: "web_pixel",
      occurredAt: receipt.pixelTimestamp.toISOString(),
      createdAt: receipt.createdAt.toISOString(),
      shopifyContextJson: null,
      normalizedEventJson: payload,
      deliveryAttempts: [],
    });
  } catch (error) {
    logger.error("Failed to get event receipt details", {
      shopId: shop.id,
      eventLogId,
      error: error instanceof Error ? error.message : String(error),
    });
    return json({ error: "Failed to fetch event receipt details" }, { status: 500 });
  }
};
