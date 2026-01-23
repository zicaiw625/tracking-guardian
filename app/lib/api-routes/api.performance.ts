import type { ActionFunctionArgs } from "@remix-run/node";
import { timingSafeEqual } from "crypto";
import { logger } from "../../utils/logger.server";
import { optionsResponse, jsonWithCors } from "../../utils/cors";
import { readJsonWithSizeLimit } from "../../utils/body-size-guard";
import { withRateLimit, ipKeyExtractor, type RateLimitedHandler } from "../../middleware/rate-limit";

const performanceRateLimit = withRateLimit({
  maxRequests: 100,
  windowMs: 60000,
  keyExtractor: ipKeyExtractor,
  message: "Too many performance metric requests",
}) as (handler: RateLimitedHandler<Response>) => RateLimitedHandler<Response>;

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

export const action = async (args: ActionFunctionArgs) => {
  const { request } = args;
  if (process.env.NODE_ENV === "production") {
    if (request.method === "POST") {
      return new Response(null, { status: 204 });
    }
    return jsonWithCors(
      { error: "Not found" },
      { status: 404, request }
    );
  }
  if (request.method === "OPTIONS") {
    return optionsResponse(request);
  }
  if (request.method !== "POST") {
    return jsonWithCors(
      { error: "Method not allowed" },
      { status: 405, request }
    );
  }
  if (!validatePerformanceAuth(request)) {
    return jsonWithCors(
      { error: "Unauthorized" },
      { status: 401, request }
    );
  }
  const handler = performanceRateLimit(async (a: ActionFunctionArgs) => {
    const req = a.request;
    try {
      const body = await readJsonWithSizeLimit(req);
      if (!body || typeof body !== "object") {
        return jsonWithCors(
          { error: "Invalid request body" },
          { status: 400, request: req }
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
        { request: req }
      );
    } catch (error) {
      if (error instanceof Response) {
        return jsonWithCors(
          { error: error.status === 413 ? "Payload too large" : "Invalid request body" },
          { status: error.status, request: req }
        );
      }
      logger.error("Failed to process performance metric", {
        error: error instanceof Error ? error.message : String(error),
      });
      return jsonWithCors(
        { error: "Internal server error" },
        { status: 500, request: req }
      );
    }
  });
  return handler(args);
};

export const loader = async ({ request }: { request: Request }) => {
  if (process.env.NODE_ENV === "production") {
    return jsonWithCors(
      { error: "Not found" },
      { status: 404, request }
    );
  }
  if (!validatePerformanceAuth(request)) {
    return jsonWithCors(
      { error: "Unauthorized" },
      { status: 401, request }
    );
  }
  return jsonWithCors(
    { message: "Performance endpoint - POST to submit performance metrics" },
    { request }
  );
};
