import type { ActionFunctionArgs } from "@remix-run/node";
import { randomUUID } from "crypto";
import { authenticate } from "../../shopify.server";
import { logger } from "../../utils/logger.server";
import { optionsResponse, jsonWithCors } from "../../utils/cors";
import prisma from "../../db.server";

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
      logger.warn("Public extension authentication failed for extension-errors", {
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
    logger.warn(`Extension error report for unknown shop: ${shopDomain}`);
    return jsonWithCors(
      { error: "Shop not found" },
      { status: 404, request, staticCors: true }
    );
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
      return jsonWithCors(
        { error: "Missing required fields: extension, endpoint, error" },
        { status: 400, request, staticCors: true }
      );
    }
    const errorData = {
      shopId: shop.id,
      shopDomain,
      extension: body.extension,
      endpoint: body.endpoint,
      error: body.error,
      stack: body.stack || null,
      target: body.target || null,
      orderId: body.orderId || null,
      timestamp: body.timestamp ? new Date(body.timestamp) : new Date(),
    };
    logger.error("Extension error reported", {
      shopId: shop.id,
      shopDomain,
      extension: body.extension,
      endpoint: body.endpoint,
      target: body.target,
      orderId: body.orderId,
      error: body.error,
      stack: body.stack,
    });
    try {
      const errorId = randomUUID();
      await prisma.extensionError.create({
        data: {
          id: errorId,
          shopId: shop.id,
          shopDomain,
          extension: body.extension,
          endpoint: body.endpoint,
          error: body.error,
          stack: body.stack || null,
          target: body.target || null,
          orderId: body.orderId || null,
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
    return jsonWithCors({ success: true }, { request, staticCors: true });
  } catch (error) {
    logger.error("Failed to process extension error report", {
      error: error instanceof Error ? error.message : String(error),
      shopDomain,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonWithCors(
      { error: "Internal server error" },
      { status: 500, request, staticCors: true }
    );
  }
};
