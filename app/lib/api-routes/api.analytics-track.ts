import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import { trackEvent, type AnalyticsEvent } from "../../services/analytics.server";
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { readJsonWithSizeLimit } from "../../utils/body-size-guard";
import { jsonApi } from "../../utils/security-headers";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  try {
    const body = (await readJsonWithSizeLimit(request)) as { event?: unknown; metadata?: unknown; eventId?: string; timestamp?: string | number } | null;
    const { event, metadata, eventId, timestamp } = body ?? {};
    if (!event) {
      return jsonApi({ error: "Event is required" }, { status: 400 });
    }
        const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true, shopDomain: true },
    });
    if (!shop) {
      return jsonApi({ error: "Shop not found" }, { status: 404 });
    }
    await trackEvent({
      shopId: shop.id,
      shopDomain: shop.shopDomain,
      event: event as AnalyticsEvent,
      metadata: metadata as Record<string, unknown> | undefined,
      eventId: typeof eventId === "string" ? eventId : undefined,
      timestamp: timestamp ? new Date(timestamp) : undefined,
    });
    return jsonApi({ success: true });
  } catch (error) {
    logger.error("Analytics track error", {
      error: error instanceof Error ? error.message : String(error),
      shopDomain,
    });
    return jsonApi(
      { error: error instanceof Error ? error.message : "Failed to track event" },
      { status: 500 }
    );
  }
};
