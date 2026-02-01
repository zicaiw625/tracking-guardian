import { Card, BlockStack, Box, Text } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

interface RiskScoreCardProps {
  riskScore: number;
  createdAt: string;
}

export function RiskScoreCard({ riskScore, createdAt }: RiskScoreCardProps) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? i18n.language)?.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          {t("scan.riskScoreCard.title")}
        </Text>
        <Box
          background={
            riskScore > 60
              ? "bg-fill-critical"
              : riskScore > 30
              ? "bg-fill-warning"
              : "bg-fill-success"
          }
          padding="600"
          borderRadius="200"
        >
          <BlockStack gap="200" align="center">
            <Text as="p" variant="heading3xl" fontWeight="bold">
              {riskScore}
            </Text>
            <Text as="p" variant="bodySm">
              / 100
            </Text>
          </BlockStack>
        </Box>
        <Text as="p" variant="bodySm" tone="subdued">
          {t("scan.riskScoreCard.scanTime", { time: new Date(createdAt).toLocaleString(locale) })}
        </Text>
      </BlockStack>
    </Card>
  );
}
