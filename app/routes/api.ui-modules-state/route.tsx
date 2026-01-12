import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import { logger } from "../../utils/logger.server";
import { optionsResponse, jsonWithCors } from "../../utils/cors";
import prisma from "../../db.server";
import { getUiModuleConfigs, canUseModule } from "../../services/ui-extension.server";

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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return optionsResponse(request, true);
  }
  if (request.method !== "GET") {
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
    logger.warn(`UI modules state request for unknown shop: ${shopDomain}`);
    return jsonWithCors(
      { error: "Shop not found" },
      { status: 404, request, staticCors: true }
    );
  }
  try {
    const url = new URL(request.url);
    const target = url.searchParams.get("target") || "thank-you";
    const modules = await getUiModuleConfigs(shop.id);
    const [surveyAllowed, helpAllowed, reorderAllowed] = await Promise.all([
      canUseModule(shop.id, "survey"),
      canUseModule(shop.id, "helpdesk"),
      canUseModule(shop.id, "reorder"),
    ]);
    const surveyModule = modules.find((m) => m.moduleKey === "survey");
    const helpModule = modules.find((m) => m.moduleKey === "helpdesk");
    const reorderModule = modules.find((m) => m.moduleKey === "reorder");
    const reorderEnabled = target === "order-status" 
      ? (reorderModule?.isEnabled ?? false) && reorderAllowed.allowed
      : false;
    const state = {
      surveyEnabled: (surveyModule?.isEnabled ?? false) && surveyAllowed.allowed,
      helpEnabled: (helpModule?.isEnabled ?? false) && helpAllowed.allowed,
      reorderEnabled,
    };
    return jsonWithCors(state, { request, staticCors: true });
  } catch (error) {
    logger.error("Failed to get UI modules state", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonWithCors(
      { error: "Internal server error" },
      { status: 500, request, staticCors: true }
    );
  }
};
