import { useState, useCallback } from "react";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
  Select,
  DatePicker,
  Checkbox,
} from "@shopify/polaris";
import {
  ExportIcon,
  FileIcon,
} from "~/components/icons";
import { useToastContext } from "~/components/ui";

export interface ReportExportPanelProps {
  shopId: string;
  verificationRuns?: Array<{
    id: string;
    runName: string;
    completedAt?: Date | string;
  }>;
}

export function ReportExportPanel({
  shopId,
  verificationRuns = [],
}: ReportExportPanelProps) {
  const { showSuccess, showError } = useToastContext();
  const [reportType, setReportType] = useState<"verification" | "migration" | "audit">("verification");
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [includeDetails, setIncludeDetails] = useState(true);
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();

  const handleExportCsv = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        shopId,
        reportType,
        format: "csv",
        includeDetails: String(includeDetails),
        ...(selectedRunId && { runId: selectedRunId }),
        ...(startDate && { startDate: startDate.toISOString() }),
        ...(endDate && { endDate: endDate.toISOString() }),
      });

      const url = `/api/reports/export?${params.toString()}`;
      window.open(url, "_blank");
      showSuccess("CSV 报告导出已开始");
    } catch (error) {
      showError("导出失败：" + (error instanceof Error ? error.message : "未知错误"));
    }
  }, [shopId, reportType, selectedRunId, includeDetails, startDate, endDate, showSuccess, showError]);

  const handleExportPdf = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        shopId,
        reportType,
        format: "pdf",
        includeDetails: String(includeDetails),
        ...(selectedRunId && { runId: selectedRunId }),
        ...(startDate && { startDate: startDate.toISOString() }),
        ...(endDate && { endDate: endDate.toISOString() }),
      });

      const url = `/api/reports/export?${params.toString()}`;
      window.open(url, "_blank");
      showSuccess("PDF 报告导出已开始");
    } catch (error) {
      showError("导出失败：" + (error instanceof Error ? error.message : "未知错误"));
    }
  }, [shopId, reportType, selectedRunId, includeDetails, startDate, endDate, showSuccess, showError]);

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              报告导出
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              导出迁移验收报告（PDF/CSV）
            </Text>
          </BlockStack>
          <Badge tone="info">Agency 功能</Badge>
        </InlineStack>

        <Divider />

        <Select
          label="报告类型"
          options={[
            { label: "验收报告", value: "verification" },
            { label: "迁移报告", value: "migration" },
            { label: "Audit 报告", value: "audit" },
          ]}
          value={reportType}
          onChange={(value) => setReportType(value as typeof reportType)}
        />

        {reportType === "verification" && verificationRuns.length > 0 && (
          <Select
            label="选择验收运行"
            options={[
              { label: "全部", value: "" },
              ...verificationRuns.map((run) => ({
                label: `${run.runName} (${run.completedAt ? new Date(run.completedAt).toLocaleDateString("zh-CN") : "未完成"})`,
                value: run.id,
              })),
            ]}
            value={selectedRunId}
            onChange={setSelectedRunId}
          />
        )}

        {reportType === "audit" && (
          <BlockStack gap="300">
            <Text as="span" variant="bodySm">
              时间范围（可选）
            </Text>
            <InlineStack gap="200">
              <Box minWidth="200px">
                <input
                  type="date"
                  value={startDate?.toISOString().split("T")[0] || ""}
                  onChange={(e) => setStartDate(e.target.value ? new Date(e.target.value) : undefined)}
                  style={{ width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #ccc" }}
                />
              </Box>
              <Text as="span">至</Text>
              <Box minWidth="200px">
                <input
                  type="date"
                  value={endDate?.toISOString().split("T")[0] || ""}
                  onChange={(e) => setEndDate(e.target.value ? new Date(e.target.value) : undefined)}
                  style={{ width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #ccc" }}
                />
              </Box>
            </InlineStack>
          </BlockStack>
        )}

        <Checkbox
          label="包含详细信息"
          checked={includeDetails}
          onChange={setIncludeDetails}
        />

        <Divider />

        <InlineStack gap="200" align="end">
          <Button
            onClick={handleExportCsv}
            icon={FileIcon}
            disabled={reportType === "verification" && !selectedRunId && verificationRuns.length > 0}
          >
            导出 CSV
          </Button>
          <Button
            onClick={handleExportPdf}
            icon={ExportIcon}
            variant="primary"
            disabled={reportType === "verification" && !selectedRunId && verificationRuns.length > 0}
          >
            导出 PDF
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
