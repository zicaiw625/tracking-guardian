import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { logger } from "../../utils/logger.server";
import { withRateLimit, pathShopKeyExtractor, type RateLimitedHandler, checkRateLimitAsync } from "../../middleware/rate-limit";
import prisma from "../../db.server";
import { randomUUID } from "crypto";
import { canUseModule, getUiModuleConfigs } from "../../services/ui-extension.server";
import { authenticatePublic, normalizeDestToShopDomain, handlePublicPreflight, addSecurityHeaders } from "../../utils/public-auth";
import { makeOrderKey, hashValueSync } from "../../utils/crypto.server";
import { readJsonWithSizeLimit } from "../../utils/body-size-guard";
import { containsSensitiveInfo, sanitizeSensitiveInfo } from "../../utils/security";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return handlePublicPreflight(request);
  }
  if (request.method !== "POST") {
    return addSecurityHeaders(json({ error: "Method not allowed" }, { status: 405 }));
  }
  let authResult;
  try {
    authResult = await authenticatePublic(request);
  } catch {
      return addSecurityHeaders(json(
        { error: "Unauthorized: Invalid authentication" },
        { status: 401 }
      ));
  }
    const shopDomain = normalizeDestToShopDomain(authResult.sessionToken.dest);
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });
    if (!shop) {
      logger.warn(`Survey submission for unknown shop: ${shopDomain}`);
      return addSecurityHeaders(authResult.cors(json(
        { error: "Shop not found" },
        { status: 404 }
      )));
    }
    const moduleCheck = await canUseModule(shop.id, "survey");
    if (!moduleCheck.allowed) {
      logger.warn(`Survey module not allowed for shop ${shopDomain}`, {
        reason: moduleCheck.reason,
        currentPlan: moduleCheck.currentPlan,
        requiredPlan: moduleCheck.requiredPlan,
      });
      return addSecurityHeaders(authResult.cors(json(
        { error: "Module not available", reason: moduleCheck.reason },
        { status: 403 }
      )));
    }
    const modules = await getUiModuleConfigs(shop.id);
    const surveyModule = modules.find((m) => m.moduleKey === "survey");
    if (!surveyModule || !surveyModule.isEnabled) {
      logger.warn(`Survey module not enabled for shop ${shopDomain}`);
      return addSecurityHeaders(authResult.cors(json(
        { error: "Survey module is not enabled" },
        { status: 403 }
      )));
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
      return addSecurityHeaders(authResult.cors(json(
        {
          error: "Too many survey requests",
          retryAfter: rateLimitResult.retryAfter,
        },
        { status: 429, headers }
      )));
    }
  try {
    const body = await readJsonWithSizeLimit(request);
      if (!body || typeof body !== "object") {
        return addSecurityHeaders(authResult.cors(json(
          { error: "Invalid request body" },
          { status: 400 }
        )));
      }
      const { option, timestamp, orderId, checkoutToken } = body as { 
        option?: string; 
        timestamp?: string; 
        orderId?: string | null;
        checkoutToken?: string | null;
      };
      if (!option) {
        return addSecurityHeaders(authResult.cors(json(
          { error: "Missing survey option" },
          { status: 400 }
        )));
      }
      const trimmed = option.trim();
      if (trimmed.length === 0 || trimmed.length > 200) {
        return addSecurityHeaders(authResult.cors(json(
          { error: "Invalid option length" },
          { status: 400 }
        )));
      }
      if (containsSensitiveInfo(trimmed)) {
        return addSecurityHeaders(authResult.cors(json(
          { error: "Option contains sensitive info" },
          { status: 400 }
        )));
      }
      const safeOption = sanitizeSensitiveInfo(trimmed);
      const orderKey = makeOrderKey({ orderId, checkoutToken });
      if (!orderKey) {
        return addSecurityHeaders(authResult.cors(json(
          { error: "Order context required (orderId or checkoutToken). Unavailable when PCD is not approved." },
          { status: 400 }
        )));
      }
      if (orderId) {
        const orderIdHash = hashValueSync(orderId).slice(0, 12);
        logger.info("Survey response with orderId", { shopDomain, orderIdHash });
      } else if (checkoutToken) {
        const checkoutTokenHash = hashValueSync(checkoutToken).slice(0, 12);
        logger.info("Survey response with checkoutToken", { shopDomain, checkoutTokenHash });
      }
      const finalOrderId = orderKey;
      if (timestamp !== undefined && timestamp !== null && typeof timestamp !== "string") {
        return addSecurityHeaders(authResult.cors(json(
          { error: "Invalid timestamp" },
          { status: 400 }
        )));
      }
      if (timestamp != null && timestamp !== "" && Number.isNaN(new Date(timestamp).getTime())) {
        return addSecurityHeaders(authResult.cors(json(
          { error: "Invalid timestamp" },
          { status: 400 }
        )));
      }
      await prisma.surveyResponse.create({
        data: {
          id: randomUUID(),
          shopId: shop.id,
          orderId: finalOrderId,
          feedback: safeOption,
          source: "thank_you_block",
          createdAt: new Date(),
        },
      });
    logger.info("Survey response received", { shopDomain });
    return addSecurityHeaders(authResult.cors(json(
      { success: true, message: "Survey response recorded" }
    )));
  } catch (error) {
    logger.error("Failed to process survey submission", {
      error: error instanceof Error ? error.message : String(error),
    });
    if (authResult) {
      return addSecurityHeaders(authResult.cors(json(
        { error: "Internal server error" },
        { status: 500 }
      )));
    }
    return addSecurityHeaders(json(
      { error: "Internal server error" },
      { status: 500 }
    ));
  }
};

const surveyRateLimit = withRateLimit<Response>({
  maxRequests: 100,
  windowMs: 60 * 1000,
  keyExtractor: pathShopKeyExtractor,
  message: "Too many survey requests",
}) as (handler: RateLimitedHandler<Response>) => RateLimitedHandler<Response | Response>;

const rateLimitedLoader = surveyRateLimit(async (_args: LoaderFunctionArgs): Promise<Response> => {
  return json(
    { message: "Survey endpoint - POST to submit survey response" }
  );
});

export const loader = async (args: LoaderFunctionArgs): Promise<Response> => {
  const response = await rateLimitedLoader(args);
  return addSecurityHeaders(response);
};
