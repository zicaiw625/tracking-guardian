import { Card, Text, BlockStack, DataTable } from "@shopify/polaris";
import { EnhancedEmptyState } from "~/components/ui";
import { formatScanHistoryForTable } from "~/utils/scan-format";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  const processedScanHistory = formatScanHistoryForTable(scanHistory);

  if (processedScanHistory.length === 0) {
    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            {t("scan.history.title")}
          </Text>
          <EnhancedEmptyState
            icon="📋"
            title={t("scan.history.empty.title")}
            description={t("scan.history.empty.description")}
            primaryAction={{
              content: t("scan.autoTab.startScan"),
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
          {t("scan.history.title")}
        </Text>
        <DataTable
          columnContentTypes={["text", "numeric", "text", "text"]}
          headings={[
            t("scan.history.headings.time"),
            t("scan.history.headings.riskScore"),
            t("scan.history.headings.platforms"),
            t("scan.history.headings.status")
          ]}
          rows={processedScanHistory}
        />
      </BlockStack>
    </Card>
  );
}
