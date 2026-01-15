import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { logger } from "../../utils/logger.server";
import { withRateLimit, pathShopKeyExtractor, type RateLimitedHandler, checkRateLimitAsync } from "../../middleware/rate-limit";
import prisma from "../../db.server";
import { randomUUID } from "crypto";
import { canUseModule, getUiModuleConfigs } from "../../services/ui-extension.server";
import { authenticatePublic, normalizeDestToShopDomain, getPublicCorsForOptions } from "../../utils/public-auth";
import { hashValueSync } from "../../utils/crypto.server";
import { API_CONFIG } from "../../utils/config";
import { readJsonWithSizeLimit } from "../../utils/body-size-guard";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    const cors = await getPublicCorsForOptions(request);
    return cors(new Response(null, { status: 204 }));
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }
  let authResult;
  try {
    authResult = await authenticatePublic(request);
  } catch (authError) {
    return json(
      { error: "Unauthorized: Invalid authentication" },
      { status: 401 }
    );
  }
    const shopDomain = normalizeDestToShopDomain(authResult.sessionToken.dest);
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });
    if (!shop) {
      logger.warn(`Survey submission for unknown shop: ${shopDomain}`);
      return authResult.cors(json(
        { error: "Shop not found" },
        { status: 404 }
      ));
    }
    const moduleCheck = await canUseModule(shop.id, "survey");
    if (!moduleCheck.allowed) {
      logger.warn(`Survey module not allowed for shop ${shopDomain}`, {
        reason: moduleCheck.reason,
        currentPlan: moduleCheck.currentPlan,
        requiredPlan: moduleCheck.requiredPlan,
      });
      return authResult.cors(json(
        { error: "Module not available", reason: moduleCheck.reason },
        { status: 403 }
      ));
    }
    const modules = await getUiModuleConfigs(shop.id);
    const surveyModule = modules.find((m) => m.moduleKey === "survey");
    if (!surveyModule || !surveyModule.isEnabled) {
      logger.warn(`Survey module not enabled for shop ${shopDomain}`);
      return authResult.cors(json(
        { error: "Survey module is not enabled" },
        { status: 403 }
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
      return authResult.cors(json(
        {
          error: "Too many survey requests",
          retryAfter: rateLimitResult.retryAfter,
        },
        { status: 429, headers }
      ));
    }
  try {
    const body = await readJsonWithSizeLimit(request);
      if (!body || typeof body !== "object") {
        return authResult.cors(json(
          { error: "Invalid request body" },
          { status: 400 }
        ));
      }
      const { option, timestamp, orderId, checkoutToken } = body as { 
        option?: string; 
        timestamp?: string; 
        orderId?: string | null;
        checkoutToken?: string | null;
      };
      if (!option) {
        return authResult.cors(json(
          { error: "Missing survey option" },
          { status: 400 }
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
    return authResult.cors(json(
      { success: true, message: "Survey response recorded" }
    ));
  } catch (error) {
    logger.error("Failed to process survey submission", {
      error: error instanceof Error ? error.message : String(error),
    });
    if (authResult) {
      return authResult.cors(json(
        { error: "Internal server error" },
        { status: 500 }
      ));
    }
    return json(
      { error: "Internal server error" },
      { status: 500 }
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
  return json(
    { message: "Survey endpoint - POST to submit survey response" }
  );
});

export const loader = rateLimitedLoader;
