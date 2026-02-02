
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
        text: "脚本标签在 Thank you/Order status 页面已被弃用，可能导致功能失效",
        key: "scan.riskReason.scriptTagDeprecated"
      };
    }
    if (platform === "google_analytics" || platform === "gtag") {
      return {
        text: "Google Analytics 脚本标签需要迁移到 Web Pixel",
        key: "scan.riskReason.gaMigration"
      };
    }
    return {
      text: "高风险：需要立即迁移",
      key: "scan.riskReason.high"
    };
  }
  if (riskLevel === "medium") {
    return {
      text: "中等风险：建议尽快迁移",
      key: "scan.riskReason.medium"
    };
  }
  return {
    text: "低风险：可逐步迁移",
    key: "scan.riskReason.low"
  };
}

export function extractRequiredInfo(params: RequiredInfoParams): { text: string, keys: { key: string, params?: any }[] } {
  const { category, platform, suggestedMigration, details } = params;
  const info: string[] = [];
  const keys: { key: string, params?: any }[] = [];
  
  if (suggestedMigration === "web_pixel") {
    info.push("需要配置 Web Pixel 扩展");
    keys.push({ key: "scan.requiredInfo.webPixelConfig" });
    if (platform) {
      info.push(`平台: ${platform}`);
      keys.push({ key: "scan.requiredInfo.platform", params: { platform } });
    }
    if (details?.eventMappings) {
      info.push("需要配置事件映射");
      keys.push({ key: "scan.requiredInfo.eventMappings" });
    }
  } else if (suggestedMigration === "ui_extension") {
    info.push("需要按 Shopify 官方能力手动迁移页面逻辑");
    keys.push({ key: "scan.requiredInfo.uiExtensionManual" });
    if (category === "survey" || category === "helpdesk" || category === "reorder") {
      info.push(`模块类型: ${category}`);
      keys.push({ key: "scan.requiredInfo.moduleType", params: { category } });
    }
  } else if (suggestedMigration === "server_side") {
    info.push("当前版本不提供服务端投递");
    keys.push({ key: "scan.requiredInfo.serverSideNotSupported" });
    if (platform) {
      info.push(`平台: ${platform}`);
      keys.push({ key: "scan.requiredInfo.platform", params: { platform } });
    }
    if (details?.apiKey) {
      info.push("需要 API Key");
      keys.push({ key: "scan.requiredInfo.apiKey" });
    }
  } else {
    info.push("需要手动处理或移除");
    keys.push({ key: "scan.requiredInfo.manualHandling" });
  }
  return { text: info.join("; "), keys };
}
