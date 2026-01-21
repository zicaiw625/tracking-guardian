import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { jsonApi } from "../../utils/security-headers";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  if (!shop) {
    return jsonApi({ error: "Shop not found" }, { status: 404 });
  }
  const eventLogId = params.eventLogId;
  if (!eventLogId) {
    return jsonApi({ error: "Event log ID is required" }, { status: 400 });
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
        pixelTimestamp: true,
        createdAt: true,
        payloadJson: true,
      },
    });
    if (!receipt) {
      return jsonApi({ error: "Event receipt not found" }, { status: 404 });
    }
    const payload = receipt.payloadJson as Record<string, unknown> | null;
    return jsonApi({
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
    return jsonApi({ error: "Failed to fetch event receipt details" }, { status: 500 });
  }
};
