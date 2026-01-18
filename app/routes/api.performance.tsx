import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { timingSafeEqual } from "crypto";
import { logger } from "../utils/logger.server";
import { optionsResponse, jsonWithCors } from "../utils/cors";
import { API_CONFIG } from "../utils/config";
import { readJsonWithSizeLimit } from "../utils/body-size-guard";
import { withRateLimit, ipKeyExtractor } from "../middleware/rate-limit";

const performanceRateLimit = withRateLimit({
  maxRequests: 100,
  windowMs: 60000,
  keyExtractor: ipKeyExtractor,
  message: "Too many performance metric requests",
});

function validatePerformanceAuth(request: Request): boolean {
  const performanceSecret = process.env.PERFORMANCE_SECRET;
  if (!performanceSecret) {
    return false;
  }
  const authHeader = request.headers.get("X-Performance-Token");
  if (!authHeader) {
    return false;
  }
  if (authHeader.length !== performanceSecret.length) {
    return false;
  }
  try {
    const authBuffer = Buffer.from(authHeader);
    const expectedBuffer = Buffer.from(performanceSecret);
    return timingSafeEqual(authBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (process.env.NODE_ENV === "production") {
    if (request.method === "POST") {
      return new Response(null, { status: 204 });
    }
    return jsonWithCors(
      { error: "Not found" },
      { status: 404, request, staticCors: true }
    );
  }
  if (request.method === "OPTIONS") {
    return optionsResponse(request, true);
  }
  if (request.method !== "POST") {
    return jsonWithCors(
      { error: "Method not allowed" },
      { status: 405, request, staticCors: true }
    );
  }
  if (!validatePerformanceAuth(request)) {
    return jsonWithCors(
      { error: "Unauthorized" },
      { status: 401, request, staticCors: true }
    );
  }
  return performanceRateLimit(async () => {
    try {
      const body = await readJsonWithSizeLimit(request);
      if (!body || typeof body !== "object") {
        return jsonWithCors(
          { error: "Invalid request body" },
          { status: 400, request, staticCors: true }
        );
      }
      const metric = body as {
        name?: string;
        value?: number;
        rating?: string;
        url?: string;
      };
      logger.debug("Performance metric received", {
        name: metric.name,
        value: metric.value,
        rating: metric.rating,
        url: metric.url,
      });
      return jsonWithCors(
        { success: true },
        { request, staticCors: true }
      );
    } catch (error) {
      logger.error("Failed to process performance metric", {
        error: error instanceof Error ? error.message : String(error),
      });
      return jsonWithCors(
        { error: "Internal server error" },
        { status: 500, request, staticCors: true }
      );
    }
  })({ request });
};

export const loader = async ({ request }: { request: Request }) => {
  if (process.env.NODE_ENV === "production") {
    return jsonWithCors(
      { error: "Not found" },
      { status: 404, request, staticCors: true }
    );
  }
  if (!validatePerformanceAuth(request)) {
    return jsonWithCors(
      { error: "Unauthorized" },
      { status: 401, request, staticCors: true }
    );
  }
  return jsonWithCors(
    { message: "Performance endpoint - POST to submit performance metrics" },
    { request, staticCors: true }
  );
};
