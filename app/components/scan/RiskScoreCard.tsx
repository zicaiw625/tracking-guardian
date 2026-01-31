import { Card, BlockStack, Box, Text } from "@shopify/polaris";
import { useLocale, useT } from "~/context/LocaleContext";

interface RiskScoreCardProps {
  riskScore: number;
  createdAt: string;
}

export function RiskScoreCard({ riskScore, createdAt }: RiskScoreCardProps) {
  const { locale } = useLocale();
  const t = useT();
  const dateLocale = locale === "zh" ? "zh-CN" : "en";
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          {t("scan.riskScoreTitle")}
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
          {t("scan.scanTime")}: {new Date(createdAt).toLocaleString(dateLocale)}
        </Text>
      </BlockStack>
    </Card>
  );
}
