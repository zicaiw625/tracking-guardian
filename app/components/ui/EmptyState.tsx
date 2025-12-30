

import { memo } from "react";
import { Card, BlockStack, Text, Button, InlineStack, Icon, Box } from "@shopify/polaris";
import { EmptyStateDisplay } from "./ErrorDisplay";

export interface EnhancedEmptyStateProps {

  title?: string;

  description?: string;

  primaryAction?: {
    content: string;
    onAction?: () => void;
    url?: string;
  };

  secondaryAction?: {
    content: string;
    onAction?: () => void;
    url?: string;
  };

  icon?: string;

  image?: string;

  helpText?: string;

  children?: React.ReactNode;
}

export const EnhancedEmptyState = memo(function EnhancedEmptyState({
  title = "暂无数据",
  description = "当前没有可显示的内容。",
  primaryAction,
  secondaryAction,
  icon,
  image,
  helpText,
  children,
}: EnhancedEmptyStateProps) {
  const hasActions = primaryAction || secondaryAction;

  return (
    <Card>
      <BlockStack gap="400" align="center">
        {image ? (
          <Box>
            <img
              src={image}
              alt=""
              style={{ maxWidth: "200px", height: "auto" }}
            />
          </Box>
        ) : icon ? (
          <Text as="span" variant="heading3xl">
            {icon}
          </Text>
        ) : null}

        <BlockStack gap="200" align="center">
          <Text as="h2" variant="headingMd">
            {title}
          </Text>
          <Text as="p" tone="subdued" alignment="center">
            {description}
          </Text>
          {helpText && (
            <Text as="p" variant="bodySm" tone="subdued" alignment="center">
              {helpText}
            </Text>
          )}
        </BlockStack>

        {children}

        {hasActions && (
          <InlineStack gap="200">
            {primaryAction && (
              <Button
                variant="primary"
                onClick={primaryAction.onAction}
                url={primaryAction.url}
              >
                {primaryAction.content}
              </Button>
            )}
            {secondaryAction && (
              <Button
                variant="secondary"
                onClick={secondaryAction.onAction}
                url={secondaryAction.url}
              >
                {secondaryAction.content}
              </Button>
            )}
          </InlineStack>
        )}
      </BlockStack>
    </Card>
  );
});

export function EmptyStateNoData({
  primaryAction,
  secondaryAction
}: {
  primaryAction?: EnhancedEmptyStateProps["primaryAction"];
  secondaryAction?: EnhancedEmptyStateProps["secondaryAction"];
}) {
  return (
    <EnhancedEmptyState
      icon="📭"
      title="暂无数据"
      description="当前没有可显示的数据。"
      helpText="请执行相关操作或稍后再试。"
      primaryAction={primaryAction}
      secondaryAction={secondaryAction}
    />
  );
}

export function EmptyStateNoResults({
  onReset,
  onSearch
}: {
  onReset?: () => void;
  onSearch?: () => void;
}) {
  return (
    <EnhancedEmptyState
      icon="🔍"
      title="未找到结果"
      description="没有找到匹配的搜索结果。"
      helpText="请尝试调整搜索条件或筛选器。"
      primaryAction={onSearch ? {
        content: "重新搜索",
        onAction: onSearch,
      } : undefined}
      secondaryAction={onReset ? {
        content: "清除筛选",
        onAction: onReset,
      } : undefined}
    />
  );
}

export function EmptyStateNotConfigured({
  onConfigure,
  configType = "配置"
}: {
  onConfigure?: () => void;
  configType?: string;
}) {
  return (
    <EnhancedEmptyState
      icon="⚙️"
      title={`${configType}未设置`}
      description={`请先完成${configType}设置以使用此功能。`}
      primaryAction={onConfigure ? {
        content: `开始${configType}`,
        onAction: onConfigure,
      } : undefined}
    />
  );
}

export function EmptyStateNoPermission({
  onUpgrade,
  requiredFeature
}: {
  onUpgrade?: () => void;
  requiredFeature?: string;
}) {
  const upgradeAction = onUpgrade ? {
    content: "查看套餐",
    onAction: onUpgrade,
  } : {
    content: "查看套餐",
    url: "/app/billing",
  };

  return (
    <EnhancedEmptyState
      icon="🔒"
      title="需要升级套餐"
      description={requiredFeature
        ? `此功能需要 ${requiredFeature} 套餐。`
        : "您的当前套餐不支持此功能。"}
      helpText="升级套餐以解锁更多功能。"
      primaryAction={upgradeAction}
    />
  );
}

export { EmptyStateDisplay };

