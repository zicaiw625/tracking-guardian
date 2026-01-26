import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { logger } from "../../utils/logger.server";
import prisma from "../../db.server";
import { getUiModuleConfigs, canUseModule, getDefaultSettings } from "../../services/ui-extension.server";
import { PCD_CONFIG } from "../../utils/config.server";
import { tryAuthenticatePublicWithShop, handlePublicPreflight, addSecurityHeaders } from "../../utils/public-auth";
import { sanitizeUrl, validateEmailForMailto, isPublicUrl } from "../../utils/security";
import { checkRateLimitAsync } from "../../middleware/rate-limit.server";
import { createReorderNonce } from "../../lib/pixel-events/receipt-handler";

function normalizeHostname(value: string): string {
  const v = value.trim().toLowerCase();
  return v.endsWith(".") ? v.slice(0, -1) : v;
}

function hostAllowed(host: string, rule: string): boolean {
  const h = normalizeHostname(host);
  const r = normalizeHostname(rule);
  if (!h || !r) return false;
  if (r.startsWith("*.")) {
    const base = r.slice(2);
    if (!base) return false;
    return h === base || h.endsWith(`.${base}`);
  }
  if (r.includes("*")) {
    return false;
  }
  return h === r || h.endsWith(`.${r}`);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return handlePublicPreflight(request);
  }
  if (request.method !== "GET") {
    return addSecurityHeaders(json({ error: "Method not allowed" }, { status: 405 }));
  }
  const auth = await tryAuthenticatePublicWithShop(request);
  if (!auth) {
    return addSecurityHeaders(json({ error: "Unauthorized: Invalid authentication" }, { status: 401 }));
  }
  const { authResult, shopDomain } = auth;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, primaryDomain: true, storefrontDomains: true },
  });
  if (!shop) {
    logger.warn(`UI modules state request for unknown shop: ${shopDomain}`);
    return addSecurityHeaders(authResult.cors(json(
      { error: "Shop not found" },
      { status: 404 }
    )));
  }
  try {
    const url = new URL(request.url);
    const target = url.searchParams.get("target") || "thank-you";
    const normalizedTarget = target === "order-status" ? "order_status" : "thank_you";
    const orderId = url.searchParams.get("orderId") || null;
    logger.info("UI modules state request", { shopDomain, target, normalizedTarget, hasOrderId: !!orderId });
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
    
    const surveyEnabledForTarget = (isTargetThankYou && surveyTargets.includes("thank_you")) || (isTargetOrderStatus && surveyTargets.includes("order_status"));
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
    const helpConfig = helpModule?.settings as { faqUrl?: string; contactUrl?: string; contactEmail?: string; allowedDomains?: string[] } | undefined;
    const reorderConfig = reorderModule?.settings as { title?: string; subtitle?: string; buttonText?: string } | undefined;
    const defaultSurveySettings = getDefaultSettings("survey") as { question?: string; sources?: Array<{ id: string; label: string }> };
    const defaultHelpSettings = getDefaultSettings("helpdesk") as { faqUrl?: string; contactUrl?: string; contactEmail?: string; allowedDomains?: string[] };
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
    if (helpFaqUrl && helpFaqUrl.startsWith("http")) {
      const sanitized = sanitizeUrl(helpFaqUrl);
      if (!sanitized) {
        logger.warn(`Invalid FAQ URL for shop ${shopDomain}: ${helpFaqUrl}`);
        helpFaqUrl = undefined;
      } else {
        try {
          const url = new URL(sanitized);
          const urlHostname = url.hostname.toLowerCase();
          const shopHostname = shopDomain.toLowerCase();
          const baseHostname = shop.primaryDomain 
            ? new URL(shop.primaryDomain.startsWith("http") ? shop.primaryDomain : `https://${shop.primaryDomain}`).hostname.toLowerCase()
            : shopHostname;
          const allowedHostnames = [shopHostname, baseHostname, ...(shop.storefrontDomains || []).map(d => {
            try {
              return new URL(d.startsWith("http") ? d : `https://${d}`).hostname.toLowerCase();
            } catch {
              return null;
            }
          }).filter(Boolean) as string[]];
          
          const extraAllowedDomains = helpConfig?.allowedDomains || defaultHelpSettings.allowedDomains || [];
          for (const domain of extraAllowedDomains) {
            const normalizedDomain = domain.trim().toLowerCase();
            if (normalizedDomain) {
              allowedHostnames.push(normalizedDomain);
            }
          }
          
          const isAllowed = allowedHostnames.some((allowed) => hostAllowed(urlHostname, allowed));
          
          if (!isAllowed || !isPublicUrl(sanitized)) {
            logger.warn(`FAQ URL hostname not allowed for shop ${shopDomain}: ${urlHostname}`);
            helpFaqUrl = undefined;
          } else {
            helpFaqUrl = sanitized;
          }
        } catch {
          logger.warn(`Invalid FAQ URL format for shop ${shopDomain}: ${helpFaqUrl}`);
          helpFaqUrl = undefined;
        }
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
    if (helpContactUrl && helpContactUrl.startsWith("http")) {
      const sanitized = sanitizeUrl(helpContactUrl);
      if (!sanitized) {
        logger.warn(`Invalid contact URL for shop ${shopDomain}: ${helpContactUrl}`);
        helpContactUrl = undefined;
      } else {
        try {
          const url = new URL(sanitized);
          const urlHostname = url.hostname.toLowerCase();
          const shopHostname = shopDomain.toLowerCase();
          const baseHostname = shop.primaryDomain 
            ? new URL(shop.primaryDomain.startsWith("http") ? shop.primaryDomain : `https://${shop.primaryDomain}`).hostname.toLowerCase()
            : shopHostname;
          const allowedHostnames = [shopHostname, baseHostname, ...(shop.storefrontDomains || []).map(d => {
            try {
              return new URL(d.startsWith("http") ? d : `https://${d}`).hostname.toLowerCase();
            } catch {
              return null;
            }
          }).filter(Boolean) as string[]];
          
          const extraAllowedDomains = helpConfig?.allowedDomains || defaultHelpSettings.allowedDomains || [];
          for (const domain of extraAllowedDomains) {
            const normalizedDomain = domain.trim().toLowerCase();
            if (normalizedDomain) {
              allowedHostnames.push(normalizedDomain);
            }
          }
          
          const isAllowed = allowedHostnames.some((allowed) => hostAllowed(urlHostname, allowed));
          
          if (!isAllowed || !isPublicUrl(sanitized)) {
            logger.warn(`Contact URL hostname not allowed for shop ${shopDomain}: ${urlHostname}`);
            helpContactUrl = undefined;
          } else {
            helpContactUrl = sanitized;
          }
        } catch {
          logger.warn(`Invalid contact URL format for shop ${shopDomain}: ${helpContactUrl}`);
          helpContactUrl = undefined;
        }
      }
    }
    const contactEmail = validateEmailForMailto(helpConfig?.contactEmail) ?? validateEmailForMailto(defaultHelpSettings.contactEmail);
    const helpSupportUrl = helpContactUrl || (contactEmail ? `mailto:${contactEmail}` : undefined);
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
          nonce?: string;
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
        if (orderId) {
          const subject = typeof authResult.sessionToken.sub === "string" && authResult.sessionToken.sub.trim().length > 0
            ? authResult.sessionToken.sub
            : "anon";
          const rateLimitKey = `reorder-nonce:${shopDomain}:${subject}:${authResult.surface}:${normalizedTarget}`;
          const rateLimitResult = await checkRateLimitAsync(rateLimitKey, 30, 60 * 1000);
          if (!rateLimitResult.allowed) {
            const headers = new Headers();
            headers.set("X-RateLimit-Limit", "30");
            headers.set("X-RateLimit-Remaining", "0");
            headers.set("X-RateLimit-Reset", String(Math.ceil(rateLimitResult.resetAt / 1000)));
            if (rateLimitResult.retryAfter) {
              headers.set("Retry-After", String(rateLimitResult.retryAfter));
            }
            return addSecurityHeaders(authResult.cors(json(
              { error: "Too many reorder nonce requests", retryAfter: rateLimitResult.retryAfter },
              { status: 429, headers }
            )));
          }
          const nonceResult = await createReorderNonce(shop.id, orderId, normalizedTarget);
          if (nonceResult.success && nonceResult.nonce) {
            state.reorderConfig.nonce = nonceResult.nonce;
          } else {
            logger.warn(`Failed to generate reorder nonce for shop ${shopDomain}`, {
              error: nonceResult.error,
            });
          }
        }
      }
      return addSecurityHeaders(authResult.cors(json(state)));
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
      return addSecurityHeaders(authResult.cors(json(state)));
    }
  } catch (error) {
    logger.error("Failed to get UI modules state", {
      error: error instanceof Error ? error.message : String(error),
      shopDomain,
      stack: error instanceof Error ? error.stack : undefined,
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
