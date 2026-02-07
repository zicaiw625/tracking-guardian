import { Card, BlockStack, Box, Text } from "@shopify/polaris";

interface RiskScoreCardProps {
  riskScore: number;
  createdAt: string;
}

import { useTranslation } from "react-i18next";

export function RiskScoreCard({ riskScore, createdAt }: RiskScoreCardProps) {
  const { t, i18n } = useTranslation();
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          {t("scan.riskScore")}
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
          {t("scan.scanTime")}: {new Date(createdAt).toLocaleString(i18n.language)}
        </Text>
      </BlockStack>
    </Card>
  );
}
