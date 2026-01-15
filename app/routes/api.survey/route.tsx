import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { logger } from "../../utils/logger.server";
import { optionsResponse, jsonWithCors } from "../../utils/cors";
import { withRateLimit, pathShopKeyExtractor, type RateLimitedHandler, checkRateLimitAsync } from "../../middleware/rate-limit";
import prisma from "../../db.server";
import { randomUUID } from "crypto";
import { canUseModule, getUiModuleConfigs } from "../../services/ui-extension.server";
import { authenticatePublic, normalizeDestToShopDomain } from "../../utils/public-auth";
import { hashValueSync } from "../../utils/crypto.server";
import { API_CONFIG } from "../../utils/config";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return optionsResponse(request, true);
  }
  if (request.method !== "POST") {
    return jsonWithCors({ error: "Method not allowed" }, { status: 405, request, staticCors: true });
  }
  let authResult;
  try {
    authResult = await authenticatePublic(request);
  } catch (authError) {
    return jsonWithCors(
      { error: "Unauthorized: Invalid authentication" },
      { status: 401, request, staticCors: true }
    );
  }
    const shopDomain = normalizeDestToShopDomain(authResult.sessionToken.dest);
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });
    if (!shop) {
      logger.warn(`Survey submission for unknown shop: ${shopDomain}`);
      return authResult.cors(jsonWithCors(
        { error: "Shop not found" },
        { status: 404, request, staticCors: true }
      ));
    }
    const moduleCheck = await canUseModule(shop.id, "survey");
    if (!moduleCheck.allowed) {
      logger.warn(`Survey module not allowed for shop ${shopDomain}`, {
        reason: moduleCheck.reason,
        currentPlan: moduleCheck.currentPlan,
        requiredPlan: moduleCheck.requiredPlan,
      });
      return authResult.cors(jsonWithCors(
        { error: "Module not available", reason: moduleCheck.reason },
        { status: 403, request, staticCors: true }
      ));
    }
    const modules = await getUiModuleConfigs(shop.id);
    const surveyModule = modules.find((m) => m.moduleKey === "survey");
    if (!surveyModule || !surveyModule.isEnabled) {
      logger.warn(`Survey module not enabled for shop ${shopDomain}`);
      return authResult.cors(jsonWithCors(
        { error: "Survey module is not enabled" },
        { status: 403, request, staticCors: true }
      ));
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
      return authResult.cors(jsonWithCors(
        {
          error: "Too many survey requests",
          retryAfter: rateLimitResult.retryAfter,
        },
        { status: 429, request, staticCors: true, headers }
      ));
    }
  try {
    const contentLength = request.headers.get("Content-Length");
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (!isNaN(size) && size > API_CONFIG.MAX_BODY_SIZE) {
        logger.warn(`Survey request body too large: ${size} bytes (max ${API_CONFIG.MAX_BODY_SIZE})`);
        return authResult.cors(jsonWithCors(
          { error: "Payload too large", maxSize: API_CONFIG.MAX_BODY_SIZE },
          { status: 413, request, staticCors: true }
        ));
      }
    }
    const bodyText = await request.text();
    if (bodyText.length > API_CONFIG.MAX_BODY_SIZE) {
      logger.warn(`Survey request body too large: ${bodyText.length} bytes (max ${API_CONFIG.MAX_BODY_SIZE})`);
      return authResult.cors(jsonWithCors(
        { error: "Payload too large", maxSize: API_CONFIG.MAX_BODY_SIZE },
        { status: 413, request, staticCors: true }
      ));
    }
      const body = JSON.parse(bodyText);
      if (!body || typeof body !== "object") {
        return authResult.cors(jsonWithCors(
          { error: "Invalid request body" },
          { status: 400, request, staticCors: true }
        ));
      }
      const { option, timestamp, orderId, checkoutToken } = body as { 
        option?: string; 
        timestamp?: string; 
        orderId?: string | null;
        checkoutToken?: string | null;
      };
      if (!option) {
        return authResult.cors(jsonWithCors(
          { error: "Missing survey option" },
          { status: 400, request, staticCors: true }
        ));
      }
      let finalOrderId: string;
      if (orderId) {
        finalOrderId = orderId;
        logger.info("Survey response with orderId", { shopDomain, orderId });
      } else if (checkoutToken) {
        const checkoutTokenHash = hashValueSync(checkoutToken);
        finalOrderId = `checkout_${checkoutTokenHash}`;
        logger.info("Survey response with checkoutToken (hashed)", { shopDomain, checkoutTokenHash: checkoutTokenHash.substring(0, 8) });
      } else {
        finalOrderId = `survey_${shop.id}_${Date.now()}`;
        logger.warn("Survey response without orderId or checkoutToken, using fallback", { shopDomain });
      }
      await prisma.surveyResponse.create({
        data: {
          id: randomUUID(),
          shopId: shop.id,
          orderId: finalOrderId,
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
    return authResult.cors(jsonWithCors(
      { success: true, message: "Survey response recorded" },
      { request, staticCors: true }
    ));
  } catch (error) {
    logger.error("Failed to process survey submission", {
      error: error instanceof Error ? error.message : String(error),
    });
    if (authResult) {
      return authResult.cors(jsonWithCors(
        { error: "Internal server error" },
        { status: 500, request, staticCors: true }
      ));
    }
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
