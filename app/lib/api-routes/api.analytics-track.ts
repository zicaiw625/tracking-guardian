import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import { trackEvent } from "../../services/analytics.server";
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { readJsonWithSizeLimit } from "../../utils/body-size-guard";
import { jsonApi } from "../../utils/security-headers";
import { AnalyticsTrackBodySchema } from "../../schemas/analytics";

function parseTimestamp(value: string | number | undefined): Date | undefined {
  if (value === undefined || value === null) return undefined;
  const d = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  try {
    const raw = await readJsonWithSizeLimit(request);
    const parsed = AnalyticsTrackBodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return jsonApi(
        { error: "Invalid event or metadata", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { event, metadata, eventId, timestamp } = parsed.data;
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true, shopDomain: true },
    });
    if (!shop) {
      return jsonApi({ error: "Shop not found" }, { status: 404 });
    }
    const ts = parseTimestamp(timestamp);
    await trackEvent({
      shopId: shop.id,
      shopDomain: shop.shopDomain,
      event,
      metadata,
      eventId,
      timestamp: ts,
    });
    return jsonApi({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
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
