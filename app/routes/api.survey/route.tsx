import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import { logger } from "../../utils/logger.server";
import { optionsResponse, jsonWithCors } from "../../utils/cors";
import { withRateLimit, pathShopKeyExtractor, type RateLimitedHandler, checkRateLimitAsync } from "../../middleware/rate-limit";
import prisma from "../../db.server";
import { randomUUID } from "crypto";
import { canUseModule, getUiModuleConfigs } from "../../services/ui-extension.server";

async function authenticatePublicExtension(request: Request): Promise<{ shop: string; [key: string]: unknown }> {
  try {
    const authResult = await authenticate.public.checkout(request) as unknown as { 
      session: { shop: string; [key: string]: unknown } 
    };
    return authResult.session;
  } catch (checkoutError) {
    try {
      const authResult = await authenticate.public.customerAccount(request) as unknown as { 
        session: { shop: string; [key: string]: unknown } 
      };
      return authResult.session;
    } catch (customerAccountError) {
      logger.warn("Public extension authentication failed", {
        checkoutError: checkoutError instanceof Error ? checkoutError.message : String(checkoutError),
        customerAccountError: customerAccountError instanceof Error ? customerAccountError.message : String(customerAccountError),
      });
      throw checkoutError;
    }
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return optionsResponse(request, true);
  }
  if (request.method !== "POST") {
    return jsonWithCors({ error: "Method not allowed" }, { status: 405, request, staticCors: true });
  }
  let session: { shop: string; [key: string]: unknown };
  try {
    session = await authenticatePublicExtension(request);
  } catch (authError) {
    return jsonWithCors(
      { error: "Unauthorized: Invalid authentication" },
      { status: 401, request, staticCors: true }
    );
  }
    const shopDomain = session.shop;
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
    const moduleCheck = await canUseModule(shop.id, "survey");
    if (!moduleCheck.allowed) {
      logger.warn(`Survey module not allowed for shop ${shopDomain}`, {
        reason: moduleCheck.reason,
        currentPlan: moduleCheck.currentPlan,
        requiredPlan: moduleCheck.requiredPlan,
      });
      return jsonWithCors(
        { error: "Module not available", reason: moduleCheck.reason },
        { status: 403, request, staticCors: true }
      );
    }
    const modules = await getUiModuleConfigs(shop.id);
    const surveyModule = modules.find((m) => m.moduleKey === "survey");
    if (!surveyModule || !surveyModule.isEnabled) {
      logger.warn(`Survey module not enabled for shop ${shopDomain}`);
      return jsonWithCors(
        { error: "Survey module is not enabled" },
        { status: 403, request, staticCors: true }
      );
    }
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
    const orderId = `survey_${shop.id}_${Date.now()}`;
    await prisma.surveyResponse.create({
      data: {
        id: randomUUID(),
        shopId: shop.id,
        orderId: orderId,
        feedback: option,
        source: "thank_you_block",
        createdAt: timestamp ? new Date(timestamp) : new Date(),
      },
    });
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
