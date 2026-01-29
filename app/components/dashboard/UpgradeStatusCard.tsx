import { memo } from "react";
import { Badge, Banner, BlockStack, Box, Button, Card, Divider, Icon, InlineStack, List, Text } from "@shopify/polaris";
import { ClockIcon } from "~/components/icons";
import { EnhancedEmptyState } from "~/components/ui";
import type { UpgradeStatus } from "~/types/dashboard";

export const UpgradeStatusCard = memo(function UpgradeStatusCard({
  upgradeStatus,
}: {
  upgradeStatus?: UpgradeStatus;
}) {
  if (!upgradeStatus) {
    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">升级状态</Text>
          <EnhancedEmptyState
            icon="📊"
            title="状态待确认"
            description="正在加载升级状态信息..."
          />
        </BlockStack>
      </Card>
    );
  }
  const statusBadge = upgradeStatus.isUpgraded
    ? { tone: "success" as const, label: "已升级（新版本）" }
    : { tone: "warning" as const, label: "未升级（旧版本）" };
  const urgencyBadge = {
    critical: { tone: "critical" as const, label: "紧急" },
    high: { tone: "critical" as const, label: "高" },
    medium: { tone: "warning" as const, label: "中" },
    low: { tone: "info" as const, label: "低" },
    resolved: { tone: "success" as const, label: "已完成" },
  }[upgradeStatus.urgency];
  const deadlineLabel = upgradeStatus.deadlineDate;
  const autoUpgradeLabel = upgradeStatus.autoUpgradeStartDate || "";
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">升级状态</Text>
          <Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>
        </InlineStack>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                Checkout Extensibility 状态
              </Text>
              <Text as="span" variant="bodySm" tone="subdued">
                {upgradeStatus.isUpgraded
                  ? "您的店铺已使用新版 Checkout Extensibility"
                  : "您的店铺仍在使用旧版 Checkout 系统"}
              </Text>
            </BlockStack>
            <Badge tone={statusBadge.tone}>
              {upgradeStatus.isUpgraded ? "新版本" : "旧版本"}
            </Badge>
          </InlineStack>
          {!upgradeStatus.isUpgraded && (
            <>
              <Divider />
              <Banner tone="warning">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    <strong>影响提示：</strong>
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        旧版 ScriptTags 将在截止日期后停止执行；Additional Scripts 将进入只读模式（不可编辑，PII 不可访问）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        追踪脚本可能失效，导致转化数据丢失
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        建议尽快完成迁移以避免追踪中断
                      </Text>
                    </List.Item>
                  </List>
                </BlockStack>
              </Banner>
            </>
          )}
          <Button
            url="/app/scan"
            variant="primary"
            size="large"
            fullWidth
          >
            开始 Audit
          </Button>
          <Divider />
          {upgradeStatus.shopTier === "plus" && (
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="span" variant="bodyMd" fontWeight="semibold">
                  迁移截止日期
                </Text>
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" variant="bodyMd" fontWeight="bold">{deadlineLabel}</Text>
                  <Badge tone={urgencyBadge.tone}>{urgencyBadge.label}</Badge>
                </InlineStack>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                日期来源：来自 Shopify 官方公告，仅供参考。实际截止日期请以 Shopify Admin 中的提示为准。
              </Text>
              {upgradeStatus.daysRemaining > 0 && upgradeStatus.daysRemaining <= 365 && (
                <Box
                  padding="400"
                  background={
                    upgradeStatus.urgency === "critical"
                      ? "bg-surface-critical"
                      : upgradeStatus.urgency === "high"
                        ? "bg-surface-warning"
                        : "bg-surface-info"
                  }
                  borderRadius="200"
                >
                  <InlineStack gap="300" blockAlign="center">
                    <Icon source={ClockIcon} />
                    <BlockStack gap="100">
                      <Text as="p" variant="headingMd" fontWeight="bold">
                        剩余 {upgradeStatus.daysRemaining} 天
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        建议尽快完成迁移以避免功能丢失
                      </Text>
                    </BlockStack>
                  </InlineStack>
                </Box>
              )}
              {autoUpgradeLabel && (
                <>
                  <Divider />
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      自动升级开始
                    </Text>
                    <Text as="span" variant="bodyMd" fontWeight="bold">{autoUpgradeLabel}</Text>
                  </InlineStack>
                  <Banner tone="warning">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm">
                        <strong>{autoUpgradeLabel}</strong> 起（Shopify 会提前30天通知），Shopify 开始自动升级 Plus 商家到新版 TYP/OSP 页面，legacy 定制会丢失。
                      </Text>
                      <a
                        href="https://help.shopify.com/en/manual/checkout-settings/upgrade-guide"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        查看 Plus 商家升级指南
                      </a>
                    </BlockStack>
                  </Banner>
                </>
              )}
            </BlockStack>
          )}
          {upgradeStatus.shopTier === "non_plus" && (
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="span" variant="bodyMd" fontWeight="semibold">
                  迁移截止日期
                </Text>
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" variant="bodyMd" fontWeight="bold">{deadlineLabel}</Text>
                  <Badge tone={urgencyBadge.tone}>{urgencyBadge.label}</Badge>
                </InlineStack>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                日期来源：来自 Shopify 官方公告，仅供参考。实际截止日期请以 Shopify Admin 中的提示为准。
              </Text>
              {upgradeStatus.daysRemaining > 0 && upgradeStatus.daysRemaining <= 365 && (
                <Box
                  padding="400"
                  background={
                    upgradeStatus.urgency === "critical"
                      ? "bg-surface-critical"
                      : upgradeStatus.urgency === "high"
                        ? "bg-surface-warning"
                        : "bg-surface-info"
                  }
                  borderRadius="200"
                >
                  <InlineStack gap="300" blockAlign="center">
                    <Icon source={ClockIcon} />
                    <BlockStack gap="100">
                      <Text as="p" variant="headingMd" fontWeight="bold">
                        剩余 {upgradeStatus.daysRemaining} 天
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        建议尽快完成迁移以避免功能丢失
                      </Text>
                    </BlockStack>
                  </InlineStack>
                </Box>
              )}
            </BlockStack>
          )}
          {upgradeStatus.daysRemaining <= 0 && (
            <>
              <Divider />
              <Banner tone="critical">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm">
                    截止日期已过，请立即完成迁移以避免追踪中断。
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    日期来源：来自 Shopify 官方公告，仅供参考。实际截止日期请以 Shopify Admin 中的提示为准。
                  </Text>
                </BlockStack>
              </Banner>
            </>
          )}
        </BlockStack>
      </BlockStack>
    </Card>
  );
});
