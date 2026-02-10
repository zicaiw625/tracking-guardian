import { Badge, Box, BlockStack, Text } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

export function ScoreCard({
  title,
  score,
  description,
  tone,
}: {
  title: string;
  score: number;
  description: string;
  tone: "success" | "warning" | "critical";
}) {
  return (
    <Box
      background={
        tone === "success"
          ? "bg-fill-success-secondary"
          : tone === "warning"
            ? "bg-fill-warning-secondary"
            : "bg-fill-critical-secondary"
      }
      padding="400"
      borderRadius="200"
    >
      <BlockStack gap="200">
        <Text as="p" variant="bodySm" tone="subdued">
          {title}
        </Text>
        <Text as="p" variant="heading2xl" fontWeight="bold">
          {score}%
        </Text>
        <Text as="p" variant="bodySm">
          {description}
        </Text>
      </BlockStack>
    </Box>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  switch (status) {
    case "success":
      return <Badge tone="success">{t("verification.badges.passed")}</Badge>;
    case "failed":
      return <Badge tone="critical">{t("verification.badges.failed")}</Badge>;
    case "missing_params":
      return <Badge tone="warning">{t("verification.badges.missing_params")}</Badge>;
    case "warning":
      return <Badge tone="warning">{t("verification.badges.warning")}</Badge>;
    case "deduplicated":
      return <Badge tone="info">{t("verification.badges.deduplicated")}</Badge>;
    case "not_tested":
      return <Badge>{t("verification.badges.not_tested")}</Badge>;
    case "completed":
      return <Badge tone="success">{t("verification.badges.completed")}</Badge>;
    case "running":
      return <Badge tone="info">{t("verification.badges.running")}</Badge>;
    case "pending":
      return <Badge>{t("verification.badges.pending")}</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

export function PlatformBadge({ platform }: { platform: string }) {
  const names: Record<string, string> = {
    google: "GA4",
    meta: "Meta",
    tiktok: "TikTok",
  };
  return <Badge>{names[platform] || platform}</Badge>;
}
