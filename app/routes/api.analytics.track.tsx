import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { trackEvent } from "../services/analytics.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  try {
    const body = await request.json();
    const { event, metadata, eventId, timestamp } = body;

    if (!event) {
      return json({ error: "Event is required" }, { status: 400 });
    }

        const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true, shopDomain: true },
    });

    if (!shop) {
      return json({ error: "Shop not found" }, { status: 404 });
    }

    await trackEvent({
      shopId: shop.id,
      shopDomain: shop.shopDomain,
      event,
      metadata,
      eventId,
      timestamp: timestamp ? new Date(timestamp) : undefined,
    });

    return json({ success: true });
  } catch (error) {
    console.error("Analytics track error:", error);
    return json(
      { error: error instanceof Error ? error.message : "Failed to track event" },
      { status: 500 }
    );
  }
};

