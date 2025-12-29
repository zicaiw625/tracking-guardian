import { useState, useCallback } from "react";
import {
  Card,
  BlockStack,
  Box,
  InlineStack,
  Text,
  Badge,
  Button,
  Banner,
  Layout,
  TextField,
  List,
  Icon,
  Divider,
} from "@shopify/polaris";
import { ClipboardIcon, ArrowRightIcon, SettingsIcon, AlertCircleIcon, CheckCircleIcon, ShareIcon } from "~/components/icons";
import { analyzeScriptContent } from "../../services/scanner/content-analysis";
import type { ScriptAnalysisResult } from "../../services/scanner.server";
import { getSeverityBadge, getPlatformName } from "./utils";
import { AnalysisResultSummary } from "./AnalysisResultSummary";

interface DeprecationInfo {
  badge: { text: string };
  description: string;
}

interface ManualAnalysisProps {
  deprecationStatus?: {
    additionalScripts: DeprecationInfo;
  } | null;
}

export function ManualAnalysis({ deprecationStatus }: ManualAnalysisProps) {
  const [scriptContent, setScriptContent] = useState("");
  const [analysisResult, setAnalysisResult] = useState<ScriptAnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const handleAnalyzeScript = useCallback(() => {
    // 输入验证
    const MAX_CONTENT_LENGTH = 500000; // 500KB 限制
    const trimmedContent = scriptContent.trim();
    
    if (!trimmedContent) {
      setAnalysisError("请输入脚本内容");
      return;
    }
    
    if (trimmedContent.length > MAX_CONTENT_LENGTH) {
      setAnalysisError(`脚本内容过长（最多 ${MAX_CONTENT_LENGTH} 个字符）。请分段分析或联系支持。`);
      return;
    }
    
    setIsAnalyzing(true);
    setAnalysisError(null);
    
    try {
      const result = analyzeScriptContent(trimmedContent);
      setAnalysisResult(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "分析失败，请稍后重试";
      setAnalysisError(errorMessage);
      // 客户端组件使用 console.error 是合理的，但确保错误信息详细
      const errorDetails = error instanceof Error ? error.stack : String(error);
      console.error("Script analysis error:", {
        message: errorMessage,
        details: errorDetails,
        contentLength: trimmedContent.length,
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, [scriptContent]);
  return (
    <BlockStack gap="500">
      <Box paddingBlockStart="400">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              手动分析 Additional Scripts
            </Text>
            <BlockStack gap="200">
              <Text as="p" tone="subdued">
                Shopify API 无法自动读取 Additional Scripts 内容。
                请从 Shopify 后台复制脚本代码，粘贴到下方进行分析。
              </Text>
              <Banner tone="warning" title="隐私提示：请先脱敏再粘贴">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm">
                    • 可能包含客户信息、访问令牌或第三方密钥，请在粘贴前删除/替换敏感字段。
                  </Text>
                  <Text as="p" variant="bodySm">
                    • 分析在浏览器本地完成，不会上传脚本正文；仅识别出的平台信息会用于生成迁移建议。
                  </Text>
                  <Text as="p" variant="bodySm">
                    • 我们不会持久化或日志记录您粘贴的内容；仅在浏览器会话内用于本地分析。
                  </Text>
                </BlockStack>
              </Banner>
            </BlockStack>
            <Banner
              tone="critical"
              title="Plus：2025-08-28 / 非 Plus：2026-08-26 将失效"
            >
              <BlockStack gap="100">
                <Text as="p" variant="bodySm">
                  这是 Thank you / Order status 页面迁移的硬性截止时间。提前粘贴
                  Additional Scripts 代码并完成迁移，可避免追踪中断。
                </Text>
                {deprecationStatus && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    当前剩余：{deprecationStatus.additionalScripts.badge.text} —{" "}
                    {deprecationStatus.additionalScripts.description}
                  </Text>
                )}
                <InlineStack gap="200">
                  <Button
                    url="/app/migrate"
                    icon={ArrowRightIcon}
                    size="slim"
                    variant="primary"
                  >
                    前往迁移页面
                  </Button>
                  <Button
                    url="/app/migrate#pixel"
                    icon={SettingsIcon}
                    size="slim"
                    variant="secondary"
                  >
                    启用/升级 App Pixel
                  </Button>
                </InlineStack>
              </BlockStack>
            </Banner>
            <Banner tone="info">
              <BlockStack gap="200">
                <Text as="p" fontWeight="semibold">
                  如何获取 Additional Scripts：
                </Text>
                <Text as="p" variant="bodySm">
                  1. 前往 Shopify 后台 → 设置 → 结账
                  <br />
                  2. 找到「订单状态页面」或「Additional Scripts」区域
                  <br />
                  3. 复制其中的所有代码
                  <br />
                  4. 粘贴到下方文本框中
                </Text>
              </BlockStack>
            </Banner>
            <TextField
              label="粘贴脚本内容"
              value={scriptContent}
              onChange={setScriptContent}
              multiline={8}
              autoComplete="off"
              placeholder={`<!-- 示例 -->
<script>
  gtag('event', 'purchase', {...});
  fbq('track', 'Purchase', {...});
</script>`}
              helpText="支持检测 Google、Meta、TikTok、Bing 等平台的追踪代码"
            />
            <InlineStack align="end">
              <Button
                variant="primary"
                onClick={handleAnalyzeScript}
                loading={isAnalyzing}
                disabled={!scriptContent.trim()}
                icon={ClipboardIcon}
              >
                分析脚本
              </Button>
            </InlineStack>
            {analysisError && (
              <Banner tone="critical">
                <Text as="p" variant="bodySm">
                  {analysisError}
                </Text>
              </Banner>
            )}
          </BlockStack>
        </Card>
      </Box>
      {analysisResult && <AnalysisResultSummary analysisResult={analysisResult} />}
      {                  }
      {analysisResult && analysisResult.risks.length > 0 && (
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              风险详情
            </Text>
            <BlockStack gap="300">
              {analysisResult.risks.map((risk, index) => (
                <Box
                  key={index}
                  background="bg-surface-secondary"
                  padding="400"
                  borderRadius="200"
                >
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <InlineStack gap="200">
                        <Icon
                          source={AlertCircleIcon}
                          tone={
                            risk.severity === "high"
                              ? "critical"
                              : risk.severity === "medium"
                              ? "warning"
                              : "info"
                          }
                        />
                        <Text as="span" fontWeight="semibold">
                          {risk.name}
                        </Text>
                      </InlineStack>
                      {getSeverityBadge(risk.severity)}
                    </InlineStack>
                    <Text as="p" tone="subdued">
                      {risk.description}
                    </Text>
                    {risk.details && (
                      <Text as="p" variant="bodySm">
                        {risk.details}
                      </Text>
                    )}
                  </BlockStack>
                </Box>
              ))}
            </BlockStack>
          </BlockStack>
        </Card>
      )}
      {                     }
      {analysisResult && analysisResult.recommendations.length > 0 && (
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">
                迁移建议清单
              </Text>
              <Badge tone="info">人工分析结果</Badge>
            </InlineStack>
            <BlockStack gap="300">
              {analysisResult.recommendations.map((rec, index) => {
                const lines = rec.split("\n");
                const titleLine = lines[0] || "";
                const titleMatch = titleLine.match(/\*\*(.*?)\*\*/);
                const title = titleMatch
                  ? titleMatch[1]
                  : titleLine.replace(/^[^\w\u4e00-\u9fa5]+/, "");
                const details = lines
                  .slice(1)
                  .map((l) => l.trim())
                  .filter((l) => l.length > 0);
                const linkLine = details.find((l) => l.includes("http"));
                const urlMatch = linkLine?.match(/(https?:\/\/[^\s]+)/);
                const url = urlMatch ? urlMatch[1] : null;
                const isInternal =
                  title.includes("Google Analytics") ||
                  title.includes("Meta Pixel") ||
                  title.includes("TikTok");
                const isExternal = !!url;
                if (rec.includes("迁移清单建议")) {
                  return (
                    <Box
                      key={index}
                      background="bg-surface-secondary"
                      padding="400"
                      borderRadius="200"
                    >
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">
                          📋 综合迁移建议
                        </Text>
                        <List type="number">
                          {details.map((d, i) => {
                            const cleanText = d.replace(/^\d+\.\s*/, "").trim();
                            if (!cleanText) return null;
                            return <List.Item key={i}>{cleanText}</List.Item>;
                          })}
                        </List>
                      </BlockStack>
                    </Box>
                  );
                }
                return (
                  <Box
                    key={index}
                    background="bg-surface-secondary"
                    padding="400"
                    borderRadius="200"
                  >
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="start">
                        <BlockStack gap="100">
                          <Text as="h3" variant="headingSm">
                            {title}
                          </Text>
                          {details.map((line, i) => (
                            <Text key={i} as="p" variant="bodySm" tone="subdued">
                              {line}
                            </Text>
                          ))}
                        </BlockStack>
                        {isInternal && (
                          <Button url="/app/migrate" size="slim" icon={ArrowRightIcon}>
                            去配置
                          </Button>
                        )}
                        {isExternal && !isInternal && (
                          <Button url={url!} external size="slim" icon={ShareIcon}>
                            查看应用
                          </Button>
                        )}
                      </InlineStack>
                    </BlockStack>
                  </Box>
                );
              })}
            </BlockStack>
            <Divider />
            <Button url="/app/migrate" variant="primary">
              前往迁移工具
            </Button>
          </BlockStack>
        </Card>
      )}
    </BlockStack>
  );
}
