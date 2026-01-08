import { useState, useEffect } from "react";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
  Banner,
  ProgressBar,
  Icon,
  List,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertCircleIcon,
  InfoIcon,
  ArrowRightIcon,
} from "~/components/icons";

export interface UpgradeHealthCheckProps {
  typOspPagesEnabled: boolean;
  riskScore: number;
  estimatedMigrationTimeMinutes: number;
  scriptTagsCount: number;
  identifiedPlatforms: string[];
  onStartAudit: () => void;
  onViewDashboard: () => void;
}

export function UpgradeHealthCheck({
  typOspPagesEnabled,
  riskScore,
  estimatedMigrationTimeMinutes,
  scriptTagsCount,
  identifiedPlatforms,
  onStartAudit,
  onViewDashboard,
}: UpgradeHealthCheckProps) {
  const [showDetails, setShowDetails] = useState(false);

  const getRiskLevel = (score: number): {
    level: "low" | "medium" | "high";
    label: string;
    tone: "success" | "critical" | undefined;
  } => {
    if (score >= 70) {
      return { level: "high", label: "高风险", tone: "critical" };
    } else if (score >= 40) {
      return { level: "medium", label: "中风险", tone: undefined };
    } else {
      return { level: "low", label: "低风险", tone: "success" };
    }
  };

  const riskLevel = getRiskLevel(riskScore);
  const estimatedHours = Math.ceil(estimatedMigrationTimeMinutes / 60);

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingLg">
              🏥 升级体检报告
            </Text>
            <Badge tone={riskLevel.tone} size="large">
              {riskLevel.label}
            </Badge>
          </InlineStack>
          <Text as="p" tone="subdued">
            我们已自动扫描您的店铺，评估迁移风险并生成迁移建议
          </Text>
        </BlockStack>

        <Divider />

        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">
            升级状态
          </Text>
          <Box
            background={typOspPagesEnabled ? "bg-surface-success" : "bg-surface-warning"}
            padding="400"
            borderRadius="200"
          >
            <InlineStack gap="300" blockAlign="center">
              <Icon
                source={typOspPagesEnabled ? CheckCircleIcon : AlertCircleIcon}
                tone={typOspPagesEnabled ? "success" : "warning"}
              />
              <BlockStack gap="100">
                <Text as="span" fontWeight="semibold">
                  {typOspPagesEnabled
                    ? "✅ 已升级到新版 Thank you / Order status 页面"
                    : "⚠️ 尚未升级到新版页面"}
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  {typOspPagesEnabled
                    ? "您的店铺已使用新版页面，可以开始迁移追踪脚本"
                    : "建议先升级到新版页面，然后再迁移追踪脚本"}
                </Text>
              </BlockStack>
            </InlineStack>
          </Box>
        </BlockStack>

        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h3" variant="headingMd">
              风险评分
            </Text>
            <Text as="span" variant="headingLg" fontWeight="bold">
              {riskScore}/100
            </Text>
          </InlineStack>
          <ProgressBar
            progress={riskScore}
            tone={riskLevel.tone}
            size="large"
          />
          <Text as="p" variant="bodySm" tone="subdued">
            {riskScore >= 70
              ? "检测到多个高风险项，建议立即开始迁移"
              : riskScore >= 40
                ? "检测到一些需要关注的项，建议尽快完成迁移"
                : "风险较低，可以按计划完成迁移"}
          </Text>
        </BlockStack>

        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">
            检测结果摘要
          </Text>
          <Box background="bg-surface-secondary" padding="400" borderRadius="200">
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">
                  ScriptTags 数量
                </Text>
                <Text as="span" fontWeight="semibold">
                  {scriptTagsCount} 个
                </Text>
              </InlineStack>
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">
                  识别到的平台
                </Text>
                <InlineStack gap="100">
                  {identifiedPlatforms.length > 0 ? (
                    identifiedPlatforms.map((platform) => (
                      <Badge key={platform}>{platform}</Badge>
                    ))
                  ) : (
                    <Text as="span" variant="bodySm">无</Text>
                  )}
                </InlineStack>
              </InlineStack>
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">
                  预计迁移时间
                </Text>
                <Text as="span" fontWeight="semibold">
                  {estimatedHours > 0
                    ? `${estimatedHours} 小时 ${estimatedMigrationTimeMinutes % 60} 分钟`
                    : `${estimatedMigrationTimeMinutes} 分钟`}
                </Text>
              </InlineStack>
              {estimatedMigrationTimeMinutes > 60 && (
                <Text as="p" variant="bodySm" tone="subdued">
                  💡 提示：建议分阶段完成迁移，优先处理高风险项
                </Text>
              )}
            </BlockStack>
          </Box>
        </BlockStack>

        <Banner tone="info" title="下一步操作">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              根据检测结果，我们建议您：
            </Text>
            <List type="number">
              <List.Item>
                {typOspPagesEnabled
                  ? "开始 Audit 扫描，查看详细的迁移清单"
                  : "先升级到新版 Thank you / Order status 页面"}
              </List.Item>
              <List.Item>根据迁移清单配置像素追踪</List.Item>
              <List.Item>运行验收测试，确保追踪正常</List.Item>
              <List.Item>切换到生产模式，完成迁移</List.Item>
            </List>
          </BlockStack>
        </Banner>

        <Divider />

        <InlineStack gap="200" align="end">
          <Button onClick={onViewDashboard}>查看仪表盘</Button>
          <Button variant="primary" onClick={onStartAudit} icon={ArrowRightIcon}>
            开始 Audit 扫描
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
