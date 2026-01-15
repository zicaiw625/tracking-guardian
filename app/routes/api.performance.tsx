import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { logger } from "../utils/logger.server";
import { optionsResponse, jsonWithCors } from "../utils/cors";
import { API_CONFIG } from "../utils/config";
import { readJsonWithSizeLimit } from "../utils/body-size-guard";

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
