
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

export function getRiskReason(params: RiskReasonParams): string {
  const { category, platform, riskLevel } = params;
  if (riskLevel === "high") {
    if (category === "script_tag" || category === "checkout_script") {
      return "脚本标签在 Thank you/Order status 页面已被弃用，可能导致功能失效";
    }
    if (platform === "google_analytics" || platform === "gtag") {
      return "Google Analytics 脚本标签需要迁移到 Web Pixel";
    }
    return "高风险：需要立即迁移";
  }
  if (riskLevel === "medium") {
    return "中等风险：建议尽快迁移";
  }
  return "低风险：可逐步迁移";
}

export function extractRequiredInfo(params: RequiredInfoParams): string {
  const { category, platform, suggestedMigration, details } = params;
  const info: string[] = [];
  if (suggestedMigration === "web_pixel") {
    info.push("需要配置 Web Pixel 扩展");
    if (platform) {
      info.push(`平台: ${platform}`);
    }
    if (details?.eventMappings) {
      info.push("需要配置事件映射");
    }
  } else if (suggestedMigration === "ui_extension") {
    info.push("需要按 Shopify 官方能力手动迁移页面逻辑");
    if (category === "survey" || category === "helpdesk" || category === "reorder") {
      info.push(`模块类型: ${category}`);
    }
  } else if (suggestedMigration === "server_side") {
    info.push("当前版本不提供服务端投递");
    if (platform) {
      info.push(`平台: ${platform}`);
    }
    if (details?.apiKey) {
      info.push("需要 API Key");
    }
  } else {
    info.push("需要手动处理或移除");
  }
  return info.join("; ");
}
