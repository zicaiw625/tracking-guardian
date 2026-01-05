import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { generateSimpleId } from "../utils/helpers";
import type { WebVitalsMetric } from "../utils/web-vitals.client";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  let shopDomain: string | undefined;
  try {
    const { session } = await authenticate.admin(request);
    shopDomain = session.shop;

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });

    if (!shop) {
      return json({ error: "Shop not found" }, { status: 404 });
    }

    let metric: WebVitalsMetric;
    try {
      metric = (await request.json()) as WebVitalsMetric;
    } catch (parseError) {
      logger.error("Failed to parse performance metric request body", {
        shopDomain,
        error: parseError instanceof Error ? parseError.message : String(parseError),
      });
      return json({ error: "Invalid request body" }, { status: 400 });
    }

    await prisma.performanceMetric.create({
      data: {
        id: generateSimpleId("perf"),
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
    // Handle Response objects (from authenticate.admin redirects, etc.)
    if (error instanceof Response) {
      // Check if it's a valid redirect with Location header
      const location = error.headers.get("Location");
      if (location && (error.status >= 300 && error.status < 400)) {
        // Valid redirect - return it as-is
        return error;
      }
      
      // Invalid redirect or non-redirect Response - log and return error
      logger.error("Failed to store performance metric - received Response object", {
        shopDomain,
        status: error.status,
        statusText: error.statusText,
        url: error.url,
        hasLocation: !!location,
      });
      // If it's an authentication redirect, return appropriate error
      if (error.status === 401 || error.status === 403) {
        return json({ error: "Authentication required" }, { status: 401 });
      }
      return json({ error: "Request failed" }, { status: error.status || 500 });
    }

    // Handle Prisma errors (table not found, etc.)
    if (error && typeof error === "object" && "code" in error) {
      const prismaError = error as { code: string; meta?: { table?: string } };
      if (prismaError.code === "P2022" || prismaError.code === "P2021") {
        logger.warn("PerformanceMetric table not found, migration may be pending", {
          shopDomain,
          code: prismaError.code,
        });
        return json({ error: "Performance metrics table not available" }, { status: 503 });
      }
    }

    // Log error with proper serialization
    let errorForLogging: Error;
    let errorMessage: string;
    
    if (error instanceof Error) {
      errorForLogging = error;
      errorMessage = error.message;
    } else if (error && typeof error === "object") {
      // Try to extract meaningful information from the error object
      const errorObj = error as Record<string, unknown>;
      errorMessage = 
        "message" in errorObj && typeof errorObj.message === "string"
          ? errorObj.message
          : "code" in errorObj && typeof errorObj.code === "string"
          ? `Error code: ${errorObj.code}`
          : JSON.stringify(error);
      errorForLogging = new Error(errorMessage);
    } else {
      errorMessage = String(error);
      errorForLogging = new Error(errorMessage);
    }
    
    const errorType = error && typeof error === "object" && "constructor" in error
      ? (error.constructor as { name?: string })?.name || typeof error
      : typeof error;
    
    logger.error("Failed to store performance metric", errorForLogging, {
      shopDomain,
      errorType,
      errorMessage,
    });
    
    return json({ error: "Internal server error" }, { status: 500 });
  }
};

