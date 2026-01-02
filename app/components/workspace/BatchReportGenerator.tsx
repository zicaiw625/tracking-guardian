
import { useState } from "react";
import {
  Card,
  Button,
  Select,
  Checkbox,
  TextField,
  Banner,
  BlockStack,
  InlineStack,
  Text,
  Divider,
} from "@shopify/polaris";
import type { BatchReportOptions } from "~/services/workspace/batch-report.server";

interface BatchReportGeneratorProps {
  groupId: string;
  groupName: string;
  requesterId: string;
  onGenerate?: (options: BatchReportOptions) => Promise<void>;
}

export function BatchReportGenerator({
  groupId,
  groupName,
  requesterId,
  onGenerate,
}: BatchReportGeneratorProps) {
  const [reportTypes, setReportTypes] = useState<Array<"audit" | "migration" | "verification" | "template_apply">>([
    "audit",
    "migration",
    "verification",
  ]);
  const [includeDetails, setIncludeDetails] = useState(true);
  const [whiteLabel, setWhiteLabel] = useState<BatchReportOptions["whiteLabel"]>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (reportTypes.length === 0) {
      setError("请至少选择一种报告类型");
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const options: BatchReportOptions = {
        groupId,
        requesterId,
        reportTypes,
        includeDetails,
        whiteLabel: Object.keys(whiteLabel || {}).length > 0 ? whiteLabel : undefined,
      };

      if (onGenerate) {
        await onGenerate(options);
      } else {

        const formData = new FormData();
        formData.append("groupId", groupId);
        formData.append("reportTypes", JSON.stringify(reportTypes));
        formData.append("includeDetails", String(includeDetails));
        if (whiteLabel) {
          formData.append("whiteLabel", JSON.stringify(whiteLabel));
        }

        const response = await fetch("/api/workspace/batch-report", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "报告生成失败");
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `batch-migration-report-${groupName}-${new Date().toISOString().split("T")[0]}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "报告生成失败");
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleReportType = (type: "audit" | "migration" | "verification" | "template_apply") => {
    setReportTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  return (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd" as="h2">
          批量报告生成器
        </Text>
        <Text as="p" color="subdued">
          为分组 "{groupName}" 生成多店铺迁移验收聚合报告
        </Text>

        {error && (
          <Banner status="critical" onDismiss={() => setError(null)}>
            <p>{error}</p>
          </Banner>
        )}

        <Divider />

        <BlockStack gap="300">
          <Text variant="headingSm" as="h3">
            报告类型
          </Text>
          <BlockStack gap="200">
            <Checkbox
              label="Audit 扫描报告"
              checked={reportTypes.includes("audit")}
              onChange={() => toggleReportType("audit")}
            />
            <Checkbox
              label="迁移状态报告"
              checked={reportTypes.includes("migration")}
              onChange={() => toggleReportType("migration")}
            />
            <Checkbox
              label="验收测试报告"
              checked={reportTypes.includes("verification")}
              onChange={() => toggleReportType("verification")}
            />
            <Checkbox
              label="模板应用报告"
              checked={reportTypes.includes("template_apply")}
              onChange={() => toggleReportType("template_apply")}
            />
          </BlockStack>
        </BlockStack>

        <Divider />

        <BlockStack gap="300">
          <Text variant="headingSm" as="h3">
            报告选项
          </Text>
          <Checkbox
            label="包含详细信息"
            checked={includeDetails}
            onChange={setIncludeDetails}
            helpText="包含每个店铺的详细扫描和验收信息"
          />
        </BlockStack>

        <Divider />

        <BlockStack gap="300">
          <Text variant="headingSm" as="h3">
            白标配置（可选）
          </Text>
          <TextField
            label="公司名称"
            value={whiteLabel?.companyName || ""}
            onChange={(value) =>
              setWhiteLabel((prev) => ({ ...prev, companyName: value || undefined }))
            }
            placeholder="Tracking Guardian"
            helpText="自定义报告中的公司名称"
          />
          <TextField
            label="Logo URL"
            value={whiteLabel?.logoUrl || ""}
            onChange={(value) =>
              setWhiteLabel((prev) => ({ ...prev, logoUrl: value || undefined }))
            }
            placeholder="https://example.com/logo.png"
            helpText="Logo 图片 URL（将显示在报告头部）"
          />
          <TextField
            label="联系邮箱"
            value={whiteLabel?.contactEmail || ""}
            onChange={(value) =>
              setWhiteLabel((prev) => ({ ...prev, contactEmail: value || undefined }))
            }
            placeholder="contact@example.com"
            helpText="将显示在报告页脚"
          />
          <TextField
            label="联系电话"
            value={whiteLabel?.contactPhone || ""}
            onChange={(value) =>
              setWhiteLabel((prev) => ({ ...prev, contactPhone: value || undefined }))
            }
            placeholder="+86 123 4567 8900"
            helpText="将显示在报告页脚"
          />
        </BlockStack>

        <Divider />

        <InlineStack>
          <Button
            primary
            loading={isGenerating}
            onClick={handleGenerate}
            disabled={reportTypes.length === 0}
          >
            生成 PDF 报告
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

