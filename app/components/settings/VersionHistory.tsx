

import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Box,
  Divider,
  DataTable,
  EmptyState,
} from "@shopify/polaris";

interface VersionHistoryItem {
  version: number;
  timestamp: Date;
  operation: string;
  changes: Record<string, unknown>;
}

interface VersionHistoryProps {
  history: VersionHistoryItem[];
  platform: string;
}

const OPERATION_LABELS: Record<string, string> = {
  rollback: "回滚",
  environment_switch: "环境切换",
  credentials_updated: "凭证更新",
  pixel_config_updated: "配置更新",
  pixel_config_changed: "配置变更",
};

function formatOperation(operation: string): string {
  return OPERATION_LABELS[operation] || operation;
}

function formatChanges(changes: Record<string, unknown>): string {
  const parts: string[] = [];

  if (changes.previousEnvironment && changes.newEnvironment) {
    parts.push(
      `环境: ${changes.previousEnvironment} → ${changes.newEnvironment}`
    );
  }

  if (changes.previousVersion && changes.newVersion) {
    parts.push(
      `版本: v${changes.previousVersion} → v${changes.newVersion}`
    );
  }

  if (changes.operation) {
    parts.push(`操作: ${formatOperation(changes.operation as string)}`);
  }

  return parts.join(", ") || "配置变更";
}

export function VersionHistory({ history, platform }: VersionHistoryProps) {
  if (history.length === 0) {
    return (
      <Card>
        <EmptyState
          heading="暂无版本历史"
          image="https:
        >
          <p>配置变更历史将显示在这里</p>
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingMd">
            版本历史
          </Text>
          <Badge tone="info">{history.length} 条记录</Badge>
        </InlineStack>

        <Divider />

        <DataTable
          columnContentTypes={["text", "text", "text", "text"]}
          headings={["版本", "时间", "操作", "变更详情"]}
          rows={history.map((item, index) => [
            <InlineStack key="version" gap="200" blockAlign="center">
              <Badge tone={index === 0 ? "success" : "subdued"}>
                v{item.version}
              </Badge>
              {index === 0 && (
                <Badge tone="info">当前版本</Badge>
              )}
            </InlineStack>,
            <Text key="time" as="span" variant="bodySm">
              {new Date(item.timestamp).toLocaleString("zh-CN", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>,
            <Badge key="operation" tone={item.operation === "rollback" ? "warning" : "info"}>
              {formatOperation(item.operation)}
            </Badge>,
            <Text key="changes" as="span" variant="bodySm" tone="subdued">
              {formatChanges(item.changes)}
            </Text>,
          ])}
        />

        <Banner tone="info">
          <Text as="p" variant="bodySm">
            💡 版本历史记录最近 {history.length} 次配置变更。每次环境切换或配置更新都会创建新版本。
          </Text>
        </Banner>
      </BlockStack>
    </Card>
  );
}

