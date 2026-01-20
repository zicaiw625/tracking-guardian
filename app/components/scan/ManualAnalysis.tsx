import { useState, useCallback, useEffect, useRef } from "react";
import {
  Card,
  BlockStack,
  Box,
  InlineStack,
  Text,
  Badge,
  Button,
  Banner,
  TextField,
  List,
  Icon,
  Divider,
} from "@shopify/polaris";
import { ClipboardIcon, ArrowRightIcon, SettingsIcon, AlertCircleIcon, ShareIcon } from "~/components/icons";
import { analyzeScriptContent } from "../../services/scanner/content-analysis";
import type { ScriptAnalysisResult } from "../../services/scanner.server";
import { getSeverityBadge } from "./utils";
import { DEPRECATION_DATES, formatDeadlineDate } from "../../utils/migration-deadlines";
import { AnalysisResultSummary } from "./AnalysisResultSummary";

interface DeprecationInfo {
  badge: { text: string };
  description: string;
}

interface ManualAnalysisProps {
  deprecationStatus?: {
    additionalScripts: DeprecationInfo;
  } | null;
  scriptAnalysisMaxContentLength?: number;
}

export function ManualAnalysis({ deprecationStatus, scriptAnalysisMaxContentLength = 500000 }: ManualAnalysisProps) {
  const [scriptContent, setScriptContent] = useState("");
  const [analysisResult, setAnalysisResult] = useState<ScriptAnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const handleAnalyzeScript = useCallback(async () => {
    const MAX_CONTENT_LENGTH = scriptAnalysisMaxContentLength;
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
      if (isMountedRef.current) {
        setAnalysisResult(result);
      }
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }
      const errorMessage = error instanceof Error ? error.message : "分析失败，请稍后重试";
      setAnalysisError(errorMessage);
      setAnalysisResult(null);
      if (process.env.NODE_ENV === "development") {
        const errorDetails = error instanceof Error ? error.stack : String(error);
        console.error("Script analysis error:", {
          message: errorMessage,
          details: errorDetails,
          contentLength: trimmedContent.length,
        });
      }
    } finally {
      if (isMountedRef.current) {
        setIsAnalyzing(false);
      }
    }
  }, [scriptContent, scriptAnalysisMaxContentLength]);
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
              title={`Plus：${formatDeadlineDate(DEPRECATION_DATES.plusScriptTagExecutionOff, "exact")} / 非 Plus：${formatDeadlineDate(DEPRECATION_DATES.nonPlusScriptTagExecutionOff, "exact")} 将失效`}
            >
              <BlockStack gap="100">
                <Text as="p" variant="bodySm">
                  这是 Thank you / Order status 页面迁移的硬性截止时间。提前粘贴
                  Additional Scripts 代码并完成迁移，可避免追踪中断。
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  <strong>重要提示：</strong>以上日期来自 Shopify 官方公告，仅供参考。实际截止日期请以 Shopify Admin 中的提示为准。Shopify 可能会更新策略，我们建议您定期查看 Shopify 官方文档。
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
              <BlockStack gap="300">
                <Text as="p" fontWeight="semibold">
                  如何获取 Additional Scripts（详细步骤指南）：
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  📖 参考文档：<a href="https://help.shopify.com/en/manual/checkout-settings/order-status-page/additional-scripts" target="_blank" rel="noopener noreferrer">Shopify 官方文档：Additional Scripts</a>
                </Text>
                <Divider />
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  📸 截图式操作指南（建议按步骤截图保存）：
                </Text>
                <List type="number">
                  <List.Item>
                    <BlockStack gap="200">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        步骤 1：登录 Shopify Admin 后台
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        访问 <a href="https://admin.shopify.com" target="_blank" rel="noopener noreferrer">https://admin.shopify.com</a> 并使用管理员账号登录
                      </Text>
                      <Banner tone="info">
                        <Text as="p" variant="bodySm">
                          📸 <strong>截图提示：</strong>登录后，建议截图保存当前页面，便于后续参考。截图应包含页面顶部导航栏，确认已成功登录。
                        </Text>
                      </Banner>
                    </BlockStack>
                  </List.Item>
                  <List.Item>
                    <BlockStack gap="200">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        步骤 2：前往设置 → 结账
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        点击左下角的"设置"（Settings）图标（齿轮图标）→ 在设置菜单中找到并点击"结账和订单处理"（Checkout and order processing）
                      </Text>
                      <Banner tone="info">
                        <Text as="p" variant="bodySm">
                          📸 <strong>截图提示：</strong>找到"结账和订单处理"选项后，建议截图保存，确保您找到了正确的位置。截图应包含左侧菜单中的"结账和订单处理"选项。
                        </Text>
                      </Banner>
                      <Text as="span" variant="bodySm" tone="subdued">
                        💡 <strong>提示：</strong>如果找不到此选项，请确认您的 Shopify 计划是否支持自定义结账设置。某些基础计划可能不显示此选项。
                      </Text>
                    </BlockStack>
                  </List.Item>
                  <List.Item>
                    <BlockStack gap="200">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        步骤 3：找到 Additional Scripts 区域
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        在结账设置页面中，向下滚动找到"订单状态页面"（Order status page）部分，查找"Additional Scripts"或"其他脚本"文本框区域
                      </Text>
                      <Banner tone="info">
                        <Text as="p" variant="bodySm">
                          📸 <strong>截图提示：</strong>找到 Additional Scripts 文本框后，建议先截图保存，确保您找到了正确的位置。如果文本框中有内容，也建议截图保存，以便后续参考。截图应清晰显示文本框的完整内容。
                        </Text>
                      </Banner>
                      <Text as="span" variant="bodySm" tone="subdued">
                        💡 <strong>提示：</strong>如果看不到 Additional Scripts 区域，可能您的店铺已经升级到新版 Thank you / Order status 页面，此时该区域可能已隐藏或移至其他位置。请参考 <a href="https://help.shopify.com/en/manual/checkout-settings/order-status-page/additional-scripts" target="_blank" rel="noopener noreferrer">Shopify 官方文档</a> 确认当前页面版本。
                      </Text>
                      <Banner tone="warning">
                        <Text as="p" variant="bodySm">
                          ⚠️ <strong>重要：</strong>Additional Scripts 区域可能位于页面的不同位置，取决于您的 Shopify 版本和主题。如果找不到，请尝试：
                        </Text>
                        <List type="bullet">
                          <List.Item>
                            <Text as="span" variant="bodySm">检查页面是否已完全加载</Text>
                          </List.Item>
                          <List.Item>
                            <Text as="span" variant="bodySm">尝试使用浏览器的搜索功能（Ctrl+F 或 Cmd+F）搜索"Additional Scripts"</Text>
                          </List.Item>
                          <List.Item>
                            <Text as="span" variant="bodySm">查看页面底部的"订单状态页面"部分</Text>
                          </List.Item>
                        </List>
                      </Banner>
                    </BlockStack>
                  </List.Item>
                  <List.Item>
                    <BlockStack gap="200">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        步骤 4：复制脚本内容
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        选中 Additional Scripts 文本框中的所有内容（包括所有 &lt;script&gt; 标签和代码），使用 Ctrl+C（Windows）或 Cmd+C（Mac）复制
                      </Text>
                      <Banner tone="critical">
                        <Text as="p" variant="bodySm" fontWeight="semibold">
                          ⚠️ 重要：请确保复制完整的脚本内容
                        </Text>
                        <Text as="p" variant="bodySm">
                          • 包括所有 &lt;script&gt; 标签的开头和结尾
                        </Text>
                        <Text as="p" variant="bodySm">
                          • 如果脚本内容很长，请使用 Ctrl+A（Windows）或 Cmd+A（Mac）全选后再复制
                        </Text>
                        <Text as="p" variant="bodySm">
                          • 确保没有遗漏任何代码片段
                        </Text>
                      </Banner>
                      <Text as="span" variant="bodySm" tone="subdued">
                        💡 <strong>提示：</strong>如果脚本内容包含多段代码，请确保全部选中并复制。系统会自动识别和分类多段脚本。
                      </Text>
                    </BlockStack>
                  </List.Item>
                  <List.Item>
                    <BlockStack gap="200">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        步骤 5：粘贴并分析
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        将复制的内容粘贴到下方文本框中，系统会自动识别和分析所有追踪脚本
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        💡 <strong>提示：</strong>系统支持多段脚本自动识别和分类。如果粘贴后没有识别出任何脚本，请检查是否复制了完整内容，或尝试重新复制。
                      </Text>
                    </BlockStack>
                  </List.Item>
                </List>
                <Divider />
                <Text as="p" variant="bodySm" tone="subdued">
                  <strong>提示：</strong>如果找不到 Additional Scripts 区域，可能您的店铺尚未配置自定义脚本。某些 Shopify 主题或应用可能会在 Thank you 页面添加追踪代码，这些代码也可能需要迁移。请参考 <a href="https://help.shopify.com/en/manual/checkout-settings/order-status-page/additional-scripts" target="_blank" rel="noopener noreferrer">Shopify 官方文档</a> 了解更多信息。
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
