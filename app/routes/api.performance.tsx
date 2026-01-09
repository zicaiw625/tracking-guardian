import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { logger } from "../utils/logger.server";
import { optionsResponse, jsonWithCors } from "../utils/cors";

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
    const body = await request.json().catch(() => null);

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

    // 记录性能指标（仅在开发环境或需要时记录详细信息）
    if (process.env.NODE_ENV === "development") {
      logger.debug("Performance metric received", {
        name: metric.name,
        value: metric.value,
        rating: metric.rating,
        url: metric.url,
      });
    }

    // 在生产环境中，可以选择性地记录性能指标
    // 这里只返回成功响应，不存储数据以节省资源

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
