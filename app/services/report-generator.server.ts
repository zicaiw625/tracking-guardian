
export interface RiskReasonParams {
  category: string;
  platform?: string | null;
  riskLevel: string;
  details: Record<string, unknown> | null;
}

export interface RequiredInfoParams {
  category: string;
  platform?: string | null;
  suggestedMigration: string;
  details: Record<string, unknown> | null;
}

export interface LocalizedResult {
  text: string;
  key: string;
  params?: Record<string, any>;
}

export function getRiskReason(params: RiskReasonParams): LocalizedResult {
  const { category, platform, riskLevel } = params;
  if (riskLevel === "high") {
    if (category === "script_tag" || category === "checkout_script") {
      return {
        text: "Script tags on Thank You/Order Status pages have been deprecated and may stop working",
        key: "scan.riskReason.scriptTagDeprecated"
      };
    }
    if (platform === "google_analytics" || platform === "gtag") {
      return {
        text: "Google Analytics script tags need to be migrated to Web Pixel",
        key: "scan.riskReason.gaMigration"
      };
    }
    return {
      text: "High risk: immediate migration required",
      key: "scan.riskReason.high"
    };
  }
  if (riskLevel === "medium") {
    return {
      text: "Medium risk: migration recommended soon",
      key: "scan.riskReason.medium"
    };
  }
  return {
    text: "Low risk: can migrate gradually",
    key: "scan.riskReason.low"
  };
}

export function extractRequiredInfo(params: RequiredInfoParams): { text: string, keys: { key: string, params?: any }[] } {
  const { category, platform, suggestedMigration, details } = params;
  const info: string[] = [];
  const keys: { key: string, params?: any }[] = [];
  
  if (suggestedMigration === "web_pixel") {
    info.push("Web Pixel extension configuration required");
    keys.push({ key: "scan.requiredInfo.webPixelConfig" });
    if (platform) {
      info.push(`Platform: ${platform}`);
      keys.push({ key: "scan.requiredInfo.platform", params: { platform } });
    }
    if (details?.eventMappings) {
      info.push("Event mapping configuration required");
      keys.push({ key: "scan.requiredInfo.eventMappings" });
    }
  } else if (suggestedMigration === "ui_extension") {
    info.push("Manual migration of page logic required per Shopify official capabilities");
    keys.push({ key: "scan.requiredInfo.uiExtensionManual" });
    if (category === "survey" || category === "helpdesk" || category === "reorder") {
      info.push(`Module type: ${category}`);
      keys.push({ key: "scan.requiredInfo.moduleType", params: { category } });
    }
  } else if (suggestedMigration === "server_side") {
    info.push("Server-side delivery not available in current version");
    keys.push({ key: "scan.requiredInfo.serverSideNotSupported" });
    if (platform) {
      info.push(`Platform: ${platform}`);
      keys.push({ key: "scan.requiredInfo.platform", params: { platform } });
    }
    if (details?.apiKey) {
      info.push("API Key required");
      keys.push({ key: "scan.requiredInfo.apiKey" });
    }
  } else {
    info.push("Manual handling or removal required");
    keys.push({ key: "scan.requiredInfo.manualHandling" });
  }
  return { text: info.join("; "), keys };
}
