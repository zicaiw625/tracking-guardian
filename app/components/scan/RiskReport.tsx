import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  ProgressBar,
  List,
  Box,
  Divider,
} from "@shopify/polaris";
import { useTranslation, Trans } from "react-i18next";

export interface RiskReportItem {
  id: string;
  displayName: string;
  riskLevel: "high" | "medium" | "low";
  platform?: string;
  description: string;
  estimatedTimeMinutes: number;
  suggestedMigration?: "web_pixel" | "ui_extension" | string;
}

export interface EnhancedRiskReport {
  summary: {
    totalItems: number;
    highRiskCount: number;
    mediumRiskCount: number;
    lowRiskCount: number;
    totalEstimatedTime: number;
  };
  items: RiskReportItem[];
  categories: {
    willFail: RiskReportItem[];
    canReplace: RiskReportItem[];
    noMigrationNeeded: RiskReportItem[];
  };
}

export interface RiskReportProps {
  report: EnhancedRiskReport;
  onItemClick?: (itemId: string) => void;
}

export function RiskReport({ report, onItemClick }: RiskReportProps) {
  const { t } = useTranslation();
  const { summary, categories } = report;
  const getRiskBadge = (riskLevel: "high" | "medium" | "low") => {
    switch (riskLevel) {
      case "high":
        return <Badge tone="critical">{t("riskReport.highRisk")}</Badge>;
      case "medium":
        return <Badge tone="warning">{t("riskReport.mediumRisk")}</Badge>;
      case "low":
        return <Badge tone="info">{t("riskReport.lowRisk")}</Badge>;
    }
  };
  const calculateRiskScore = () => {
    if (summary.totalItems === 0) return 0;
    const highRiskWeight = categories.willFail.length * 3;
    const mediumRiskWeight = categories.canReplace.length * 2;
    const lowRiskWeight = categories.noMigrationNeeded.length * 1;
    const totalWeight = highRiskWeight + mediumRiskWeight + lowRiskWeight;
    const maxWeight = summary.totalItems * 3;
    return Math.round((totalWeight / maxWeight) * 100);
  };
  const riskScore = calculateRiskScore();
  const riskLevel = riskScore >= 70 ? "high" : riskScore >= 40 ? "medium" : "low";
  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between">
            <Text variant="headingMd" as="h2">
              {t("riskReport.title")}
            </Text>
            {getRiskBadge(riskLevel)}
          </InlineStack>
          <Box>
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text variant="bodyMd" as="span">
                  {t("riskReport.riskScore")}
                </Text>
                <Text variant="headingLg" as="span" tone={riskLevel === "high" ? "critical" : riskLevel === "medium" ? undefined : undefined}>
                  {`${riskScore}/100`}
                </Text>
              </InlineStack>
              <ProgressBar progress={riskScore} size="small" />
            </BlockStack>
          </Box>
          <Divider />
          <BlockStack gap="300">
            <Text variant="headingSm" as="h3">
              {t("riskReport.summaryTitle")}
            </Text>
            <List type="bullet">
              <List.Item>
                <Trans i18nKey="riskReport.totalItems" values={{ count: summary.totalItems }} components={{ strong: <strong /> }} />
              </List.Item>
              <List.Item>
                {t("riskReport.highRisk")}: <strong>{summary.highRiskCount}</strong>
              </List.Item>
              <List.Item>
                {t("riskReport.mediumRisk")}: <strong>{summary.mediumRiskCount}</strong>
              </List.Item>
              <List.Item>
                {t("riskReport.lowRisk")}: <strong>{summary.lowRiskCount}</strong>
              </List.Item>
              <List.Item>
                <Trans i18nKey="riskReport.estimatedTime" values={{ time: summary.totalEstimatedTime }} components={{ strong: <strong /> }} />
              </List.Item>
            </List>
          </BlockStack>
        </BlockStack>
      </Card>
      {categories.willFail.length > 0 && (
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text variant="headingMd" as="h2">
                {t("riskReport.categoryWillFail")}
              </Text>
              <Badge tone="critical">{String(categories.willFail.length)}</Badge>
            </InlineStack>
            <List>
              {categories.willFail.map((item: RiskReportItem) => (
                <List.Item key={item.id}>
                  <div
                    onClick={onItemClick ? () => onItemClick(item.id) : undefined}
                    className={onItemClick ? "tg-risk-report-clickable" : "tg-risk-report-static"}
                  >
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" as="span" fontWeight="semibold">
                          {item.displayName}
                        </Text>
                        {getRiskBadge(item.riskLevel)}
                      </InlineStack>
                      {item.platform && (
                        <Text variant="bodySm" as="span" tone="subdued">
                          {t("riskReport.platform", { platform: item.platform })}
                        </Text>
                      )}
                      <Text variant="bodySm" as="span">
                        {item.description}
                      </Text>
                      <Text variant="bodySm" as="span" tone="subdued">
                        {t("riskReport.estTimeItem", { time: item.estimatedTimeMinutes })}
                      </Text>
                    </BlockStack>
                  </div>
                </List.Item>
              ))}
            </List>
          </BlockStack>
        </Card>
      )}
      {categories.canReplace.length > 0 && (
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text variant="headingMd" as="h2">
                {t("riskReport.categoryCanReplace")}
              </Text>
              <Badge>{String(categories.canReplace.length)}</Badge>
            </InlineStack>
            <List>
              {categories.canReplace.map((item: RiskReportItem) => (
                <List.Item key={item.id}>
                  <div
                    onClick={onItemClick ? () => onItemClick(item.id) : undefined}
                    className={onItemClick ? "tg-risk-report-clickable" : "tg-risk-report-static"}
                  >
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" as="span" fontWeight="semibold">
                          {item.displayName}
                        </Text>
                        {getRiskBadge(item.riskLevel)}
                      </InlineStack>
                      {item.platform && (
                        <Text variant="bodySm" as="span" tone="subdued">
                          {t("riskReport.platform", { platform: item.platform })}
                        </Text>
                      )}
                      <Text variant="bodySm" as="span">
                        {t("riskReport.suggestedMigration", {
                          method: item.suggestedMigration === "web_pixel"
                            ? t("riskReport.migrationMethods.web_pixel")
                            : item.suggestedMigration === "ui_extension"
                              ? t("riskReport.migrationMethods.ui_extension")
                              : item.suggestedMigration
                        })}
                      </Text>
                      <Text variant="bodySm" as="span" tone="subdued">
                        {t("riskReport.estTimeItem", { time: item.estimatedTimeMinutes })}
                      </Text>
                    </BlockStack>
                  </div>
                </List.Item>
              ))}
            </List>
          </BlockStack>
        </Card>
      )}
      {categories.noMigrationNeeded.length > 0 && (
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text variant="headingMd" as="h2">
                {t("riskReport.categoryNoMigration")}
              </Text>
              <Badge tone="success">{String(categories.noMigrationNeeded.length)}</Badge>
            </InlineStack>
            <List>
              {categories.noMigrationNeeded.map((item) => (
                <List.Item key={item.id}>
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text variant="bodyMd" as="span" fontWeight="semibold">
                        {item.displayName}
                      </Text>
                      {getRiskBadge(item.riskLevel)}
                    </InlineStack>
                    {item.platform && (
                      <Text variant="bodySm" as="span" tone="subdued">
                        {t("riskReport.platform", { platform: item.platform })}
                      </Text>
                    )}
                    <Text variant="bodySm" as="span" tone="subdued">
                      {item.description}
                    </Text>
                  </BlockStack>
                </List.Item>
              ))}
            </List>
          </BlockStack>
        </Card>
      )}
    </BlockStack>
  );
}
