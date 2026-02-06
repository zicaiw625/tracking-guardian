
import { Card, Text, BlockStack, InlineStack, Badge, Box, Banner, Divider, Icon, RangeSlider, Button } from "@shopify/polaris";
import { AlertCircleIcon, CheckCircleIcon, ArrowRightIcon } from "~/components/icons";
import { getPlatformName } from "~/components/scan/utils";
import { calculateROIEstimate } from "~/utils/scan-format";
import { useTranslation, Trans } from "react-i18next";

interface MigrationImpactAnalysisProps {
  latestScan: {
    riskScore: number;
  };
  identifiedPlatforms: string[];
  scriptTags: Array<{ id: number }>;
  monthlyOrders: number;
  onMonthlyOrdersChange: (value: number) => void;
}

export function MigrationImpactAnalysis({
  latestScan,
  identifiedPlatforms,
  scriptTags,
  monthlyOrders,
  onMonthlyOrdersChange,
}: MigrationImpactAnalysisProps) {
  const { t } = useTranslation();
  const roiEstimate = calculateROIEstimate(monthlyOrders, identifiedPlatforms.length, scriptTags.length);

  if (!latestScan.riskScore || latestScan.riskScore === 0) {
    return null;
  }

  const getRiskLevelText = (score: number) => {
    if (score > 60) return t("scan.impactAnalysis.comparison.current.risk.high");
    if (score > 30) return t("scan.impactAnalysis.comparison.current.risk.medium");
    return t("scan.impactAnalysis.comparison.current.risk.low");
  };

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            {t("scan.impactAnalysis.title")}
          </Text>
          <Badge tone="info">{t("scan.impactAnalysis.badge")}</Badge>
        </InlineStack>
        <Banner tone="warning">
          <Text as="p" variant="bodySm">
            <Trans i18nKey="scan.impactAnalysis.disclaimer" />
          </Text>
        </Banner>
        <Box background="bg-surface-secondary" padding="400" borderRadius="200">
          <BlockStack gap="300">
            <Text as="p" fontWeight="semibold">
              {t("scan.impactAnalysis.monthlyOrders.title")}
            </Text>
            <RangeSlider
              label={t("scan.impactAnalysis.monthlyOrders.label")}
              value={monthlyOrders}
              onChange={(value) => onMonthlyOrdersChange(value as number)}
              output
              min={100}
              max={10000}
              step={100}
              suffix={<Text as="span" variant="bodySm">{t("scan.impactAnalysis.monthlyOrders.suffix", { count: monthlyOrders })}</Text>}
            />
          </BlockStack>
        </Box>
        <Box background="bg-fill-critical-secondary" padding="400" borderRadius="200">
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <Icon source={AlertCircleIcon} tone="critical" />
              <Text as="h3" variant="headingMd" tone="critical">
                {t("scan.impactAnalysis.loss.title")}
              </Text>
            </InlineStack>
            <InlineStack gap="400" align="space-between" wrap>
              <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">{t("scan.impactAnalysis.loss.events.label")}</Text>
                  <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                    {roiEstimate.eventsLostPerMonth.toLocaleString()}
                  </Text>
                  <Text as="p" variant="bodySm" tone="critical">
                    {t("scan.impactAnalysis.loss.events.desc", { platformCount: roiEstimate.platforms, orders: monthlyOrders })}
                  </Text>
                </BlockStack>
              </Box>
              <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">{t("scan.impactAnalysis.loss.scriptTags.label")}</Text>
                  <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                    {roiEstimate.scriptTagCount}
                  </Text>
                  <Text as="p" variant="bodySm" tone="critical">
                    {t("scan.impactAnalysis.loss.scriptTags.desc")}
                  </Text>
                </BlockStack>
              </Box>
              <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">{t("scan.impactAnalysis.loss.impact.label")}</Text>
                  <Text as="p" variant="headingLg" fontWeight="bold" tone="caution">
                    {t("scan.impactAnalysis.loss.impact.title")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("scan.impactAnalysis.loss.impact.desc")}
                  </Text>
                </BlockStack>
              </Box>
            </InlineStack>
            <BlockStack gap="200">
              {identifiedPlatforms.length > 0 ? (
                identifiedPlatforms.map((platform) => (
                  <Box key={platform} background="bg-surface" padding="300" borderRadius="100">
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="200">
                        <Badge tone="critical">{t("scan.impactAnalysis.loss.platform.invalid")}</Badge>
                        <Text as="span" fontWeight="semibold">{getPlatformName(platform, t)}</Text>
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="critical">
                        {t("scan.impactAnalysis.loss.platform.reference")}
                      </Text>
                    </InlineStack>
                  </Box>
                ))
              ) : (
                <Text as="p" variant="bodySm">
                  {t("scan.impactAnalysis.loss.allInvalid")}
                </Text>
              )}
            </BlockStack>
            <Banner tone="warning">
              <Text as="p" variant="bodySm">
                <Trans i18nKey="scan.impactAnalysis.loss.warning" />
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                <Trans i18nKey="scan.impactAnalysis.loss.dateSource" />
              </Text>
            </Banner>
          </BlockStack>
        </Box>
        <Divider />
        <Box background="bg-fill-success-secondary" padding="400" borderRadius="200">
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <Icon source={CheckCircleIcon} tone="success" />
              <Text as="h3" variant="headingMd" tone="success">
                {t("scan.impactAnalysis.gain.title")}
              </Text>
            </InlineStack>
            <InlineStack gap="400" align="space-between" wrap>
              <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">{t("scan.impactAnalysis.gain.events.label")}</Text>
                  <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                    {roiEstimate.eventsLostPerMonth.toLocaleString()}
                  </Text>
                  <Text as="p" variant="bodySm" tone="success">
                    {t("scan.impactAnalysis.gain.events.desc")}
                  </Text>
                </BlockStack>
              </Box>
              <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">{t("scan.impactAnalysis.gain.potential.label")}</Text>
                  <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                    {t("scan.impactAnalysis.gain.potential.title")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="success">
                    {t("scan.impactAnalysis.gain.potential.desc")}
                  </Text>
                </BlockStack>
              </Box>
              <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">{t("scan.impactAnalysis.gain.webPixel.label")}</Text>
                  <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                    {t("scan.impactAnalysis.gain.webPixel.title")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="success">
                    {t("scan.impactAnalysis.gain.webPixel.desc")}
                  </Text>
                </BlockStack>
              </Box>
            </InlineStack>
            <BlockStack gap="200">
              {identifiedPlatforms.length > 0 ? (
                identifiedPlatforms.map((platform) => (
                  <Box key={platform} background="bg-surface" padding="300" borderRadius="100">
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="200">
                        <Badge tone="success">{t("scan.impactAnalysis.gain.platform.restored")}</Badge>
                        <Text as="span" fontWeight="semibold">{getPlatformName(platform, t)}</Text>
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="success">
                        {t("scan.impactAnalysis.gain.platform.desc", { orders: monthlyOrders.toLocaleString() })}
                      </Text>
                    </InlineStack>
                  </Box>
                ))
              ) : (
                <Text as="p" variant="bodySm">
                  {t("scan.impactAnalysis.gain.allRestored")}
                </Text>
              )}
            </BlockStack>
            <Banner tone="success">
              <Text as="p" variant="bodySm">
                <Trans i18nKey="scan.impactAnalysis.gain.coreValue" />
              </Text>
            </Banner>
          </BlockStack>
        </Box>
        <Divider />
        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">
            {t("scan.impactAnalysis.comparison.title")}
          </Text>
          <InlineStack gap="400" align="space-between" wrap={false}>
            <Box background="bg-surface-critical" padding="300" borderRadius="200" minWidth="200px">
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">{t("scan.impactAnalysis.comparison.current.label")}</Text>
                <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                  {getRiskLevelText(latestScan.riskScore)}
                </Text>
                <Text as="p" variant="bodySm" tone="critical">
                  {t("scan.impactAnalysis.comparison.current.desc", { count: scriptTags.length })}
                </Text>
              </BlockStack>
            </Box>
            <Box padding="300">
              <Icon source={ArrowRightIcon} tone="subdued" />
            </Box>
            <Box background="bg-surface-success" padding="300" borderRadius="200" minWidth="200px">
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">{t("scan.impactAnalysis.comparison.after.label")}</Text>
                <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                  {t("scan.impactAnalysis.comparison.after.title")}
                </Text>
                <Text as="p" variant="bodySm" tone="success">
                  {t("scan.impactAnalysis.comparison.after.desc")}
                </Text>
              </BlockStack>
            </Box>
            <Box padding="300">
              <Icon source={ArrowRightIcon} tone="subdued" />
            </Box>
            <Box background="bg-surface-success" padding="300" borderRadius="200" minWidth="200px">
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">{t("scan.impactAnalysis.comparison.extra.label")}</Text>
                <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                  {t("scan.impactAnalysis.comparison.extra.title")}
                </Text>
                <Text as="p" variant="bodySm" tone="success">
                  {t("scan.impactAnalysis.comparison.extra.desc")}
                </Text>
              </BlockStack>
            </Box>
          </InlineStack>
          <Banner tone="info" title={t("scan.impactAnalysis.comparison.v1.title")}>
            <Text as="p" variant="bodySm">
              <Trans i18nKey="scan.impactAnalysis.comparison.v1.content" />
            </Text>
          </Banner>
        </BlockStack>
        <InlineStack align="end" gap="200">
          <Button url="/app/migrate" variant="primary">
            {t("scan.impactAnalysis.action")}
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
