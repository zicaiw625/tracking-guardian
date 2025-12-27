import { Badge } from "@shopify/polaris";

export function getPlatformName(platform: string): string {
  const names: Record<string, string> = {
    google: "GA4 (Measurement Protocol)",
    meta: "Meta (Facebook) Pixel",
    tiktok: "TikTok Pixel",
    bing: "Microsoft Ads (Bing) ⚠️",
    clarity: "Microsoft Clarity ⚠️",
    pinterest: "Pinterest Tag",
    snapchat: "Snapchat Pixel",
    twitter: "Twitter/X Pixel",
    webhook: "通用 Webhook",
  };
  return names[platform] || platform;
}

export function getSeverityBadge(severity: string) {
  switch (severity) {
    case "high":
      return <Badge tone="critical">高风险</Badge>;
    case "medium":
      return <Badge tone="warning">中风险</Badge>;
    case "low":
      return <Badge tone="info">低风险</Badge>;
    default:
      return <Badge>未知</Badge>;
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
