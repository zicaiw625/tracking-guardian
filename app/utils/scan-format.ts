import { validateRiskScore, validateStringArray, safeFormatDate, validateRiskItemsArray } from "./scan-data-validation";
import { parseDateSafely } from "./scan-validation";
import { getStatusText, getPlatformName } from "~/components/scan/utils";
import { getShopifyAdminUrl } from "./helpers";
import type { RiskItem } from "../types";

export function formatScanHistoryForTable(
  scanHistory: Array<{ riskScore?: unknown; identifiedPlatforms?: unknown; createdAt?: unknown; status?: string | null } | null>
): Array<[string, number, string, string]> {
  return scanHistory
    .filter((scan): scan is NonNullable<typeof scan> => scan !== null)
    .map((scan) => {
      const riskScore = validateRiskScore(scan.riskScore);
      const platforms = validateStringArray(scan.identifiedPlatforms);
      const createdAt = parseDateSafely(scan.createdAt);
      const status = getStatusText(scan.status);
      return [
        createdAt ? safeFormatDate(createdAt) : "未知",
        riskScore,
        platforms.join(", ") || "-",
        status,
      ];
    });
}

export function calculateEstimatedTime(riskItems: RiskItem[]): { hours: number; minutes: number; totalMinutes: number } {
  const timeMap: Record<string, number> = { high: 30, medium: 15, low: 5 };
  const totalMinutes = riskItems.reduce((sum, item) => {
    return sum + (timeMap[item.severity] || 10);
  }, 0);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return { hours, minutes, totalMinutes };
}

export function calculateROIEstimate(
  monthlyOrders: number,
  identifiedPlatformsCount: number,
  scriptTagsCount: number
): {
  eventsLostPerMonth: number;
  platforms: number;
  scriptTagCount: number;
} {
  return {
    eventsLostPerMonth: Math.max(0, monthlyOrders) * Math.max(0, identifiedPlatformsCount),
    platforms: Math.max(0, identifiedPlatformsCount),
    scriptTagCount: Math.max(0, scriptTagsCount),
  };
}

export function generateChecklistText(
  migrationActions: Array<{
    title: string;
    platform?: string;
    priority: "high" | "medium" | "low";
  }> | null | undefined,
  shopDomain: string | null | undefined,
  format: "markdown" | "plain"
): string {
  
  const items = migrationActions && migrationActions.length > 0
    ? migrationActions.map((a, i) => {
        const priorityText = format === "markdown"
          ? (a.priority === "high" ? "高" : a.priority === "medium" ? "中" : "低")
          : (a.priority === "high" ? "高优先级" : a.priority === "medium" ? "中优先级" : "低优先级");
        const platformText = a.platform ? ` (${getPlatformName(a.platform)})` : "";
        return `${i + 1}. [${priorityText}] ${a.title}${platformText}`;
      })
    : ["无"];
  
  if (format === "markdown") {
    return [
      "# 迁移清单",
      `店铺: ${shopDomain || "未知"}`,
      `生成时间: ${new Date().toLocaleString("zh-CN")}`,
      "",
      "## 待处理项目",
      ...items,
      "",
      "## 快速链接",
      shopDomain ? `- Pixels 管理: ${getShopifyAdminUrl(shopDomain, "/settings/notifications")}` : "- Pixels 管理: (需要店铺域名)",
      shopDomain ? `- Checkout Editor: ${getShopifyAdminUrl(shopDomain, "/themes/current/editor")}` : "- Checkout Editor: (需要店铺域名)",
      "- 应用迁移工具: /app/migrate",
    ].join("\n");
  } else {
    return [
      "迁移清单",
      `店铺: ${shopDomain || "未知"}`,
      `生成时间: ${new Date().toLocaleString("zh-CN")}`,
      "",
      "待处理项目:",
      ...items,
    ].join("\n");
  }
}

export function getRiskLevel(riskScore: number): "high" | "medium" | "low" {
  if (riskScore > 60) return "high";
  if (riskScore > 30) return "medium";
  return "low";
}

export function getRiskLevelBadgeTone(riskScore: number): "critical" | "warning" | "success" {
  if (riskScore > 60) return "critical";
  if (riskScore > 30) return "warning";
  return "success";
}

export function getRiskLevelBackground(riskScore: number): "bg-fill-critical" | "bg-fill-warning" | "bg-fill-success" {
  if (riskScore > 60) return "bg-fill-critical";
  if (riskScore > 30) return "bg-fill-warning";
  return "bg-fill-success";
}
