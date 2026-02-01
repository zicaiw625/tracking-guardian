import { Badge } from "@shopify/polaris";
import type { TFunction } from "i18next";

export function getPlatformName(platform: string, t?: TFunction): string {
  if (t) {
    const key = `scan.utils.platform.${platform}`;
    const translated = t(key);
    // If translation returns key (meaning missing), fallback to names map or platform
    if (translated !== key) return translated;
  }
  
  const names: Record<string, string> = {
    google: "GA4",
    meta: "Meta (Facebook) Pixel",
    tiktok: "TikTok Pixel",
    bing: "Microsoft Ads (Bing) ⚠️",
    clarity: "Microsoft Clarity ⚠️",
    webhook: "通用 Webhook",
  };
  return names[platform] || platform;
}

export function getSeverityBadge(severity: string, t?: TFunction) {
  const text = t ? {
      high: t("scan.utils.severity.high"),
      medium: t("scan.utils.severity.medium"),
      low: t("scan.utils.severity.low"),
      unknown: t("scan.utils.severity.unknown")
  } : {
      high: "高风险",
      medium: "中风险",
      low: "低风险",
      unknown: "未知"
  };

  switch (severity) {
    case "high":
      return <Badge tone="critical">{text.high}</Badge>;
    case "medium":
      return <Badge tone="warning">{text.medium}</Badge>;
    case "low":
      return <Badge tone="info">{text.low}</Badge>;
    default:
      return <Badge>{text.unknown}</Badge>;
  }
}

export function getUpgradeBannerTone(urgency: string): "critical" | "warning" | "info" | "success" {
  switch (urgency) {
    case "critical": return "critical";
    case "high": return "warning";
    case "medium": return "warning";
    case "resolved": return "success";
    default: return "info";
  }
}

export function getStatusText(status: string | null | undefined, t?: TFunction): string {
  const text = t ? {
      completed: t("scan.utils.status.completed"),
      completedWithErrors: t("scan.utils.status.completedWithErrors"),
      failed: t("scan.utils.status.failed"),
      scanning: t("scan.utils.status.scanning"),
      pending: t("scan.utils.status.pending"),
      unknown: t("scan.utils.status.unknown")
  } : {
      completed: "完成",
      completedWithErrors: "完成（有错误）",
      failed: "失败",
      scanning: "扫描中",
      pending: "等待中",
      unknown: "未知"
  };

  if (!status) return text.unknown;
  switch (status) {
    case "completed": return text.completed;
    case "completed_with_errors": return text.completedWithErrors;
    case "failed": return text.failed;
    case "scanning": return text.scanning;
    case "pending": return text.pending;
    default: return status;
  }
}
