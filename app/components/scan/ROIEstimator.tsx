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
import { useTranslation } from "react-i18next";

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
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            {t("roiEstimator.title")}
          </Text>
          <Badge tone="info">{t("roiEstimator.badge")}</Badge>
        </InlineStack>
        <Banner tone="warning">
          <Text as="p" variant="bodySm">
            <strong>{t("roiEstimator.disclaimer.title")}</strong>
            {t("roiEstimator.disclaimer.content")}
          </Text>
        </Banner>
        <Box background="bg-surface-secondary" padding="400" borderRadius="200">
          <BlockStack gap="300">
            <Text as="p" fontWeight="semibold">
              {t("roiEstimator.input.label")}
            </Text>
            <RangeSlider
              label={t("roiEstimator.input.sliderLabel")}
              value={monthlyOrders}
              onChange={(value) => onMonthlyOrdersChange(value as number)}
              output
              min={100}
              max={10000}
              step={100}
              suffix={
                <Text as="span" variant="bodySm">
                  {monthlyOrders} {t("roiEstimator.input.unit")}
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
                {t("roiEstimator.impact.title")}
              </Text>
            </InlineStack>
            <InlineStack gap="400" align="space-between" wrap>
              <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("roiEstimator.impact.events.label")}
                  </Text>
                  <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                    {roiEstimate.eventsLostPerMonth.toLocaleString()}
                  </Text>
                  <Text as="p" variant="bodySm" tone="critical">
                    {t("roiEstimator.impact.events.detail", {
                      platforms: roiEstimate.platforms,
                      orders: monthlyOrders,
                    })}
                  </Text>
                </BlockStack>
              </Box>
              <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("roiEstimator.impact.scripts.label")}
                  </Text>
                  <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                    {roiEstimate.scriptTagCount}
                  </Text>
                  <Text as="p" variant="bodySm" tone="critical">
                    {t("roiEstimator.impact.scripts.detail")}
                  </Text>
                </BlockStack>
              </Box>
              <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("roiEstimator.impact.actual.label")}
                  </Text>
                  <Text as="p" variant="headingLg" fontWeight="bold" tone="caution">
                    {t("roiEstimator.impact.actual.value")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("roiEstimator.impact.actual.detail")}
                  </Text>
                </BlockStack>
              </Box>
            </InlineStack>
          </BlockStack>
        </Box>
        <Divider />
        <Box background="bg-fill-success-secondary" padding="400" borderRadius="200">
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <Icon source={CheckCircleIcon} tone="success" />
              <Text as="h3" variant="headingMd" tone="success">
                {t("roiEstimator.recovery.title")}
              </Text>
            </InlineStack>
            <InlineStack gap="400" align="space-between" wrap>
              <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("roiEstimator.recovery.events.label")}
                  </Text>
                  <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                    {roiEstimate.eventsLostPerMonth.toLocaleString()}
                  </Text>
                  <Text as="p" variant="bodySm" tone="success">
                    {t("roiEstimator.recovery.events.detail")}
                  </Text>
                </BlockStack>
              </Box>
              <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("roiEstimator.recovery.potential.label")}
                  </Text>
                  <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                    {t("roiEstimator.recovery.potential.value")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="success">
                    {t("roiEstimator.recovery.potential.detail")}
                  </Text>
                </BlockStack>
              </Box>
              <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("roiEstimator.recovery.monitoring.label")}
                  </Text>
                  <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                    {t("roiEstimator.recovery.monitoring.value")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="success">
                    {t("roiEstimator.recovery.monitoring.detail")}
                  </Text>
                </BlockStack>
              </Box>
            </InlineStack>
          </BlockStack>
        </Box>
        <Divider />
        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">
            {t("roiEstimator.comparison.title")}
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
                  {t("roiEstimator.comparison.current.label")}
                </Text>
                <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                  {riskScore > 60
                    ? t("roiEstimator.comparison.current.risk.high")
                    : riskScore > 30
                    ? t("roiEstimator.comparison.current.risk.medium")
                    : t("roiEstimator.comparison.current.risk.low")}
                </Text>
                <Text as="p" variant="bodySm" tone="critical">
                  {t("roiEstimator.comparison.current.detail", { count: scriptTags.length })}
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
                  {t("roiEstimator.comparison.after.label")}
                </Text>
                <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                  {t("roiEstimator.comparison.after.value")}
                </Text>
                <Text as="p" variant="bodySm" tone="success">
                  {t("roiEstimator.comparison.after.detail")}
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
                  {t("roiEstimator.comparison.extra.label")}
                </Text>
                <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                  {t("roiEstimator.comparison.extra.value")}
                </Text>
                <Text as="p" variant="bodySm" tone="success">
                  {t("roiEstimator.comparison.extra.detail")}
                </Text>
              </BlockStack>
            </Box>
          </InlineStack>
          <Banner tone="info" title={t("roiEstimator.benefits.title")}>
            <Text as="p" variant="bodySm">
              ✅ {t("roiEstimator.benefits.list.item1")}
              <br />
              ✅ {t("roiEstimator.benefits.list.item2")}
              <br />
              ✅ {t("roiEstimator.benefits.list.item3")}
              <br />
              <Text as="span" tone="subdued">
                {t("roiEstimator.benefits.note")}
              </Text>
            </Text>
          </Banner>
        </BlockStack>
        <InlineStack align="end" gap="200">
          <Button url="/app/migrate" variant="primary">
            {t("roiEstimator.action")}
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
