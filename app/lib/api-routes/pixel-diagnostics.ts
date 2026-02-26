import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import prisma from "../../db.server";
import { checkRateLimitAsync, ipKeyExtractor } from "../../middleware/rate-limit.server";
import { addSecurityHeaders } from "../../utils/security-headers";
import { readJsonWithSizeLimit } from "../../utils/body-size-guard";
import { logger } from "../../utils/logger.server";
import { SHOP_DOMAIN_PATTERN } from "../../schemas/pixel-event";

const MAX_DIAGNOSTIC_BODY_BYTES = 2048;
const MAX_TIMESTAMP_SKEW_MS = 10 * 60 * 1000;

const pixelDiagnosticSchema = z.object({
  reason: z.enum(["missing_ingestion_key", "backend_unavailable"]),
  shopDomain: z.string().regex(SHOP_DOMAIN_PATTERN),
  timestamp: z.number().int(),
}).strict();

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, x-shopify-shop-domain, X-Tracking-Guardian-Diagnostic"
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function respond(
  payload: unknown,
  status = 200
): Response {
  return withCors(addSecurityHeaders(json(payload, { status })));
}

function hasValidOriginOrReferer(request: Request, shopDomain: string): boolean {
  const origin = request.headers.get("Origin");
  if (origin === "null") {
    return true;
  }
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol !== "https:") {
        return false;
      }
      const host = parsed.hostname.toLowerCase();
      if (host === shopDomain.toLowerCase()) {
        return true;
      }
      if (host.endsWith(".myshopify.com") || host.endsWith(".shopify.com")) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
  const referer = request.headers.get("Referer");
  if (!referer) {
    return false;
  }
  try {
    const parsed = new URL(referer);
    if (parsed.protocol !== "https:") {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (host === shopDomain.toLowerCase()) {
      return true;
    }
    return host.endsWith(".myshopify.com") || host.endsWith(".shopify.com");
  } catch {
    return false;
  }
}

function hasValidUserAgent(request: Request): boolean {
  const ua = request.headers.get("User-Agent");
  if (!ua) {
    return false;
  }
  const trimmed = ua.trim();
  if (!trimmed) {
    return false;
  }
  return trimmed.length <= 512;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return respond(null, 204);
  }

  if (request.method !== "POST") {
    return respond({ error: "Method not allowed" }, 405);
  }

  if (request.headers.get("X-Tracking-Guardian-Diagnostic") !== "1") {
    return respond({ error: "Invalid request" }, 400);
  }

  let body: z.infer<typeof pixelDiagnosticSchema>;
  try {
    const parsed = await readJsonWithSizeLimit<unknown>(request, MAX_DIAGNOSTIC_BODY_BYTES);
    const result = pixelDiagnosticSchema.safeParse(parsed);
    if (!result.success) {
      return respond({ error: "Invalid request" }, 400);
    }
    body = result.data;
  } catch {
    return respond({ error: "Invalid request" }, 400);
  }

  const headerShopDomain = request.headers.get("x-shopify-shop-domain");
  if (headerShopDomain && headerShopDomain !== body.shopDomain) {
    return respond({ error: "Invalid request" }, 403);
  }

  const now = Date.now();
  if (Math.abs(now - body.timestamp) > MAX_TIMESTAMP_SKEW_MS) {
    return respond({ accepted: true }, 202);
  }

  if (!hasValidUserAgent(request)) {
    return respond({ error: "Invalid request" }, 403);
  }

  if (!hasValidOriginOrReferer(request, body.shopDomain)) {
    return respond({ error: "Invalid request" }, 403);
  }

  const ipKey = ipKeyExtractor(request);
  const rateLimitKey = `pixel-diagnostics:${body.shopDomain}:${ipKey}`;
  const rateLimit = await checkRateLimitAsync(rateLimitKey, 20, 60 * 1000, false, true);
  if (!rateLimit.allowed) {
    return respond({ error: "Too many requests" }, 429);
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: body.shopDomain },
    select: { id: true, isActive: true },
  });

  if (!shop || !shop.isActive) {
    return respond({ accepted: true }, 202);
  }

  logger.warn("Pixel diagnostic reported", {
    shopId: shop.id,
    shopDomain: body.shopDomain,
    reason: body.reason,
    ipKey,
    timestamp: body.timestamp,
  });

  return respond({ accepted: true }, 202);
};
