import { useState, useCallback, useEffect, lazy, Suspense } from "react";
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
import type { ScriptAnalysisResult } from "~/services/scanner/types";

const ScriptCodeEditor = lazy(() =>
  import("~/components/scan/ScriptCodeEditor").then(module => ({
    default: module.ScriptCodeEditor
  }))
);

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
  const [realtimeAnalysisResult, setRealtimeAnalysisResult] = useState<ScriptAnalysisResult | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const fetcher = useFetcher();
  const validateScript = useCallback((content: string): string[] => {
    const errors: string[] = [];
    if (!content.trim()) {
      return errors;
    }
    const dangerousPatterns = [
      {
        pattern: /eval\s*\(/gi,
        message: "检测到 eval() 函数，可能存在安全风险",
      },
      {
        pattern: /document\.cookie\s*=/gi,
        message: "检测到直接操作 cookie，可能违反隐私政策",
      },
      {
        pattern: /innerHTML\s*=/gi,
        message: "检测到 innerHTML 操作，可能存在 XSS 风险",
      },
      {
        pattern: /document\.write\s*\(/gi,
        message: "检测到 document.write()，可能阻塞页面加载",
      },
      {
        pattern: /<script[^>]*src[^>]*>/gi,
        message: "检测到外部脚本引用，需要验证来源",
      },
    ];
    dangerousPatterns.forEach(({ pattern, message }) => {
      if (pattern.test(content)) {
        errors.push(message);
      }
    });
    const scriptTags = content.match(/<script[^>]*>[\s\S]*?<\/script>/gi);
    if (scriptTags) {
      scriptTags.forEach((tag, index) => {
        const openCount = (tag.match(/<script/gi) || []).length;
        const closeCount = (tag.match(/<\/script>/gi) || []).length;
        if (openCount !== closeCount) {
          errors.push(`脚本片段 ${index + 1} 存在未闭合的标签`);
        }
      });
    }
    const unescapedHtml = content.match(/<[^>]+>(?![^<]*<\/script>)/g);
    if (unescapedHtml && unescapedHtml.length > 0) {
      errors.push("检测到未转义的 HTML 标签，可能导致解析错误");
    }
    return errors;
  }, []);
  useEffect(() => {
    if (scriptContent.trim()) {
      const errors = validateScript(scriptContent);
      setValidationErrors(errors);
    } else {
      setValidationErrors([]);
    }
  }, [scriptContent, validateScript]);
  const handleAnalyze = useCallback(() => {
    if (!scriptContent.trim()) {
      return;
    }
    const errors = validateScript(scriptContent);
    if (errors.length > 0) {
      setValidationErrors(errors);
    }
    setIsAnalyzing(true);
    fetcher.submit(
      {
        _action: "analyze_manual_paste",
        content: scriptContent,
      },
      { method: "post" }
    );
  }, [scriptContent, fetcher, validateScript]);
  const handleRealtimeAnalysis = useCallback((content: string) => {
    if (!content.trim()) return;
    fetcher.submit(
      {
        _action: "realtime_analyze_manual_paste",
        content,
      },
      { method: "post" }
    );
  }, [fetcher]);
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
  useEffect(() => {
    if (fetcher.data && typeof fetcher.data === "object" && fetcher.data !== null) {
      const data = fetcher.data as { analysis?: AnalysisResult; realtimeAnalysis?: ScriptAnalysisResult };
      if (data.analysis) {
        setAnalysisResult(data.analysis);
        setIsAnalyzing(false);
      }
      if (data.realtimeAnalysis) {
        setRealtimeAnalysisResult(data.realtimeAnalysis);
      }
    }
  }, [fetcher.data]);
  useEffect(() => {
    if (fetcher.data && typeof fetcher.data === "object" && fetcher.data !== null && "processed" in fetcher.data) {
      const data = fetcher.data as { processed: { created: number; updated: number; duplicates: number } };
      const result = data.processed;
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
              <List.Item>
                支持代码高亮和实时分析，输入时自动检测平台
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  P1-03: 智能去重
                </Text>
                {" - "}
                系统会基于脚本内容的 fingerprint 自动去重，避免重复分析相同的脚本片段
              </List.Item>
            </List>
          </BlockStack>
        </Banner>
        {validationErrors.length > 0 && (
          <Banner tone="warning">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                检测到潜在问题：
              </Text>
              <List>
                {validationErrors.map((error, index) => (
                  <List.Item key={index}>
                    <Text as="span" variant="bodySm">
                      {error}
                    </Text>
                  </List.Item>
                ))}
              </List>
            </BlockStack>
          </Banner>
        )}
        <Suspense fallback={
          <TextField
            label="脚本内容"
            value={scriptContent}
            onChange={setScriptContent}
            multiline={10}
            placeholder="请粘贴您的脚本内容..."
            helpText={`已输入 ${scriptContent.length} 个字符`}
            disabled={isAnalyzing || isProcessing}
            autoComplete="off"
          />
        }>
          <ScriptCodeEditor
            value={scriptContent}
            onChange={setScriptContent}
            onAnalyze={handleAnalyze}
            analysisResult={realtimeAnalysisResult}
            isAnalyzing={isAnalyzing}
            placeholder="请粘贴您的脚本内容，例如：&#10;&#10;&lt;script&gt;&#10;  gtag('config', 'G-XXXXXXXXXX');&#10;  fbq('track', 'Purchase', {value: 100, currency: 'USD'});&#10;&lt;/script&gt;"
            enableRealtimeAnalysis={true}
            onRealtimeAnalysis={handleRealtimeAnalysis}
            enableBatchPaste={true}
          />
        </Suspense>
        {analysisResult && (
          <InlineStack gap="200">
            <Button
              onClick={handleProcess}
              disabled={!canProcess}
              loading={isProcessing}
              variant="primary"
            >
              {isProcessing ? "处理中..." : "创建迁移资产"}
            </Button>
          </InlineStack>
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
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    识别的代码片段：
                  </Text>
                  <Badge>{`${String(analysisResult.summary.totalSnippets)} 个`}</Badge>
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
            {(() => {
              if (analysisResult?.assets && analysisResult.assets.length > 0) {
                return (
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">
                      识别的资产 ({String(analysisResult.assets.length)} 项)
                    </Text>
                    <BlockStack gap="200">
                      {analysisResult.assets.map((asset, index) => {
                        const riskBadgeMap: Record<string, { tone: "critical" | "success" | undefined; label: string }> = {
                          high: { tone: "critical", label: "高" },
                          medium: { tone: undefined, label: "中" },
                          low: { tone: "success", label: "低" },
                        };
                        const riskBadge = riskBadgeMap[asset.riskLevel] || riskBadgeMap.medium;
                        const confidenceBadgeMap: Record<string, { tone: "success" | "info" | undefined; label: string }> = {
                          high: { tone: "success", label: "高置信度" },
                          medium: { tone: "info", label: "中置信度" },
                          low: { tone: undefined, label: "低置信度" },
                        };
                        const confidenceBadge = confidenceBadgeMap[asset.confidence] || confidenceBadgeMap.medium;
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
                                    <Badge tone={riskBadge.tone}>{`${riskBadge.label}风险`}</Badge>
                                    <Badge tone={confidenceBadge.tone}>
                                      {confidenceBadge.label}
                                    </Badge>
                                  </InlineStack>
                                  <Text as="span" variant="bodySm">
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
                );
              }
              return null;
            })()}
            {(() => {
              if (fetcher.data && typeof fetcher.data === "object" && fetcher.data !== null && "processed" in fetcher.data) {
                return (
                  <Banner tone="success">
                    <Text as="p" variant="bodySm">
                      成功创建 {String((fetcher.data as { processed: { created: number } }).processed.created)} 个新资产，
                      更新 {String((fetcher.data as { processed: { updated: number } }).processed.updated)} 个现有资产
                      {(fetcher.data as { processed: { duplicates: number } }).processed.duplicates > 0 &&
                        `，跳过 ${String((fetcher.data as { processed: { duplicates: number } }).processed.duplicates)} 个重复项`}
                    </Text>
                  </Banner>
                );
              }
              return null;
            })()}
            {(() => {
              if (fetcher.data && typeof fetcher.data === "object" && fetcher.data !== null && "error" in fetcher.data) {
                return (
                  <Banner tone="critical">
                    <Text as="p" variant="bodySm">{(fetcher.data as { error: string }).error}</Text>
                  </Banner>
                );
              }
              return null;
            })()}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}
