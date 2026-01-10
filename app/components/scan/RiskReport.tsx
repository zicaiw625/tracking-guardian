import { Fragment } from "react";
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
import { AlertCircleIcon, CheckCircleIcon, InfoIcon } from "~/components/icons";

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
  const { summary, items, categories } = report;
  const getRiskBadge = (riskLevel: "high" | "medium" | "low") => {
    switch (riskLevel) {
      case "high":
        return <Badge tone="critical">高风险</Badge>;
      case "medium":
        return <Badge tone="warning">中风险</Badge>;
      case "low":
        return <Badge tone="info">低风险</Badge>;
    }
  };
  const getRiskCategoryBadge = (category: string) => {
    switch (category) {
      case "will_fail":
        return <Badge tone="critical">会失效</Badge>;
      case "can_replace":
        return <Badge tone="warning">可直接替换</Badge>;
      case "no_migration_needed":
        return <Badge tone="success">无需迁移</Badge>;
      default:
        return null;
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
              风险概览
            </Text>
            {getRiskBadge(riskLevel)}
          </InlineStack>
          <Box>
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text variant="bodyMd" as="span">
                  风险分数
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
              统计摘要
            </Text>
            <List type="bullet">
              <List.Item>
                总计: <strong>{summary.totalItems}</strong> 项资产
              </List.Item>
              <List.Item>
                高风险: <strong>{summary.highRiskCount}</strong> 项
              </List.Item>
              <List.Item>
                中风险: <strong>{summary.mediumRiskCount}</strong> 项
              </List.Item>
              <List.Item>
                低风险: <strong>{summary.lowRiskCount}</strong> 项
              </List.Item>
              <List.Item>
                预计迁移时间: <strong>{summary.totalEstimatedTime}</strong> 分钟
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
                会失效/受限的项
              </Text>
              <Badge tone="critical">{String(categories.willFail.length)}</Badge>
            </InlineStack>
            <List>
              {categories.willFail.map((item: RiskReportItem) => (
                <List.Item key={item.id}>
                  <div onClick={onItemClick ? () => onItemClick(item.id) : undefined} style={{ cursor: onItemClick ? "pointer" : "default" }}>
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" as="span" fontWeight="semibold">
                          {item.displayName}
                        </Text>
                        {getRiskBadge(item.riskLevel)}
                      </InlineStack>
                      {item.platform && (
                        <Text variant="bodySm" as="span" tone="subdued">
                          平台: {item.platform}
                        </Text>
                      )}
                      <Text variant="bodySm" as="span">
                        {item.description}
                      </Text>
                      <Text variant="bodySm" as="span" tone="subdued">
                        预计时间: {item.estimatedTimeMinutes} 分钟
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
                可直接替换的项
              </Text>
              <Badge>{String(categories.canReplace.length)}</Badge>
            </InlineStack>
            <List>
              {categories.canReplace.map((item: RiskReportItem) => (
                <List.Item key={item.id}>
                  <div onClick={onItemClick ? () => onItemClick(item.id) : undefined} style={{ cursor: onItemClick ? "pointer" : "default" }}>
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" as="span" fontWeight="semibold">
                          {item.displayName}
                        </Text>
                        {getRiskBadge(item.riskLevel)}
                      </InlineStack>
                      {item.platform && (
                        <Text variant="bodySm" as="span" tone="subdued">
                          平台: {item.platform}
                        </Text>
                      )}
                      <Text variant="bodySm" as="span">
                        推荐迁移方式: {item.suggestedMigration === "web_pixel" ? "Web Pixel" : item.suggestedMigration === "ui_extension" ? "UI Extension" : item.suggestedMigration}
                      </Text>
                      <Text variant="bodySm" as="span" tone="subdued">
                        预计时间: {item.estimatedTimeMinutes} 分钟
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
                无需迁移的项
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
                        平台: {item.platform}
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
