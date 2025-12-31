import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import type { WebVitalsMetric } from "../utils/web-vitals.client";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });

    if (!shop) {
      return json({ error: "Shop not found" }, { status: 404 });
    }

    const metric = (await request.json()) as WebVitalsMetric;

    await prisma.performanceMetric.create({
      data: {
        shopId: shop.id,
        metricName: metric.name,
        metricValue: metric.value,
        metricId: metric.id,
        delta: metric.delta,
        rating: metric.rating,
        navigationType: metric.navigationType,
        url: metric.url,
        timestamp: new Date(metric.timestamp),
      },
    });

    return json({ success: true });
  } catch (error) {
    // Handle Prisma errors gracefully
    if (error && typeof error === "object" && "code" in error) {
      const prismaError = error as { code: string; meta?: { table?: string } };
      if (prismaError.code === "P2022" || prismaError.code === "P2021") {
        // Table doesn't exist - migration may not have run yet
        logger.warn("PerformanceMetric table not found, migration may be pending", {
          shopDomain,
          code: prismaError.code,
        });
        return json({ error: "Performance metrics table not available" }, { status: 503 });
      }
    }
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Failed to store performance metric", { error: errorMessage, shopDomain });
    return json({ error: "Internal server error" }, { status: 500 });
  }
};

