import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { logger } from "../../utils/logger.server";
import prisma from "../../db.server";
import { getUiModuleConfigs, canUseModule, getDefaultSettings } from "../../services/ui-extension.server";
import { PCD_CONFIG } from "../../utils/config";
import { authenticatePublic, normalizeDestToShopDomain, getPublicCorsForOptions } from "../../utils/public-auth";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    const cors = await getPublicCorsForOptions(request);
    return cors(new Response(null, { status: 204 }));
  }
  if (request.method !== "GET") {
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
    select: { id: true, primaryDomain: true, storefrontDomains: true },
  });
  if (!shop) {
    logger.warn(`UI modules state request for unknown shop: ${shopDomain}`);
    return authResult.cors(json(
      { error: "Shop not found" },
      { status: 404 }
    ));
  }
  try {
    const url = new URL(request.url);
    const target = url.searchParams.get("target") || "thank-you";
    const normalizedTarget = target === "order-status" ? "order_status" : "thank_you";
    logger.info("UI modules state request", { shopDomain, target, normalizedTarget });
    const modules = await getUiModuleConfigs(shop.id);
    const [surveyAllowed, helpAllowed, reorderAllowed] = await Promise.all([
      canUseModule(shop.id, "survey"),
      canUseModule(shop.id, "helpdesk"),
      canUseModule(shop.id, "reorder"),
    ]);
    const surveyModule = modules.find((m) => m.moduleKey === "survey");
    const helpModule = modules.find((m) => m.moduleKey === "helpdesk");
    const reorderModule = modules.find((m) => m.moduleKey === "reorder");
    const surveyTargets = surveyModule?.displayRules?.targets || [];
    const helpTargets = helpModule?.displayRules?.targets || [];
    const reorderTargets = reorderModule?.displayRules?.targets || [];
    
    const isTargetThankYou = normalizedTarget === "thank_you";
    const isTargetOrderStatus = normalizedTarget === "order_status";
    
    const surveyEnabledForTarget = isTargetThankYou && surveyTargets.includes("thank_you");
    const helpEnabledForTarget = isTargetThankYou
      ? helpTargets.includes("thank_you")
      : isTargetOrderStatus && helpTargets.includes("order_status");
    const reorderEnabledForTarget = isTargetOrderStatus && reorderTargets.includes("order_status");
    logger.debug("Module target filtering", {
      shopDomain,
      target: normalizedTarget,
      survey: { enabled: surveyModule?.isEnabled, targets: surveyTargets, enabledForTarget: surveyEnabledForTarget },
      help: { enabled: helpModule?.isEnabled, targets: helpTargets, enabledForTarget: helpEnabledForTarget },
      reorder: { enabled: reorderModule?.isEnabled, targets: reorderTargets, enabledForTarget: reorderEnabledForTarget },
    });
    const surveyConfig = surveyModule?.settings as { question?: string; sources?: Array<{ id: string; label: string }> } | undefined;
    const helpConfig = helpModule?.settings as { faqUrl?: string; contactUrl?: string; contactEmail?: string } | undefined;
    const reorderConfig = reorderModule?.settings as { title?: string; subtitle?: string; buttonText?: string } | undefined;
    const defaultSurveySettings = getDefaultSettings("survey") as { question?: string; sources?: Array<{ id: string; label: string }> };
    const defaultHelpSettings = getDefaultSettings("helpdesk") as { faqUrl?: string; contactUrl?: string; contactEmail?: string };
    const defaultReorderSettings = getDefaultSettings("reorder") as { title?: string; subtitle?: string; buttonText?: string };
    const surveyQuestion = surveyConfig?.question || defaultSurveySettings.question || "您是如何了解到我们的？";
    const surveyOptions = surveyConfig?.sources?.map(s => s.label) || defaultSurveySettings.sources?.map(s => s.label) || ["搜索引擎", "社交媒体", "朋友推荐", "广告", "其他"];
    let baseUrl = `https://${shopDomain}`;
    if (shop.primaryDomain) {
      baseUrl = shop.primaryDomain.startsWith("http") ? shop.primaryDomain : `https://${shop.primaryDomain}`;
    } else if (shop.storefrontDomains && shop.storefrontDomains.length > 0) {
      baseUrl = shop.storefrontDomains[0].startsWith("http") ? shop.storefrontDomains[0] : `https://${shop.storefrontDomains[0]}`;
    }
    let helpFaqUrl = helpConfig?.faqUrl || defaultHelpSettings.faqUrl;
    if (helpFaqUrl && !helpFaqUrl.startsWith("http") && !helpFaqUrl.startsWith("mailto:")) {
      if (helpFaqUrl.startsWith("/")) {
        helpFaqUrl = `${baseUrl}${helpFaqUrl}`;
      } else {
        helpFaqUrl = `${baseUrl}/${helpFaqUrl}`;
      }
    }
    let helpContactUrl = helpConfig?.contactUrl || defaultHelpSettings.contactUrl;
    if (helpContactUrl && !helpContactUrl.startsWith("http") && !helpContactUrl.startsWith("mailto:")) {
      if (helpContactUrl.startsWith("/")) {
        helpContactUrl = `${baseUrl}${helpContactUrl}`;
      } else {
        helpContactUrl = `${baseUrl}/${helpContactUrl}`;
      }
    }
    const helpSupportUrl = helpContactUrl || (helpConfig?.contactEmail ? `mailto:${helpConfig.contactEmail}` : (defaultHelpSettings.contactEmail ? `mailto:${defaultHelpSettings.contactEmail}` : undefined));
    const surveyEnabled = (surveyModule?.isEnabled ?? false) && surveyAllowed.allowed && surveyEnabledForTarget;
    const helpEnabled = (helpModule?.isEnabled ?? false) && helpAllowed.allowed && helpEnabledForTarget;
    const reorderEnabled = PCD_CONFIG.APPROVED && (reorderModule?.isEnabled ?? false) && reorderAllowed.allowed && reorderEnabledForTarget && normalizedTarget === "order_status";
    
    logger.debug("Final module state", {
      shopDomain,
      target: normalizedTarget,
      survey: { enabled: surveyEnabled, allowed: surveyAllowed.allowed, enabledForTarget: surveyEnabledForTarget },
      help: { enabled: helpEnabled, allowed: helpAllowed.allowed, enabledForTarget: helpEnabledForTarget },
      reorder: { enabled: reorderEnabled, allowed: reorderAllowed.allowed, enabledForTarget: reorderEnabledForTarget },
    });
    
    if (normalizedTarget === "order_status") {
      const state: {
        surveyEnabled: boolean;
        helpEnabled: boolean;
        reorderEnabled?: boolean;
        surveyConfig: {
          question: string;
          options: string[];
        };
        helpConfig: {
          faqUrl?: string;
          supportUrl?: string;
        };
        reorderConfig?: {
          title?: string;
          subtitle?: string;
          buttonText?: string;
        };
      } = {
        surveyEnabled: false,
        helpEnabled: false,
        reorderEnabled: false,
        surveyConfig: {
          question: surveyQuestion,
          options: surveyOptions,
        },
        helpConfig: {},
      };
      if (surveyEnabled) {
        state.surveyEnabled = true;
      }
      if (helpEnabled) {
        state.helpEnabled = true;
        if (helpFaqUrl) {
          state.helpConfig.faqUrl = helpFaqUrl;
        }
        if (helpSupportUrl) {
          state.helpConfig.supportUrl = helpSupportUrl;
        }
      }
      if (reorderEnabled) {
        state.reorderEnabled = true;
        state.reorderConfig = {
          title: reorderConfig?.title || defaultReorderSettings.title,
          subtitle: reorderConfig?.subtitle || defaultReorderSettings.subtitle,
          buttonText: reorderConfig?.buttonText || defaultReorderSettings.buttonText,
        };
      }
      return authResult.cors(json(state));
    } else {
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
        surveyEnabled: false,
        helpEnabled: false,
        surveyConfig: {
          question: surveyQuestion,
          options: surveyOptions,
        },
        helpConfig: {},
      };
      if (surveyEnabled) {
        state.surveyEnabled = true;
      }
      if (helpEnabled) {
        state.helpEnabled = true;
        if (helpFaqUrl) {
          state.helpConfig.faqUrl = helpFaqUrl;
        }
        if (helpSupportUrl) {
          state.helpConfig.supportUrl = helpSupportUrl;
        }
      }
      return authResult.cors(json(state));
    }
  } catch (error) {
    logger.error("Failed to get UI modules state", {
      error: error instanceof Error ? error.message : String(error),
      shopDomain,
      stack: error instanceof Error ? error.stack : undefined,
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
