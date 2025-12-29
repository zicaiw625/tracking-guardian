

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
        <Text as="h3" variant="headingMd">
          版本历史
        </Text>

        <Divider />

        <DataTable
          columnContentTypes={["text", "text", "text", "text"]}
          headings={["版本", "时间", "操作", "变更详情"]}
          rows={history.map((item) => [
            <Badge key="version">v{item.version}</Badge>,
            new Date(item.timestamp).toLocaleString("zh-CN"),
            formatOperation(item.operation),
            <Text key="changes" as="span" variant="bodySm" tone="subdued">
              {formatChanges(item.changes)}
            </Text>,
          ])}
        />
      </BlockStack>
    </Card>
  );
}

