import { Card, Text, BlockStack, DataTable } from "@shopify/polaris";
import { EnhancedEmptyState } from "~/components/ui";
import { formatScanHistoryForTable } from "~/utils/scan-format";

interface ScanHistoryTableProps {
  scanHistory: Array<{
    riskScore?: unknown;
    identifiedPlatforms?: unknown;
    createdAt?: unknown;
    status?: string | null;
  } | null>;
  onStartScan: () => void;
}

export function ScanHistoryTable({ scanHistory, onStartScan }: ScanHistoryTableProps) {
  const processedScanHistory = formatScanHistoryForTable(scanHistory);

  if (processedScanHistory.length === 0) {
    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            扫描历史
          </Text>
          <EnhancedEmptyState
            icon="📋"
            title="暂无扫描历史"
            description="执行扫描后，历史记录将显示在这里。"
            primaryAction={{
              content: "开始扫描",
              onAction: onStartScan,
            }}
          />
        </BlockStack>
      </Card>
    );
  }

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          扫描历史
        </Text>
        <DataTable
          columnContentTypes={["text", "numeric", "text", "text"]}
          headings={["扫描时间", "风险分", "检测平台", "状态"]}
          rows={processedScanHistory}
        />
      </BlockStack>
    </Card>
  );
}
