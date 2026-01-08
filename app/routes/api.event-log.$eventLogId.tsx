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
    const eventLog = await prisma.eventLog.findFirst({
      where: {
        id: eventLogId,
        shopId: shop.id,
      },
      include: {
        DeliveryAttempt: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!eventLog) {
      return json({ error: "Event log not found" }, { status: 404 });
    }

    return json({
      id: eventLog.id,
      eventId: eventLog.eventId,
      eventName: eventLog.eventName,
      source: eventLog.source,
      occurredAt: eventLog.occurredAt.toISOString(),
      createdAt: eventLog.createdAt.toISOString(),
      shopifyContextJson: eventLog.shopifyContextJson,
      normalizedEventJson: eventLog.normalizedEventJson,
      deliveryAttempts: eventLog.DeliveryAttempt.map(attempt => ({
        id: attempt.id,
        destinationType: attempt.destinationType,
        environment: attempt.environment,
        status: attempt.status,
        requestPayloadJson: attempt.requestPayloadJson,
        errorCode: attempt.errorCode,
        errorDetail: attempt.errorDetail,
        responseStatus: attempt.responseStatus,
        responseBodySnippet: attempt.responseBodySnippet,
        latencyMs: attempt.latencyMs,
        createdAt: attempt.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    logger.error("Failed to get event log details", {
      shopId: shop.id,
      eventLogId,
      error: error instanceof Error ? error.message : String(error),
    });
    return json({ error: "Failed to fetch event log details" }, { status: 500 });
  }
};
