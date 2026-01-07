
import { useState, useCallback, useEffect } from "react";
import {
  Card,
  Button,
  BlockStack,
  InlineStack,
  Text,
  Divider,
  Banner,
  Badge,
  ProgressBar,
  Box,
  Icon,
  Collapsible,
} from "@shopify/polaris";
import { SearchIcon, ExportIcon, CheckCircleIcon, AlertCircleIcon } from "~/components/icons";
import { BatchReportGenerator } from "./BatchReportGenerator";
import type { BatchReportOptions } from "~/services/workspace/batch-report.server";

interface BatchOperationsPanelProps {
  groupId: string;
  groupName: string;
  requesterId: string;
  memberCount: number;
  onBatchAuditStart?: () => void;
  onBatchTemplateApply?: () => void;
  onReportGenerate?: (options: BatchReportOptions) => Promise<void>;
}

export function BatchOperationsPanel({
  groupId,
  groupName,
  requesterId,
  memberCount,
  onBatchAuditStart,
  onBatchTemplateApply,
  onReportGenerate,
}: BatchOperationsPanelProps) {
  const [showReportGenerator, setShowReportGenerator] = useState(false);

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              批量操作中心
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              对「{groupName}」分组内的 {memberCount} 个店铺执行批量操作
            </Text>
          </BlockStack>
        </InlineStack>

        <Divider />

        <BlockStack gap="400">
          {}
          <Box
            background="bg-surface-secondary"
            padding="400"
            borderRadius="200"
            borderColor="border"
            borderWidth="025"
          >
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={SearchIcon} />
                    <Text as="span" variant="headingSm" fontWeight="semibold">
                      批量 Audit 扫描
                    </Text>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    一键扫描所有店铺的追踪脚本，识别风险和迁移建议
                  </Text>
                </BlockStack>
                <Button
                  variant="primary"
                  icon={SearchIcon}
                  onClick={onBatchAuditStart}
                  size="large"
                >
                  开始扫描
                </Button>
              </InlineStack>
              <Banner tone="info">
                <Text as="p" variant="bodySm">
                  扫描将识别所有店铺中的追踪脚本（ScriptTags、Checkout配置等），
                  生成风险评分和迁移优先级建议。最近 6 小时内已扫描的店铺将被自动跳过。
                </Text>
              </Banner>
            </BlockStack>
          </Box>

          {}
          <Box
            background="bg-surface-secondary"
            padding="400"
            borderRadius="200"
            borderColor="border"
            borderWidth="025"
          >
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={CheckCircleIcon} />
                    <Text as="span" variant="headingSm" fontWeight="semibold">
                      批量应用像素模板
                    </Text>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    将预设的像素配置模板批量应用到所有店铺
                  </Text>
                </BlockStack>
                <Button
                  variant="primary"
                  onClick={onBatchTemplateApply}
                  size="large"
                >
                  选择模板
                </Button>
              </InlineStack>
              <Banner tone="info">
                <Text as="p" variant="bodySm">
                  选择一个像素配置模板（如"基础追踪套件"、"全渠道追踪套件"），
                  批量应用到分组内所有店铺。支持配置对比和详细结果报告。
                </Text>
              </Banner>
            </BlockStack>
          </Box>

          {}
          <Box
            background="bg-surface-secondary"
            padding="400"
            borderRadius="200"
            borderColor="border"
            borderWidth="025"
          >
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={CheckCircleIcon} tone="success" />
                    <Text as="span" variant="headingSm" fontWeight="semibold">
                      批量验收运行
                    </Text>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    为所有店铺运行验收测试，验证追踪配置是否正常工作
                  </Text>
                </BlockStack>
                <Button
                  variant="primary"
                  onClick={() => {
                    const formData = new FormData();
                    formData.append("_action", "batch_verification");
                    formData.append("groupId", groupId);
                    formData.append("runType", "quick");

                    fetch("/app/workspace", {
                      method: "POST",
                      body: formData,
                    }).catch((error) => {
                      if (process.env.NODE_ENV === "development") {

                        console.error("Failed to start batch verification:", error);
                      }
                    });
                  }}
                  size="large"
                >
                  开始验收
                </Button>
              </InlineStack>
              <Banner tone="info">
                <Text as="p" variant="bodySm">
                  为分组内所有已配置服务端追踪的店铺运行验收测试。
                  系统会自动分析最近的事件，验证参数完整性和金额准确性。
                </Text>
              </Banner>
            </BlockStack>
          </Box>

          {}
          <Box
            background="bg-surface-secondary"
            padding="400"
            borderRadius="200"
            borderColor="border"
            borderWidth="025"
          >
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={ExportIcon} />
                    <Text as="span" variant="headingSm" fontWeight="semibold">
                      批量报告导出
                    </Text>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    生成多店铺迁移验收聚合报告（PDF格式，支持白标）
                  </Text>
                </BlockStack>
                <Button
                  variant="primary"
                  icon={ExportIcon}
                  onClick={() => setShowReportGenerator(true)}
                  size="large"
                >
                  生成报告
                </Button>
              </InlineStack>
              {showReportGenerator && (
                <Box paddingBlockStart="400">
                  <Divider />
                  <Box paddingBlockStart="400">
                    <BatchReportGenerator
                      groupId={groupId}
                      groupName={groupName}
                      requesterId={requesterId}
                      onGenerate={onReportGenerate}
                    />
                  </Box>
                </Box>
              )}
            </BlockStack>
          </Box>
        </BlockStack>

        <Divider />

        <Banner tone="info">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              💡 批量操作提示
            </Text>
            <Text as="p" variant="bodySm">
              • 批量操作会在后台异步执行，您可以在"任务看板"中查看实时进度
            </Text>
            <Text as="p" variant="bodySm">
              • 所有批量操作都支持重试机制，失败的店铺会自动重试
            </Text>
            <Text as="p" variant="bodySm">
              • 报告生成支持白标配置，可以自定义公司名称和Logo
            </Text>
          </BlockStack>
        </Banner>
      </BlockStack>
    </Card>
  );
}

