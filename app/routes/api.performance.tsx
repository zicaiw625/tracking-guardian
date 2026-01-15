import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { logger } from "../utils/logger.server";
import { optionsResponse, jsonWithCors } from "../utils/cors";
import { API_CONFIG } from "../utils/config";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return optionsResponse(request, true);
  }
  if (request.method !== "POST") {
    return jsonWithCors(
      { error: "Method not allowed" },
      { status: 405, request, staticCors: true }
    );
  }
  try {
    const contentLength = request.headers.get("Content-Length");
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (!isNaN(size) && size > API_CONFIG.MAX_BODY_SIZE) {
        logger.warn(`Performance metric request body too large: ${size} bytes (max ${API_CONFIG.MAX_BODY_SIZE})`);
        return jsonWithCors(
          { error: "Payload too large", maxSize: API_CONFIG.MAX_BODY_SIZE },
          { status: 413, request, staticCors: true }
        );
      }
    }
    const bodyText = await request.text();
    if (bodyText.length > API_CONFIG.MAX_BODY_SIZE) {
      logger.warn(`Performance metric request body too large: ${bodyText.length} bytes (max ${API_CONFIG.MAX_BODY_SIZE})`);
      return jsonWithCors(
        { error: "Payload too large", maxSize: API_CONFIG.MAX_BODY_SIZE },
        { status: 413, request, staticCors: true }
      );
    }
    const body = JSON.parse(bodyText);
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
    if (process.env.NODE_ENV === "development") {
      logger.debug("Performance metric received", {
        name: metric.name,
        value: metric.value,
        rating: metric.rating,
        url: metric.url,
      });
    }
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
};

export const loader = async ({ request }: { request: Request }) => {
  return jsonWithCors(
    { message: "Performance endpoint - POST to submit performance metrics" },
    { request, staticCors: true }
  );
};
