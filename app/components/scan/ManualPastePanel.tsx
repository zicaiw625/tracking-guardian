import { useState, useCallback, useMemo } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  TextField,
  Banner,
  Badge,
  Box,
  Divider,
  List,
  ProgressBar,
  Spinner,
} from "@shopify/polaris";
import { CheckCircleIcon, AlertCircleIcon, ClipboardIcon } from "~/components/icons";
import { useFetcher } from "@remix-run/react";

export interface ManualPastePanelProps {
  shopId: string;
  onAssetsCreated?: (count: number) => void;
}

interface AnalysisResult {
  assets: Array<{
    category: string;
    platform?: string;
    displayName: string;
    riskLevel: "high" | "medium" | "low";
    suggestedMigration: string;
    confidence: "high" | "medium" | "low";
  }>;
  summary: {
    totalSnippets: number;
    identifiedCategories: Record<string, number>;
    identifiedPlatforms: string[];
    overallRiskLevel: "high" | "medium" | "low";
  };
}

export function ManualPastePanel({ shopId, onAssetsCreated }: ManualPastePanelProps) {
  const [scriptContent, setScriptContent] = useState("");
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const fetcher = useFetcher();

  const handleAnalyze = useCallback(() => {
    if (!scriptContent.trim()) {
      return;
    }

    setIsAnalyzing(true);
    fetcher.submit(
      {
        _action: "analyze_manual_paste",
        content: scriptContent,
      },
      { method: "post" }
    );
  }, [scriptContent, fetcher]);

  const handleProcess = useCallback(() => {
    if (!analysisResult) {
      return;
    }

    setIsProcessing(true);
    fetcher.submit(
      {
        _action: "process_manual_paste",
        content: scriptContent,
      },
      { method: "post" }
    );
  }, [scriptContent, analysisResult, fetcher]);

  // 处理分析结果
  useMemo(() => {
    if (fetcher.data && fetcher.data.analysis) {
      setAnalysisResult(fetcher.data.analysis);
      setIsAnalyzing(false);
    }
  }, [fetcher.data]);

  // 处理创建结果
  useMemo(() => {
    if (fetcher.data && fetcher.data.processed) {
      const result = fetcher.data.processed;
      const totalCreated = result.created + result.updated;
      setIsProcessing(false);
      setScriptContent("");
      setAnalysisResult(null);
      if (onAssetsCreated) {
        onAssetsCreated(totalCreated);
      }
    }
  }, [fetcher.data, onAssetsCreated]);

  const hasContent = scriptContent.trim().length > 0;
  const canAnalyze = hasContent && !isAnalyzing && !isProcessing;
  const canProcess = analysisResult && !isProcessing && !isAnalyzing;

  const riskLevelBadge = analysisResult
    ? {
        high: { tone: "critical" as const, label: "高风险" },
        medium: { tone: "warning" as const, label: "中风险" },
        low: { tone: "success" as const, label: "低风险" },
      }[analysisResult.summary.overallRiskLevel]
    : null;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            手动粘贴脚本分析
          </Text>
          <Badge>手动输入</Badge>
        </InlineStack>

        <Banner tone="info">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              使用说明：
            </Text>
            <List>
              <List.Item>
                从 Shopify Admin 的「设置 → 结账和订单处理 → Additional Scripts」中复制脚本内容
              </List.Item>
              <List.Item>
                或从 Thank you / Order status 页面的源代码中复制相关脚本
              </List.Item>
              <List.Item>
                支持粘贴多段脚本，系统会自动识别和分类
              </List.Item>
            </List>
          </BlockStack>
        </Banner>

        <TextField
          label="脚本内容"
          value={scriptContent}
          onChange={setScriptContent}
          multiline={10}
          placeholder="请粘贴您的脚本内容，例如：&#10;&#10;&lt;script&gt;&#10;  gtag('config', 'G-XXXXXXXXXX');&#10;  fbq('track', 'Purchase', {value: 100, currency: 'USD'});&#10;&lt;/script&gt;"
          helpText={`已输入 ${scriptContent.length} 个字符`}
          disabled={isAnalyzing || isProcessing}
        />

        <InlineStack gap="200">
          <Button
            onClick={handleAnalyze}
            disabled={!canAnalyze}
            loading={isAnalyzing}
            primary
          >
            {isAnalyzing ? "分析中..." : "分析脚本"}
          </Button>
          {analysisResult && (
            <Button
              onClick={handleProcess}
              disabled={!canProcess}
              loading={isProcessing}
            >
              {isProcessing ? "处理中..." : "创建迁移资产"}
            </Button>
          )}
        </InlineStack>

        {isAnalyzing && (
          <Box padding="400">
            <InlineStack gap="300" blockAlign="center">
              <Spinner size="small" />
              <Text as="span" variant="bodySm" tone="subdued">
                正在分析脚本内容，识别平台和风险...
              </Text>
            </InlineStack>
          </Box>
        )}

        {isProcessing && (
          <Box padding="400">
            <InlineStack gap="300" blockAlign="center">
              <Spinner size="small" />
              <Text as="span" variant="bodySm" tone="subdued">
                正在创建迁移资产...
              </Text>
            </InlineStack>
          </Box>
        )}

        {analysisResult && (
          <BlockStack gap="400">
            <Divider />
            <Text as="h3" variant="headingSm">
              分析结果
            </Text>

            {/* 摘要 */}
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    识别的代码片段：
                  </Text>
                  <Badge>{analysisResult.summary.totalSnippets} 个</Badge>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    识别的平台：
                  </Text>
                  {analysisResult.summary.identifiedPlatforms.length > 0 ? (
                    <InlineStack gap="100" wrap>
                      {analysisResult.summary.identifiedPlatforms.map((p) => (
                        <Badge key={p}>{p}</Badge>
                      ))}
                    </InlineStack>
                  ) : (
                    <Text as="span" variant="bodySm" tone="subdued">
                      无
                    </Text>
                  )}
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    总体风险等级：
                  </Text>
                  {riskLevelBadge && (
                    <Badge tone={riskLevelBadge.tone}>{riskLevelBadge.label}</Badge>
                  )}
                </InlineStack>
              </BlockStack>
            </Box>

            {/* 识别的资产列表 */}
            {analysisResult.assets.length > 0 && (
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  识别的资产 ({analysisResult.assets.length} 项)
                </Text>
                <BlockStack gap="200">
                  {analysisResult.assets.map((asset, index) => {
                    const riskBadge = {
                      high: { tone: "critical" as const, label: "高" },
                      medium: { tone: "warning" as const, label: "中" },
                      low: { tone: "success" as const, label: "低" },
                    }[asset.riskLevel];

                    const confidenceBadge = {
                      high: { tone: "success" as const, label: "高置信度" },
                      medium: { tone: "info" as const, label: "中置信度" },
                      low: { tone: "warning" as const, label: "低置信度" },
                    }[asset.confidence];

                    return (
                      <Box
                        key={index}
                        background="bg-surface-secondary"
                        padding="300"
                        borderRadius="200"
                      >
                        <BlockStack gap="200">
                          <InlineStack align="space-between" blockAlign="start">
                            <BlockStack gap="100">
                              <InlineStack gap="200" wrap>
                                <Text as="span" variant="bodyMd" fontWeight="semibold">
                                  {asset.displayName}
                                </Text>
                                {asset.platform && <Badge>{asset.platform}</Badge>}
                                <Badge tone={riskBadge.tone}>{riskBadge.label}风险</Badge>
                                <Badge tone={confidenceBadge.tone}>
                                  {confidenceBadge.label}
                                </Badge>
                              </InlineStack>
                              <Text as="span" variant="bodySm" tone="subdued">
                                类别: {asset.category} | 建议迁移方式: {asset.suggestedMigration}
                              </Text>
                            </BlockStack>
                          </InlineStack>
                        </BlockStack>
                      </Box>
                    );
                  })}
                </BlockStack>
              </BlockStack>
            )}

            {/* 处理结果提示 */}
            {fetcher.data?.processed && (
              <Banner tone="success">
                <Text as="p" variant="bodySm">
                  成功创建 {fetcher.data.processed.created} 个新资产，
                  更新 {fetcher.data.processed.updated} 个现有资产
                  {fetcher.data.processed.duplicates > 0 &&
                    `，跳过 ${fetcher.data.processed.duplicates} 个重复项`}
                </Text>
              </Banner>
            )}

            {fetcher.data?.error && (
              <Banner tone="critical">
                <Text as="p" variant="bodySm">{fetcher.data.error}</Text>
              </Banner>
            )}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

