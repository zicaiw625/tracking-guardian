import { useMemo } from "react";
import {
  Card,
  BlockStack,
  Box,
  InlineStack,
  Text,
  Badge,
  Banner,
  Divider,
  RangeSlider,
  Button,
  Icon,
} from "@shopify/polaris";
import { AlertCircleIcon, CheckCircleIcon, ArrowRightIcon } from "~/components/icons";
import type { ScriptTag } from "../../types";
import { getPlatformName } from "./utils";
import { useTranslation, Trans } from "react-i18next";

interface ROIEstimatorProps {
  riskScore: number;
  scriptTags: ScriptTag[];
  identifiedPlatforms: string[];
  monthlyOrders: number;
  onMonthlyOrdersChange: (value: number) => void;
}

export function ROIEstimator({
  riskScore,
  scriptTags,
  identifiedPlatforms,
  monthlyOrders,
  onMonthlyOrdersChange,
}: ROIEstimatorProps) {
  const { t } = useTranslation();
  const roiEstimate = useMemo(() => {
    const platforms = identifiedPlatforms.length || 1;
    const scriptTagCount = scriptTags.length;
    const eventsLostPerMonth = monthlyOrders * platforms;
    const hasRisk = scriptTagCount > 0;
    return {
      eventsLostPerMonth,
      hasRisk,
      platforms,
      scriptTagCount,
    };
  }, [monthlyOrders, identifiedPlatforms, scriptTags]);

  if (riskScore === 0) return null;

  const getRiskLevelText = (score: number) => {
    if (score > 60) return t("scan.roiEstimator.comparison.current.risk.high");
    if (score > 30) return t("scan.roiEstimator.comparison.current.risk.medium");
    return t("scan.roiEstimator.comparison.current.risk.low");
  };

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            {t("scan.roiEstimator.title")}
          </Text>
          <Badge tone="info">{t("scan.roiEstimator.badge")}</Badge>
        </InlineStack>
        <Banner tone="warning">
          <Text as="p" variant="bodySm">
            <Trans i18nKey="scan.roiEstimator.disclaimer" />
          </Text>
        </Banner>
        <Box background="bg-surface-secondary" padding="400" borderRadius="200">
          <BlockStack gap="300">
            <Text as="p" fontWeight="semibold">
              {t("scan.roiEstimator.input.title")}
            </Text>
            <RangeSlider
              label={t("scan.roiEstimator.input.label")}
              value={monthlyOrders}
              onChange={(value) => onMonthlyOrdersChange(value as number)}
              output
              min={100}
              max={10000}
              step={100}
              suffix={
                <Text as="span" variant="bodySm">
                  {t("scan.roiEstimator.input.suffix", { count: monthlyOrders })}
                </Text>
              }
            />
          </BlockStack>
        </Box>
        <Box background="bg-fill-critical-secondary" padding="400" borderRadius="200">
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <Icon source={AlertCircleIcon} tone="critical" />
              <Text as="h3" variant="headingMd" tone="critical">
                {t("scan.roiEstimator.loss.title")}
              </Text>
            </InlineStack>
            <InlineStack gap="400" align="space-between" wrap>
              <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("scan.roiEstimator.loss.events.label")}
                  </Text>
                  <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                    {roiEstimate.eventsLostPerMonth.toLocaleString()}
                  </Text>
                  <Text as="p" variant="bodySm" tone="critical">
                    {t("scan.roiEstimator.loss.events.desc", { platformCount: roiEstimate.platforms, orders: monthlyOrders })}
                  </Text>
                </BlockStack>
              </Box>
              <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("scan.roiEstimator.loss.scriptTags.label")}
                  </Text>
                  <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                    {roiEstimate.scriptTagCount}
                  </Text>
                  <Text as="p" variant="bodySm" tone="critical">
                    {t("scan.roiEstimator.loss.scriptTags.desc")}
                  </Text>
                </BlockStack>
              </Box>
              <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("scan.roiEstimator.loss.impact.label")}
                  </Text>
                  <Text as="p" variant="headingLg" fontWeight="bold" tone="caution">
                    {t("scan.roiEstimator.loss.impact.title")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("scan.roiEstimator.loss.impact.desc")}
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
                        <Badge tone="critical">{t("scan.roiEstimator.loss.platform.invalid")}</Badge>
                        <Text as="span" fontWeight="semibold">{getPlatformName(platform, t)}</Text>
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="critical">
                        {t("scan.roiEstimator.loss.platform.reference")}
                      </Text>
                    </InlineStack>
                  </Box>
                ))
              ) : (
                <Text as="p" variant="bodySm">
                  {t("scan.roiEstimator.loss.allInvalid")}
                </Text>
              )}
            </BlockStack>
            <Banner tone="warning">
              <Text as="p" variant="bodySm">
                {t("scan.roiEstimator.loss.warning")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("scan.roiEstimator.loss.dataSource")}
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
                {t("scan.roiEstimator.gain.title")}
              </Text>
            </InlineStack>
            <InlineStack gap="400" align="space-between" wrap>
              <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("scan.roiEstimator.gain.events.label")}
                  </Text>
                  <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                    {roiEstimate.eventsLostPerMonth.toLocaleString()}
                  </Text>
                  <Text as="p" variant="bodySm" tone="success">
                    {t("scan.roiEstimator.gain.events.desc")}
                  </Text>
                </BlockStack>
              </Box>
              <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("scan.roiEstimator.gain.potential.label")}
                  </Text>
                  <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                    {t("scan.roiEstimator.gain.potential.title")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="success">
                    {t("scan.roiEstimator.gain.potential.desc")}
                  </Text>
                </BlockStack>
              </Box>
              <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("scan.roiEstimator.gain.webPixel.label")}
                  </Text>
                  <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                    {t("scan.roiEstimator.gain.webPixel.title")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="success">
                    {t("scan.roiEstimator.gain.webPixel.desc")}
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
                        <Badge tone="success">{t("scan.roiEstimator.gain.platform.restored")}</Badge>
                        <Text as="span" fontWeight="semibold">{getPlatformName(platform, t)}</Text>
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="success">
                        {t("scan.roiEstimator.gain.platform.desc", { orders: monthlyOrders.toLocaleString() })}
                      </Text>
                    </InlineStack>
                  </Box>
                ))
              ) : (
                <Text as="p" variant="bodySm">
                  {t("scan.roiEstimator.gain.allRestored")}
                </Text>
              )}
            </BlockStack>
            <Banner tone="success">
              <Text as="p" variant="bodySm">
                {t("scan.roiEstimator.gain.coreValue")}
              </Text>
            </Banner>
          </BlockStack>
        </Box>
        <Divider />
        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">
            {t("scan.roiEstimator.comparison.title")}
          </Text>
          <InlineStack gap="400" align="space-between" wrap={false}>
            <Box
              background="bg-surface-critical"
              padding="300"
              borderRadius="200"
              minWidth="200px"
            >
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("scan.roiEstimator.comparison.current.label")}
                </Text>
                <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                  {getRiskLevelText(riskScore)}
                </Text>
                <Text as="p" variant="bodySm" tone="critical">
                  {t("scan.roiEstimator.comparison.current.desc", { count: scriptTags.length })}
                </Text>
              </BlockStack>
            </Box>
            <Box padding="300">
              <Icon source={ArrowRightIcon} tone="subdued" />
            </Box>
            <Box
              background="bg-surface-success"
              padding="300"
              borderRadius="200"
              minWidth="200px"
            >
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("scan.roiEstimator.comparison.after.label")}
                </Text>
                <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                  {t("scan.roiEstimator.comparison.after.title")}
                </Text>
                <Text as="p" variant="bodySm" tone="success">
                  {t("scan.roiEstimator.comparison.after.desc")}
                </Text>
              </BlockStack>
            </Box>
            <Box padding="300">
              <Icon source={ArrowRightIcon} tone="subdued" />
            </Box>
            <Box
              background="bg-surface-success"
              padding="300"
              borderRadius="200"
              minWidth="200px"
            >
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("scan.roiEstimator.comparison.extra.label")}
                </Text>
                <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                  {t("scan.roiEstimator.comparison.extra.title")}
                </Text>
                <Text as="p" variant="bodySm" tone="success">
                  {t("scan.roiEstimator.comparison.extra.desc")}
                </Text>
              </BlockStack>
            </Box>
          </InlineStack>
          <Banner tone="info" title={t("scan.roiEstimator.comparison.certainty.title")}>
            <Text as="p" variant="bodySm">
              <Trans i18nKey="scan.roiEstimator.comparison.certainty.content" components={{ br: <br />, span: <span /> }} />
            </Text>
          </Banner>
        </BlockStack>
        <InlineStack align="end" gap="200">
          <Button url="/app/migrate" variant="primary">
            {t("scan.roiEstimator.action")}
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}