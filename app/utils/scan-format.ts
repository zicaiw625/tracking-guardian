import { validateRiskScore, validateStringArray, safeFormatDate } from "./scan-data-validation";
import { parseDateSafely } from "./scan-validation";
import { getStatusText, getPlatformName } from "~/components/scan/utils";
import { getShopifyAdminUrl } from "./helpers";
import type { RiskItem } from "../types";
import type { TFunction } from "i18next";

export function formatScanHistoryForTable(
  scanHistory: Array<{ riskScore?: unknown; identifiedPlatforms?: unknown; createdAt?: unknown; status?: string | null } | null>,
  t?: TFunction
): Array<[string, number, string, string]> {
  return scanHistory
    .filter((scan): scan is NonNullable<typeof scan> => scan !== null)
    .map((scan) => {
      const riskScore = validateRiskScore(scan.riskScore);
      const platforms = validateStringArray(scan.identifiedPlatforms);
      const createdAt = parseDateSafely(scan.createdAt);
      const status = getStatusText(scan.status || "", t);
      return [
        createdAt ? safeFormatDate(createdAt) : (t ? t("common.unknown") : "Unknown"),
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
    titleKey?: string;
    titleParams?: Record<string, any>;
    platform?: string;
    priority: "high" | "medium" | "low";
  }> | null | undefined,
  shopDomain: string | null | undefined,
  format: "markdown" | "plain",
  t?: TFunction
): string {
  
  const _t = t || ((key: string, _options?: any) => {
      // Fallback if no t provided (defaults to English)
      if (key === "scan.checklist.export.title") return "Migration Checklist";
      if (key === "scan.checklist.export.shop") return "Shop";
      if (key === "scan.checklist.export.generatedAt") return "Generated At";
      if (key === "scan.checklist.export.pendingItems") return "Pending Items";
      if (key === "scan.checklist.export.quickLinks") return "Quick Links";
      if (key === "scan.checklist.export.pixelsAdmin") return "Pixels Admin";
      if (key === "scan.checklist.export.checkoutEditor") return "Checkout Editor";
      if (key === "scan.checklist.export.migrationTool") return "App Migration Tool";
      if (key === "scan.checklist.export.needDomain") return "(Shop domain required)";
      if (key === "scan.checklist.export.unknown") return "Unknown";
      if (key === "scan.checklist.export.priorityHigh") return "High";
      if (key === "scan.checklist.export.priorityMedium") return "Med";
      if (key === "scan.checklist.export.priorityLow") return "Low";
      if (key === "scan.checklist.export.priorityHighFull") return "High Priority";
      if (key === "scan.checklist.export.priorityMediumFull") return "Medium Priority";
      if (key === "scan.checklist.export.priorityLowFull") return "Low Priority";
      if (key === "scan.checklist.export.none") return "None";
      return key;
  });

  const items = migrationActions && migrationActions.length > 0
    ? migrationActions.map((a, i) => {
        const priorityText = format === "markdown"
          ? (a.priority === "high" ? _t("scan.checklist.export.priorityHigh") : a.priority === "medium" ? _t("scan.checklist.export.priorityMedium") : _t("scan.checklist.export.priorityLow"))
          : (a.priority === "high" ? _t("scan.checklist.export.priorityHighFull") : a.priority === "medium" ? _t("scan.checklist.export.priorityMediumFull") : _t("scan.checklist.export.priorityLowFull"));
        const platformText = a.platform ? ` (${getPlatformName(a.platform)})` : "";
        const title = a.titleKey && t ? t(a.titleKey, a.titleParams) : a.title;
        return `${i + 1}. [${priorityText}] ${title}${platformText}`;
      })
    : [_t("scan.checklist.export.none")];
  
  if (format === "markdown") {
    return [
      `# ${_t("scan.checklist.export.title")}`,
      `${_t("scan.checklist.export.shop")}: ${shopDomain || _t("scan.checklist.export.unknown")}`,
      `${_t("scan.checklist.export.generatedAt")}: ${new Date().toLocaleString()}`,
      "",
      `## ${_t("scan.checklist.export.pendingItems")}`,
      ...items,
      "",
      `## ${_t("scan.checklist.export.quickLinks")}`,
      shopDomain ? `- ${_t("scan.checklist.export.pixelsAdmin")}: ${getShopifyAdminUrl(shopDomain, "/settings/notifications")}` : `- ${_t("scan.checklist.export.pixelsAdmin")}: ${_t("scan.checklist.export.needDomain")}`,
      shopDomain ? `- ${_t("scan.checklist.export.checkoutEditor")}: ${getShopifyAdminUrl(shopDomain, "/themes/current/editor")}` : `- ${_t("scan.checklist.export.checkoutEditor")}: ${_t("scan.checklist.export.needDomain")}`,
      `- ${_t("scan.checklist.export.migrationTool")}: /app/migrate`,
    ].join("\n");
  } else {
    return [
      _t("scan.checklist.export.title"),
      `${_t("scan.checklist.export.shop")}: ${shopDomain || _t("scan.checklist.export.unknown")}`,
      `${_t("scan.checklist.export.generatedAt")}: ${new Date().toLocaleString()}`,
      "",
      `${_t("scan.checklist.export.pendingItems")}:`,
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
