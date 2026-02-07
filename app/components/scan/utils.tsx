import { Badge } from "@shopify/polaris";
import type { TFunction } from "i18next";

export function getSeverityBadge(severity: string, t?: TFunction) {
  const text = t
    ? {
        high: t("scan.utils.severity.high"),
        medium: t("scan.utils.severity.medium"),
        low: t("scan.utils.severity.low"),
        unknown: t("scan.utils.severity.unknown"),
      }
    : {
        high: "scan.utils.severity.high",
        medium: "scan.utils.severity.medium",
        low: "scan.utils.severity.low",
        unknown: "scan.utils.severity.unknown",
      };

  const severityLower = severity?.toLowerCase() || "unknown";
  // @ts-expect-error - mapping keys might not match enum exactly
  const badgeContent = text[severityLower] || text.unknown;

  switch (severityLower) {
    case "high":
      return <Badge tone="critical">{badgeContent}</Badge>;
    case "medium":
      return <Badge tone="warning">{badgeContent}</Badge>;
    case "low":
      return <Badge tone="info">{badgeContent}</Badge>;
    default:
      return <Badge>{badgeContent}</Badge>;
  }
}

export function getUpgradeBannerTone(riskScoreOrUrgency: number | string) {
  if (typeof riskScoreOrUrgency === 'number') {
    const riskScore = riskScoreOrUrgency;
    if (riskScore >= 80) return "critical";
    if (riskScore >= 50) return "warning";
    return "info";
  } else {
    const urgency = riskScoreOrUrgency;
    if (urgency === "critical") return "critical";
    if (urgency === "high") return "warning";
    return "info";
  }
}

export function getStatusText(status: string, t?: TFunction) {
  const map = t
    ? {
        pending: t("onboarding.progress.status.pending"),
        processing: t("onboarding.progress.status.processing"),
        completed: t("onboarding.progress.status.completed"),
        failed: t("onboarding.progress.status.error"),
      }
    : {
        pending: "onboarding.progress.status.pending",
        processing: "onboarding.progress.status.processing",
        completed: "onboarding.progress.status.completed",
        failed: "onboarding.progress.status.error",
      };
  // @ts-expect-error - status string might not be in map keys
  return map[status] || status;
}

export function getPlatformName(platform: string, t?: TFunction) {
  const normalized = platform?.toLowerCase().replace(/_/g, "-");

  if (t) {
    const map: Record<string, string> = {
      "google-analytics": t("platforms.google-analytics"),
      "facebook-pixel": t("platforms.facebook-pixel"),
      "tiktok": t("platforms.tiktok"),
      "pinterest": t("platforms.pinterest"),
      "snapchat": t("platforms.snapchat"),
      "bing": t("platforms.bing"),
      "twitter": t("platforms.twitter"),
      "linkedin": t("platforms.linkedin"),
      "criteo": t("platforms.criteo"),
      "taboola": t("platforms.taboola"),
      "outbrain": t("platforms.outbrain"),
      "reddit": t("platforms.reddit"),
      "quora": t("platforms.quora"),
      "klaviyo-onsite": t("platforms.klaviyo-onsite"),
    };
    return map[normalized] || platform;
  }

  const map: Record<string, string> = {
    "google-analytics": "Google Analytics 4 (GA4)",
    "facebook-pixel": "Meta (Facebook) Pixel",
    "tiktok": "TikTok Pixel",
    "pinterest": "Pinterest Tag",
    "snapchat": "Snapchat Pixel",
    "bing": "Microsoft (Bing) Ads",
    "twitter": "X (Twitter) Pixel",
    "linkedin": "LinkedIn Insight Tag",
    "criteo": "Criteo OneTag",
    "taboola": "Taboola Pixel",
    "outbrain": "Outbrain Pixel",
    "reddit": "Reddit Pixel",
    "quora": "Quora Pixel",
    "klaviyo-onsite": "Klaviyo Onsite",
  };

  return map[normalized] || platform;
}
