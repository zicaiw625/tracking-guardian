import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { logger } from "../../utils/logger.server";
import { withRateLimit, pathShopKeyExtractor, type RateLimitedHandler, checkRateLimitAsync } from "../../middleware/rate-limit.server";
import prisma from "../../db.server";
import { randomUUID } from "crypto";
import { canUseModule, getUiModuleConfigs } from "../../services/ui-extension.server";
import { tryAuthenticatePublicWithShop, handlePublicPreflight, addSecurityHeaders } from "../../utils/public-auth";
import { makeOrderKey, hashValueSync } from "../../utils/crypto.server";
import { readJsonWithSizeLimit } from "../../utils/body-size-guard";
import { containsSensitiveInfo, sanitizeSensitiveInfo } from "../../utils/security";
import { getDynamicCorsHeaders } from "../../utils/cors";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return handlePublicPreflight(request);
  }
  const wrap = (r: Response) => {
    const c = getDynamicCorsHeaders(request, ["Authorization"]);
    const h = new Headers(r.headers);
    Object.entries(c).forEach(([k, v]) => { if (v) h.set(k, v); });
    return addSecurityHeaders(new Response(r.body, { status: r.status, statusText: r.statusText, headers: h }));
  };
  if (request.method !== "POST") {
    return wrap(json({ error: "Method not allowed" }, { status: 405 }));
  }
  const ct = request.headers.get("Content-Type") || "";
  if (!/^application\/json($|;)/.test(ct)) {
    return wrap(json({ error: "Content-Type must be application/json" }, { status: 415 }));
  }
  const auth = await tryAuthenticatePublicWithShop(request);
  if (!auth) {
    return wrap(json({ error: "Unauthorized: Invalid authentication" }, { status: 401 }));
  }
  const { authResult, shopDomain } = auth;
  const postWrap = (r: Response) => {
    const c = getDynamicCorsHeaders(request, ["Authorization"]);
    const h = new Headers(r.headers);
    Object.entries(c).forEach(([k, v]) => { if (v) h.set(k, v); });
    return addSecurityHeaders(new Response(r.body, { status: r.status, statusText: r.statusText, headers: h }));
  };
  const wrapCors = (r: Response) => postWrap(authResult.cors(r));
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, isActive: true },
  });
  if (!shop) {
    logger.warn(`Survey submission for unknown shop: ${shopDomain}`);
    return wrapCors(json({ error: "Shop not found" }, { status: 404 }));
  }
  if (shop.isActive === false) {
    return wrapCors(json({ error: "Shop is not active" }, { status: 403 }));
  }
  const moduleCheck = await canUseModule(shop.id, "survey");
  if (!moduleCheck.allowed) {
    logger.warn(`Survey module not allowed for shop ${shopDomain}`, {
      reason: moduleCheck.reason,
      currentPlan: moduleCheck.currentPlan,
      requiredPlan: moduleCheck.requiredPlan,
    });
    return wrapCors(json({ error: "Module not available", reason: moduleCheck.reason }, { status: 403 }));
  }
  const modules = await getUiModuleConfigs(shop.id);
  const surveyModule = modules.find((m) => m.moduleKey === "survey");
  if (!surveyModule || !surveyModule.isEnabled) {
    logger.warn(`Survey module not enabled for shop ${shopDomain}`);
    return wrapCors(json({ error: "Survey module is not enabled" }, { status: 403 }));
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
    return wrapCors(json(
      { error: "Too many survey requests", retryAfter: rateLimitResult.retryAfter },
      { status: 429, headers }
    ));
  }
  try {
    const body = await readJsonWithSizeLimit(request);
    if (!body || typeof body !== "object") {
      return wrapCors(json({ error: "Invalid request body" }, { status: 400 }));
    }
    const raw = body as { option?: string; rating?: number | string; timestamp?: string; orderId?: string | null; checkoutToken?: string | null };
    const option = raw.option ?? (raw.rating != null ? String(raw.rating) : undefined);
    const { timestamp, orderId, checkoutToken } = raw;
    if (!option) {
      return wrapCors(json({ error: "Missing survey option" }, { status: 400 }));
    }
    const trimmed = option.trim();
    if (trimmed.length === 0 || trimmed.length > 200) {
      return wrapCors(json({ error: "Invalid option length" }, { status: 400 }));
    }
    if (containsSensitiveInfo(trimmed)) {
      return wrapCors(json({ error: "Option contains sensitive info" }, { status: 400 }));
    }
    const safeOption = sanitizeSensitiveInfo(trimmed);
    const orderKey = makeOrderKey({ orderId, checkoutToken });
    if (!orderKey) {
      return wrapCors(json({ error: "Order context required (orderId or checkoutToken). Unavailable when PCD is not approved." }, { status: 400 }));
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
      return wrapCors(json({ error: "Invalid timestamp" }, { status: 400 }));
    }
    if (timestamp != null && timestamp !== "" && Number.isNaN(new Date(timestamp).getTime())) {
      return wrapCors(json({ error: "Invalid timestamp" }, { status: 400 }));
    }
    const existing = await prisma.surveyResponse.findFirst({
      where: { shopId: shop.id, orderId: finalOrderId },
    });
    if (existing) {
      await prisma.surveyResponse.update({
        where: { id: existing.id },
        data: { feedback: safeOption },
      });
      logger.info("Survey response received", { shopDomain });
      return wrapCors(json({ success: true, message: "Survey response updated", id: existing.id }));
    }
    const created = await prisma.surveyResponse.create({
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
    return wrapCors(json({ success: true, message: "Survey response recorded", id: created.id }));
  } catch (error) {
    if (error instanceof Response) {
      return wrapCors(error);
    }
    logger.error("Failed to process survey submission", {
      error: error instanceof Error ? error.message : String(error),
    });
    return wrapCors(json({ error: "Internal server error" }, { status: 500 }));
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
