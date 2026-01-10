import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import { logger } from "../../utils/logger.server";
import { optionsResponse, jsonWithCors } from "../../utils/cors";
import { withRateLimit, pathShopKeyExtractor, type RateLimitedHandler, checkRateLimitAsync } from "../../middleware/rate-limit";
import prisma from "../../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return optionsResponse(request, true);
  }
  if (request.method !== "POST") {
    return jsonWithCors({ error: "Method not allowed" }, { status: 405, request, staticCors: true });
  }
  let session: { shop: string; [key: string]: unknown };
  try {
    const authResult = await authenticate.public.checkout(request) as unknown as { 
      session: { shop: string; [key: string]: unknown } 
    };
    session = authResult.session;
  } catch (authError) {
    logger.warn("Survey submission authentication failed", {
      error: authError instanceof Error ? authError.message : String(authError),
    });
    return jsonWithCors(
      { error: "Unauthorized: Invalid authentication" },
      { status: 401, request, staticCors: true }
    );
  }
  const shopDomain = session.shop;
  const rateLimitKey = `survey:${shopDomain}`;
  const rateLimitResult = await checkRateLimitAsync(rateLimitKey, 100, 60 * 1000);
  if (!rateLimitResult.allowed) {
    const headers = new Headers();
    headers.set("X-RateLimit-Limit", "100");
    headers.set("X-RateLimit-Remaining", "0");
    headers.set("X-RateLimit-Reset", String(Math.ceil(rateLimitResult.resetAt / 1000)));
    if (rateLimitResult.retryAfter) {
      headers.set("Retry-After", String(rateLimitResult.retryAfter));
    }
    logger.warn("Survey rate limit exceeded", {
      shopDomain,
      retryAfter: rateLimitResult.retryAfter,
    });
    return jsonWithCors(
      {
        error: "Too many survey requests",
        retryAfter: rateLimitResult.retryAfter,
      },
      { status: 429, request, staticCors: true, headers }
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
    const { option, timestamp } = body as { option?: string; timestamp?: string };
    if (!option) {
      return jsonWithCors(
        { error: "Missing survey option" },
        { status: 400, request, staticCors: true }
      );
    }
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });
    if (!shop) {
      logger.warn(`Survey submission for unknown shop: ${shopDomain}`);
      return jsonWithCors(
        { error: "Shop not found" },
        { status: 404, request, staticCors: true }
      );
    }
    logger.info("Survey response received", {
      shopDomain,
      option,
      timestamp,
    });
    return jsonWithCors(
      { success: true, message: "Survey response recorded" },
      { request, staticCors: true }
    );
  } catch (error) {
    logger.error("Failed to process survey submission", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonWithCors(
      { error: "Internal server error" },
      { status: 500, request, staticCors: true }
    );
  }
};

const surveyRateLimit = withRateLimit<Response>({
  maxRequests: 100,
  windowMs: 60 * 1000,
  keyExtractor: pathShopKeyExtractor,
  message: "Too many survey requests",
}) as (handler: RateLimitedHandler<Response>) => RateLimitedHandler<Response | Response>;

const rateLimitedLoader = surveyRateLimit(async (args: LoaderFunctionArgs): Promise<Response> => {
  return jsonWithCors(
    { message: "Survey endpoint - POST to submit survey response" },
    { request: args.request, staticCors: true }
  );
});

export const loader = rateLimitedLoader;
