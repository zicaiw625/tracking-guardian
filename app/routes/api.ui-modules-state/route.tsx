import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import { logger } from "../../utils/logger.server";
import { optionsResponse, jsonWithCors } from "../../utils/cors";
import prisma from "../../db.server";
import { getUiModuleConfigs, canUseModule, getDefaultSettings } from "../../services/ui-extension.server";

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
    const [surveyAllowed, helpAllowed] = await Promise.all([
      canUseModule(shop.id, "survey"),
      canUseModule(shop.id, "helpdesk"),
    ]);
    const surveyModule = modules.find((m) => m.moduleKey === "survey");
    const helpModule = modules.find((m) => m.moduleKey === "helpdesk");
    
    const surveyConfig = surveyModule?.settings as { question?: string; sources?: Array<{ id: string; label: string }> } | undefined;
    const helpConfig = helpModule?.settings as { faqUrl?: string; contactUrl?: string; contactEmail?: string } | undefined;
    
    const defaultSurveySettings = getDefaultSettings("survey") as { question?: string; sources?: Array<{ id: string; label: string }> };
    const defaultHelpSettings = getDefaultSettings("helpdesk") as { faqUrl?: string; contactUrl?: string; contactEmail?: string };
    
    const surveyQuestion = surveyConfig?.question || defaultSurveySettings.question || "您是如何了解到我们的？";
    const surveyOptions = surveyConfig?.sources?.map(s => s.label) || defaultSurveySettings.sources?.map(s => s.label) || ["搜索引擎", "社交媒体", "朋友推荐", "广告", "其他"];
    const helpFaqUrl = helpConfig?.faqUrl || defaultHelpSettings.faqUrl;
    const helpSupportUrl = helpConfig?.contactUrl || (helpConfig?.contactEmail ? `mailto:${helpConfig.contactEmail}` : (defaultHelpSettings.contactUrl || (defaultHelpSettings.contactEmail ? `mailto:${defaultHelpSettings.contactEmail}` : undefined)));
    
    const surveyEnabled = (surveyModule?.isEnabled ?? false) && surveyAllowed.allowed;
    const helpEnabled = (helpModule?.isEnabled ?? false) && helpAllowed.allowed;
    
    const state: {
      surveyEnabled: boolean;
      helpEnabled: boolean;
      surveyConfig: {
        question: string;
        options: string[];
      };
      helpConfig: {
        faqUrl?: string;
        supportUrl?: string;
      };
    } = {
      surveyEnabled,
      helpEnabled,
      surveyConfig: {
        question: surveyQuestion,
        options: surveyOptions,
      },
      helpConfig: {},
    };
    
    if (helpFaqUrl) {
      state.helpConfig.faqUrl = helpFaqUrl;
    }
    if (helpSupportUrl) {
      state.helpConfig.supportUrl = helpSupportUrl;
    }
    
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
