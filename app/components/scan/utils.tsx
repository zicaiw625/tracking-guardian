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
  const map: Record<string, string> = t
    ? {
        "google-analytics": t("platforms.google_analytics"),
        "facebook-pixel": t("platforms.meta_pixel"),
        tiktok: t("platforms.tiktok_pixel"),
        pinterest: t("platforms.pinterest_tag"),
        snapchat: t("platforms.snapchat_pixel"),
        bing: t("platforms.microsoft_ads"),
        twitter: t("platforms.twitter_pixel"),
        linkedin: t("platforms.linkedin_tag"),
        criteo: t("platforms.criteo_onetag"),
        taboola: t("platforms.taboola_pixel"),
        outbrain: t("platforms.outbrain_pixel"),
        reddit: t("platforms.reddit_pixel"),
        quora: t("platforms.quora_pixel"),
        "klaviyo-onsite": t("platforms.klaviyo_onsite"),
      }
    : {
        "google-analytics": "Google Analytics 4 (GA4)",
        "facebook-pixel": "Meta (Facebook) Pixel",
        tiktok: "TikTok Pixel",
        pinterest: "Pinterest Tag",
        snapchat: "Snapchat Pixel",
        bing: "Microsoft (Bing) Ads",
        twitter: "X (Twitter) Pixel",
        linkedin: "LinkedIn Insight Tag",
        criteo: "Criteo OneTag",
        taboola: "Taboola Pixel",
        outbrain: "Outbrain Pixel",
        reddit: "Reddit Pixel",
        quora: "Quora Pixel",
        "klaviyo-onsite": "Klaviyo Onsite",
      };

  const normalized = platform?.toLowerCase().replace(/_/g, "-");
  return map[normalized] || platform;
}
