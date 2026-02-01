import {
  Layout,
  Card,
  BlockStack,
  Box,
  InlineStack,
  Text,
  Badge,
  Icon,
} from "@shopify/polaris";
import { CheckCircleIcon } from "~/components/icons";
import type { ScriptAnalysisResult } from "../../services/scanner/types";
import { getPlatformName } from "./utils";
import { useTranslation } from "react-i18next";

interface AnalysisResultSummaryProps {
  analysisResult: ScriptAnalysisResult;
}

export function AnalysisResultSummary({ analysisResult }: AnalysisResultSummaryProps) {
  const { t } = useTranslation();
  return (
    <Layout>
      <Layout.Section variant="oneThird">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              {t("scan.analysisResult.riskScore")}
            </Text>
            <Box
              background={
                analysisResult.riskScore > 60
                  ? "bg-fill-critical"
                  : analysisResult.riskScore > 30
                  ? "bg-fill-warning"
                  : "bg-fill-success"
              }
              padding="600"
              borderRadius="200"
            >
              <BlockStack gap="200" align="center">
                <Text as="p" variant="heading3xl" fontWeight="bold">
                  {analysisResult.riskScore}
                </Text>
                <Text as="p" variant="bodySm">
                  / 100
                </Text>
              </BlockStack>
            </Box>
          </BlockStack>
        </Card>
      </Layout.Section>
      <Layout.Section variant="oneThird">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              {t("scan.analysisResult.detectedPlatforms")}
            </Text>
            {analysisResult.identifiedPlatforms.length > 0 ? (
              <BlockStack gap="200">
                {analysisResult.identifiedPlatforms.map((platform) => (
                  <InlineStack key={platform} gap="200" align="start">
                    <Icon source={CheckCircleIcon} tone="success" />
                    <Text as="span">{getPlatformName(platform, t)}</Text>
                  </InlineStack>
                ))}
              </BlockStack>
            ) : (
              <Text as="p" tone="subdued">
                {t("scan.analysisResult.noPlatforms")}
              </Text>
            )}
          </BlockStack>
        </Card>
      </Layout.Section>
      <Layout.Section variant="oneThird">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              {t("scan.analysisResult.details")}
            </Text>
            {analysisResult.platformDetails.length > 0 ? (
              <BlockStack gap="200">
                {analysisResult.platformDetails.slice(0, 5).map((detail, idx) => (
                  <Box
                    key={idx}
                    background="bg-surface-secondary"
                    padding="200"
                    borderRadius="100"
                  >
                    <BlockStack gap="100">
                      <InlineStack gap="200" align="space-between">
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          {detail.type}
                        </Text>
                        <Badge tone={detail.confidence === "high" ? "success" : "info"}>
                          {detail.confidence === "high" ? t("scan.analysisResult.confidence.high") : t("scan.analysisResult.confidence.medium")}
                        </Badge>
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {detail.matchedPattern}
                      </Text>
                    </BlockStack>
                  </Box>
                ))}
              </BlockStack>
            ) : (
              <Text as="p" tone="subdued">
                {t("scan.analysisResult.noDetails")}
              </Text>
            )}
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );
}
