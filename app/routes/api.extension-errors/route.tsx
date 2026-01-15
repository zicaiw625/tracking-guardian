import type { ActionFunctionArgs } from "@remix-run/node";
import { randomUUID } from "crypto";
import { logger } from "../../utils/logger.server";
import { optionsResponse, jsonWithCors } from "../../utils/cors";
import { checkRateLimitAsync } from "../../middleware/rate-limit";
import prisma from "../../db.server";
import { authenticatePublic, normalizeDestToShopDomain } from "../../utils/public-auth";
import { sanitizeSensitiveInfo } from "../../utils/security";

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
    logger.warn(`Extension error report for unknown shop: ${shopDomain}`);
    return authResult.cors(jsonWithCors(
      { error: "Shop not found" },
      { status: 404, request, staticCors: true }
    ));
  }
  const rateLimitKey = `extension-errors:${shopDomain}`;
  const rateLimitResult = await checkRateLimitAsync(rateLimitKey, 100, 60 * 1000);
  if (!rateLimitResult.allowed) {
    const headers = new Headers();
    headers.set("X-RateLimit-Limit", "100");
    headers.set("X-RateLimit-Remaining", "0");
    headers.set("X-RateLimit-Reset", String(Math.ceil(rateLimitResult.resetAt / 1000)));
    if (rateLimitResult.retryAfter) {
      headers.set("Retry-After", String(rateLimitResult.retryAfter));
    }
    logger.warn("Extension errors rate limit exceeded", {
      shopDomain,
      retryAfter: rateLimitResult.retryAfter,
    });
      return authResult.cors(jsonWithCors(
        {
          error: "Too many error reports",
          retryAfter: rateLimitResult.retryAfter,
        },
        { status: 429, request, staticCors: true, headers }
      ));
    }
  try {
    const body = await request.json().catch(() => null) as {
      extension?: string;
      endpoint?: string;
      error?: string;
      stack?: string;
      target?: string;
      orderId?: string | null;
      timestamp?: string;
    } | null;
      if (!body || !body.extension || !body.endpoint || !body.error) {
      return authResult.cors(jsonWithCors(
        { error: "Missing required fields: extension, endpoint, error" },
        { status: 400, request, staticCors: true }
      ));
    }
    const MAX_ERROR_LENGTH = 2000;
    const MAX_STACK_LENGTH = 8000;
    const sanitizedError = sanitizeSensitiveInfo(body.error);
    const truncatedError = sanitizedError.length > MAX_ERROR_LENGTH
      ? sanitizedError.substring(0, MAX_ERROR_LENGTH) + "... [truncated]"
      : sanitizedError;
    const sanitizedStack = body.stack ? sanitizeSensitiveInfo(body.stack) : null;
    const truncatedStack = sanitizedStack && sanitizedStack.length > MAX_STACK_LENGTH
      ? sanitizedStack.substring(0, MAX_STACK_LENGTH) + "... [truncated]"
      : sanitizedStack;
    const errorData = {
      shopId: shop.id,
      shopDomain,
      extension: body.extension,
      endpoint: body.endpoint,
      error: truncatedError,
      stack: truncatedStack,
      target: body.target || null,
      orderId: body.orderId || null,
      timestamp: body.timestamp ? new Date(body.timestamp) : new Date(),
    };
    const shouldLog = rateLimitResult.remaining > 20 || Math.random() < 0.1;
    if (rateLimitResult.remaining < 20) {
      if (shouldLog) {
        logger.warn("Extension error reported (approaching rate limit, sampled)", {
          shopId: shop.id,
          shopDomain,
          extension: body.extension,
          endpoint: body.endpoint,
          target: body.target,
          orderId: body.orderId,
          error: truncatedError.substring(0, 200),
          remaining: rateLimitResult.remaining,
        });
      }
    } else if (shouldLog) {
      logger.error("Extension error reported", {
        shopId: shop.id,
        shopDomain,
        extension: body.extension,
        endpoint: body.endpoint,
        target: body.target,
        orderId: body.orderId,
        error: truncatedError,
        stack: truncatedStack,
      });
    }
    try {
      const errorId = randomUUID();
      await prisma.extensionError.create({
        data: {
          id: errorId,
          shopId: shop.id,
          shopDomain,
          extension: body.extension,
          endpoint: body.endpoint,
          error: errorData.error,
          stack: errorData.stack,
          target: errorData.target,
          orderId: errorData.orderId,
          createdAt: errorData.timestamp,
        },
      });
    } catch (dbError) {
      logger.error("Failed to save extension error to database", {
        shopId: shop.id,
        shopDomain,
        dbError: dbError instanceof Error ? dbError.message : String(dbError),
      });
    }
    return authResult.cors(jsonWithCors({ success: true }, { request, staticCors: true }));
  } catch (error) {
    logger.error("Failed to process extension error report", {
      error: error instanceof Error ? error.message : String(error),
      shopDomain,
      stack: error instanceof Error ? error.stack : undefined,
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
