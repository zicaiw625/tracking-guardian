import { useState, useCallback, useEffect, Suspense } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Banner,
  Badge,
  Box,
  Divider,
  List,
  Spinner,
} from "@shopify/polaris";
import type { ScriptAnalysisResult } from "~/services/scanner/types";
import type { ScriptCodeEditorProps } from "~/components/scan/ScriptCodeEditor";

export interface ManualPastePanelProps {
  shopId: string;
  onAssetsCreated?: (count: number) => void;
  scriptCodeEditor: React.ComponentType<ScriptCodeEditorProps>;
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

export function ManualPastePanel({
  shopId: _shopId,
  onAssetsCreated: _onAssetsCreated,
  scriptCodeEditor,
}: ManualPastePanelProps) {
  const Editor = scriptCodeEditor;
  const [scriptContent, setScriptContent] = useState("");
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isProcessing] = useState(false);
  const [realtimeAnalysisResult, setRealtimeAnalysisResult] = useState<ScriptAnalysisResult | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [piiWarnings, setPiiWarnings] = useState<string[]>([]);
  const [detectedSnippets, setDetectedSnippets] = useState<
    Array<{ platform: string; content: string; startIndex: number; endIndex: number }>
  >([]);
  const detectPII = useCallback((content: string): string[] => {
    const warnings: string[] = [];
    if (!content.trim()) {
      return warnings;
    }
    const piiPatterns = [
      {
        pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
        message: "检测到可能的邮箱地址，请替换为占位符",
        type: "email",
      },
      {
        pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b|\b\+?\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}\b/g,
        message: "检测到可能的电话号码，请替换为占位符",
        type: "phone",
      },
      {
        pattern: /\b\d{4}[-.\s]?\d{4}[-.\s]?\d{4}[-.\s]?\d{4}\b/g,
        message: "检测到可能的信用卡号，请立即删除",
        type: "credit_card",
      },
      {
        pattern: /\b[A-Za-z0-9]{20,}\b/g,
        message: "检测到可能的长字符串（可能是 API 密钥或令牌），请检查并替换",
        type: "token",
      },
      {
        pattern:
          /(?:api[_-]?key|access[_-]?token|bearer[_-]?token|secret[_-]?key|private[_-]?key)\s*[:=]\s*['"]?([A-Za-z0-9_.-]{20,})['"]?/gi,
        message: "检测到 API 密钥或访问令牌，请替换为 [TOKEN_REDACTED]",
        type: "api_key",
      },
      {
        pattern: /(?:password|pwd|pass)\s*[:=]\s*['"]?([^'"]+)['"]?/gi,
        message: "检测到密码字段，请立即删除",
        type: "password",
      },
    ];
    piiPatterns.forEach(({ pattern, message, type: _type }) => {
      const matches = content.match(pattern);
      if (matches && matches.length > 0) {
        const uniqueMatches = Array.from(new Set(matches)).slice(0, 3);
        warnings.push(`${message}（检测到 ${matches.length} 处，示例：${uniqueMatches.join(", ")})`);
      }
    });
    return warnings;
  }, []);
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
  const detectScriptSnippets = useCallback(
    (content: string): Array<{ platform: string; content: string; startIndex: number; endIndex: number }> => {
      const snippets: Array<{ platform: string; content: string; startIndex: number; endIndex: number }> = [];
      if (!content.trim()) {
        return snippets;
      }
      const platformPatterns: Array<{ platform: string; patterns: RegExp[] }> = [
        {
          platform: "Meta Pixel",
          patterns: [/<script[^>]*>[\s\S]*?fbq\s*\([^)]*\)[\s\S]*?<\/script>/gi, /fbq\s*\(['"]init['"]\s*,[^)]+\)/gi],
        },
        {
          platform: "Google Analytics",
          patterns: [
            /<script[^>]*>[\s\S]*?gtag\s*\([^)]*\)[\s\S]*?<\/script>/gi,
            /gtag\s*\(['"]config['"]\s*,\s*['"]G-[A-Z0-9]+['"]/gi,
          ],
        },
        {
          platform: "TikTok Pixel",
          patterns: [/<script[^>]*>[\s\S]*?ttq\s*[.(][^)]*\)[\s\S]*?<\/script>/gi, /ttq\s*\.\s*load\s*\([^)]+\)/gi],
        },
        {
          platform: "Pinterest Tag",
          patterns: [
            /<script[^>]*>[\s\S]*?pintrk\s*\([^)]*\)[\s\S]*?<\/script>/gi,
            /pintrk\s*\(['"]load['"]\s*,[^)]+\)/gi,
          ],
        },
        {
          platform: "Snapchat Pixel",
          patterns: [
            /<script[^>]*>[\s\S]*?snaptr\s*\([^)]*\)[\s\S]*?<\/script>/gi,
            /snaptr\s*\(['"]init['"]\s*,[^)]+\)/gi,
          ],
        },
      ];
      platformPatterns.forEach(({ platform, patterns }) => {
        patterns.forEach((pattern) => {
          let match;
          while ((match = pattern.exec(content)) !== null) {
            snippets.push({
              platform,
              content: match[0],
              startIndex: match.index,
              endIndex: match.index + match[0].length,
            });
          }
        });
      });
      const scriptTagMatches = content.matchAll(/<script[^>]*>[\s\S]*?<\/script>/gi);
      for (const match of scriptTagMatches) {
        const scriptContent = match[0];
        if (scriptContent.length > 50) {
          let detectedPlatform = "未知脚本";
          if (/fbq|facebook/i.test(scriptContent)) {
            detectedPlatform = "Meta Pixel";
          } else if (/gtag|google-analytics|G-[A-Z0-9]+/i.test(scriptContent)) {
            detectedPlatform = "Google Analytics";
          } else if (/ttq|tiktok/i.test(scriptContent)) {
            detectedPlatform = "TikTok Pixel";
          } else if (/pintrk|pinterest/i.test(scriptContent)) {
            detectedPlatform = "Pinterest Tag";
          } else if (/snaptr|snapchat/i.test(scriptContent)) {
            detectedPlatform = "Snapchat Pixel";
          }
          snippets.push({
            platform: detectedPlatform,
            content: scriptContent,
            startIndex: match.index,
            endIndex: match.index + scriptContent.length,
          });
        }
      }
      return snippets.sort((a, b) => a.startIndex - b.startIndex);
    },
    []
  );
  useEffect(() => {
    if (scriptContent.trim()) {
      const errors = validateScript(scriptContent);
      const warnings = detectPII(scriptContent);
      const snippets = detectScriptSnippets(scriptContent);
      setValidationErrors(errors);
      setPiiWarnings(warnings);
      setDetectedSnippets(snippets);
    } else {
      setValidationErrors([]);
      setPiiWarnings([]);
      setDetectedSnippets([]);
    }
  }, [scriptContent, validateScript, detectPII, detectScriptSnippets]);
  const performLocalAnalysis = useCallback(
    (content: string): AnalysisResult | null => {
      if (!content.trim()) {
        return null;
      }
      const snippets = detectScriptSnippets(content);
      const assets: AnalysisResult["assets"] = [];
      const identifiedCategories: Record<string, number> = {
        pixel: 0,
        affiliate: 0,
        survey: 0,
        support: 0,
        analytics: 0,
        other: 0,
      };
      const identifiedPlatforms = new Set<string>();
      for (const snippet of snippets) {
        const platform = snippet.platform;
        if (platform && platform !== "未知脚本") {
          identifiedPlatforms.add(platform);
        }
        let category: string = "other";
        if (platform.includes("Pixel") || platform.includes("Analytics") || platform.includes("Tag")) {
          category = "pixel";
          identifiedCategories.pixel++;
        } else if (platform.includes("Survey") || platform.includes("问卷")) {
          category = "survey";
          identifiedCategories.survey++;
        } else {
          identifiedCategories.other++;
        }
        assets.push({
          category,
          platform: platform !== "未知脚本" ? platform : undefined,
          displayName: platform,
          riskLevel: "medium" as const,
          suggestedMigration: category === "pixel" ? "web_pixel" : "none",
          confidence: "medium" as const,
        });
      }
      const overallRiskLevel = assets.length > 0 ? ("medium" as const) : ("low" as const);
      return {
        assets,
        summary: {
          totalSnippets: snippets.length,
          identifiedCategories,
          identifiedPlatforms: Array.from(identifiedPlatforms),
          overallRiskLevel,
        },
      };
    },
    [detectScriptSnippets]
  );
  const handleAnalyze = useCallback(() => {
    if (!scriptContent.trim()) {
      return;
    }
    const errors = validateScript(scriptContent);
    if (errors.length > 0) {
      setValidationErrors(errors);
    }
    setIsAnalyzing(true);
    const result = performLocalAnalysis(scriptContent);
    if (result) {
      setAnalysisResult(result);
    }
    setIsAnalyzing(false);
  }, [scriptContent, validateScript, performLocalAnalysis]);
  const handleRealtimeAnalysis = useCallback(
    (content: string) => {
      if (!content.trim()) return;
      const result = performLocalAnalysis(content);
      if (result) {
        setRealtimeAnalysisResult({
          identifiedPlatforms: result.summary.identifiedPlatforms,
          platformDetails: result.assets.map((a) => ({
            platform: a.platform || "unknown",
            type: a.category,
            confidence: a.confidence,
            matchedPattern: a.displayName,
          })),
          risks: [],
          riskScore:
            result.summary.overallRiskLevel === "high" ? 70 : result.summary.overallRiskLevel === "medium" ? 40 : 20,
          recommendations: [],
        });
      }
    },
    [performLocalAnalysis]
  );
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
          <BlockStack gap="400">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              📋 如何获取 Additional Scripts（Shopify 官方升级向导步骤）
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              按照以下详细步骤操作，确保正确获取所有需要迁移的脚本。这些步骤与 Shopify 官方升级向导一致：
            </Text>
            <Banner tone="warning">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  📸 截图式引导（强烈推荐）
                </Text>
                <Text as="p" variant="bodySm">
                  按照 Shopify 官方升级向导的步骤，建议对每个关键步骤进行截图保存。这可以帮助您：
                </Text>
                <List type="bullet">
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      确认找到了正确的位置（Settings → Checkout → Review customizations）
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      记录 Additional Scripts 文本框的完整内容和位置
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      在需要时重新查看脚本内容，避免重复操作
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      如果遇到问题，可以提供给技术支持参考，加快问题解决速度
                    </Text>
                  </List.Item>
                </List>
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  关键截图位置（Shopify 官方升级向导推荐）：
                </Text>
                <List type="number">
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      截图 1：Shopify Admin → Settings → Checkout 页面（显示完整的结账设置界面）
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      📸 建议：确保截图中包含左侧导航栏的"设置"选项和右侧的"结账和订单处理"标题，以便确认位置正确
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      截图 2：Additional Scripts 文本框区域（包含文本框标题和完整内容）
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      📸 建议：在结账设置页面中，向下滚动到"订单状态页面"部分，找到"Additional
                      Scripts"文本框，确保截图中包含文本框标题和完整的多行输入框
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      截图 3：如果文本框中有脚本内容，建议单独截图脚本内容区域（便于后续参考）
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      📸 建议：如果 Additional Scripts
                      文本框中有现有脚本，建议放大文本框区域并单独截图，确保脚本内容清晰可见，便于后续分析和迁移
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      截图 4：Review customizations 页面（如果 Shopify 升级向导显示）
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      📸 建议：如果 Shopify 升级向导显示了"Review
                      customizations"页面，建议截图保存，该页面会列出所有需要迁移的脚本和功能清单
                    </Text>
                  </List.Item>
                </List>
                <Banner tone="info">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      📖 Shopify 官方升级向导路径
                    </Text>
                    <Text as="p" variant="bodySm">
                      按照 Shopify 官方升级向导的步骤，您可以通过以下路径访问：
                    </Text>
                    <List type="number">
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          Settings → Checkout → Review customizations（查看自定义项）
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          在 Review customizations 页面中，Shopify 会列出所有需要迁移的脚本和功能
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          点击每个脚本项，可以查看详细信息和迁移建议
                        </Text>
                      </List.Item>
                    </List>
                    <Text as="p" variant="bodySm" tone="subdued">
                      💡 提示：如果您的店铺尚未看到升级向导，说明 Shopify
                      可能尚未为您的店铺启用升级流程。此时，您可以直接在 Settings → Checkout 中找到 Additional Scripts
                      区域。
                    </Text>
                  </BlockStack>
                </Banner>
              </BlockStack>
            </Banner>
            <List type="number">
              <List.Item>
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    步骤 1：进入 Shopify Admin 后台
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    登录您的 Shopify Admin 后台（https://admin.shopify.com），点击左下角的"设置"（Settings）图标
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    💡 提示：确保您有管理员权限，否则可能无法访问设置页面
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    📸 界面位置：设置图标位于 Shopify Admin 左侧导航栏的最底部，图标为齿轮形状
                  </Text>
                </BlockStack>
              </List.Item>
              <List.Item>
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    步骤 2：打开结账设置
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    在设置页面中，找到并点击「结账和订单处理」（Checkout and order processing）选项
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    💡 提示：如果找不到此选项，请确认您的 Shopify 计划是否支持自定义结账设置
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    📸 界面位置：在设置页面的主列表中，查找"结账和订单处理"或"Checkout and order
                    processing"选项，通常位于"客户"和"配送"设置之间
                  </Text>
                </BlockStack>
              </List.Item>
              <List.Item>
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    步骤 3：找到 Additional Scripts 区域
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    在结账设置页面中，向下滚动找到「订单状态页面」（Order status page）部分，或直接查找「Additional
                    Scripts」文本框区域
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    💡 提示：如果看不到 Additional Scripts 区域，可能您的店铺已经升级到新版 Thank you / Order status
                    页面，此时该区域可能已隐藏或移至其他位置。请参考 Shopify 官方文档确认当前页面版本。
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    📍 位置说明：Additional Scripts 通常位于"订单状态页面"设置区域的下方，是一个多行文本输入框
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    📸 界面位置：在结账设置页面中，向下滚动到"订单状态页面"部分，您会看到一个标题为"Additional
                    Scripts"或"额外脚本"的文本框区域。该文本框通常显示为灰色边框的多行输入框，可能包含现有的脚本代码
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    📷 截图建议：找到 Additional Scripts
                    文本框后，建议先截图保存，确保您找到了正确的位置。如果文本框中有内容，也建议截图保存，以便后续参考。
                  </Text>
                </BlockStack>
              </List.Item>
              <List.Item>
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    步骤 4：复制脚本内容
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    选中 Additional Scripts 文本框中的所有内容（包括所有 &lt;script&gt; 标签和代码），使用
                    Ctrl+C（Windows）或 Cmd+C（Mac）复制
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    ⚠️ 重要：请确保复制完整的脚本内容，包括所有 &lt;script&gt;
                    标签的开头和结尾。如果脚本内容很长，请使用 Ctrl+A（Windows）或 Cmd+A（Mac）全选后再复制。
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    💡 提示：如果脚本内容包含多段代码，请确保全部选中并复制。系统会自动识别和分类多段脚本
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    📸 操作提示：点击 Additional Scripts 文本框，使用鼠标拖拽选中所有内容，或使用键盘快捷键
                    Ctrl+A（Windows）/ Cmd+A（Mac）全选，然后使用 Ctrl+C（Windows）/ Cmd+C（Mac）复制
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
                    💡
                    提示：系统支持多段脚本自动识别和分类。如果粘贴后没有识别出任何脚本，请检查是否复制了完整内容，或尝试重新复制。
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    📸 操作提示：点击下方"粘贴脚本内容"文本框，使用 Ctrl+V（Windows）/
                    Cmd+V（Mac）粘贴，然后点击"分析脚本"按钮
                  </Text>
                </BlockStack>
              </List.Item>
            </List>
            <Divider />
            <Banner tone="critical">
              <BlockStack gap="300">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  ⚠️ 粘贴前必须脱敏敏感信息
                </Text>
                <Text as="p" variant="bodySm">
                  系统会自动检测以下敏感信息,如果检测到会阻止分析。请在粘贴前先删除或替换这些信息:
                </Text>
                <List type="bullet">
                  <List.Item>
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      API 密钥和访问令牌:
                    </Text>
                    <Text as="span" variant="bodySm">
                      {" "}
                      如 <code>api_key</code>、<code>access_token</code>、<code>bearer token</code> 等,请替换为{" "}
                      <code>[API_KEY_REDACTED]</code> 或删除
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      客户个人信息 (PII):
                    </Text>
                    <Text as="span" variant="bodySm">
                      {" "}
                      如邮箱地址、电话号码、信用卡号等,请替换为占位符或删除
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      私钥和密码:
                    </Text>
                    <Text as="span" variant="bodySm">
                      {" "}
                      如 <code>secret</code>、<code>password</code>、<code>private key</code> 等,请替换为{" "}
                      <code>[SECRET_REDACTED]</code> 或删除
                    </Text>
                  </List.Item>
                </List>
                <Banner tone="info">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      💡 脱敏示例（仅用于演示，非真实凭证）:
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      原代码（示例）:{" "}
                      <code>
                        fbq('init', 'EXAMPLE_PIXEL_ID_12345', &#123;access_token: 'EXAMPLE_TOKEN_EAABsbCS1iHg...'&#125;)
                      </code>
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      脱敏后:{" "}
                      <code>fbq('init', '[PIXEL_ID_REDACTED]', &#123;access_token: '[TOKEN_REDACTED]'&#125;)</code>
                    </Text>
                  </BlockStack>
                </Banner>
              </BlockStack>
            </Banner>
            <Banner tone="warning">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  ⚠️ 重要提示
                </Text>
                <List type="bullet">
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      Shopify API 无法自动读取 Additional Scripts 内容,因此需要手动复制粘贴。这是 Shopify
                      平台的安全限制。
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      系统支持多段脚本自动识别和分类,并会基于脚本内容的 fingerprint 自动去重
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      系统会自动识别常见脚本片段(如 Meta Pixel、Google Analytics、TikTok Pixel 等),并一键拆分分析
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      如果 Additional Scripts 区域为空,说明您的店铺可能没有配置额外的追踪脚本
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      分析在浏览器本地完成,不会上传脚本正文;仅识别出的平台信息会用于生成迁移建议
                    </Text>
                  </List.Item>
                </List>
              </BlockStack>
            </Banner>
            <Banner tone="info">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  📖 参考 Shopify 官方文档
                </Text>
                <Text as="p" variant="bodySm">
                  如需更多帮助，请参考 Shopify 官方升级向导：
                </Text>
                <Text as="p" variant="bodySm">
                  <a
                    href="https://shopify.dev/docs/apps/checkout/upgrade-guide"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Shopify Checkout Upgrade Guide
                  </a>
                </Text>
              </BlockStack>
            </Banner>
            <Banner tone="info">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  🔒 隐私说明
                </Text>
                <Text as="p" variant="bodySm">
                  本工具仅在浏览器本地分析脚本内容，不会上传脚本正文到服务器。分析结果仅用于帮助您识别追踪平台和风险等级，不会保存到数据库。
                </Text>
              </BlockStack>
            </Banner>
          </BlockStack>
        </Banner>
        {piiWarnings.length > 0 && (
          <Banner tone="critical">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                ⚠️ 检测到敏感信息（PII），请立即处理：
              </Text>
              <List>
                {piiWarnings.map((warning, index) => (
                  <List.Item key={index}>
                    <Text as="span" variant="bodySm">
                      {warning}
                    </Text>
                  </List.Item>
                ))}
              </List>
              <Text as="p" variant="bodySm" tone="subdued">
                请在粘贴前删除或替换所有敏感信息。系统已自动检测到上述内容，建议您先处理这些敏感信息再进行分析。
              </Text>
            </BlockStack>
          </Banner>
        )}
        {detectedSnippets.length > 0 && (
          <Banner tone="info">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                ✅ 已识别 {detectedSnippets.length} 个脚本片段：
              </Text>
              <List>
                {detectedSnippets.map((snippet, index) => (
                  <List.Item key={index}>
                    <Text as="span" variant="bodySm">
                      <strong>{snippet.platform}</strong>（位置：{snippet.startIndex + 1}-{snippet.endIndex} 字符）
                    </Text>
                  </List.Item>
                ))}
              </List>
              <Text as="p" variant="bodySm" tone="subdued">
                💡 提示：系统已自动识别上述脚本片段。点击"分析脚本"按钮后，系统会自动拆分并分析每个片段。
              </Text>
            </BlockStack>
          </Banner>
        )}
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
        <Suspense
          fallback={
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
          }
        >
          <Editor
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
          <Banner tone="info">
            <Text as="p" variant="bodySm">
              分析完成。本工具仅提供本地分析结果，不会将脚本内容保存到服务器。如需保存分析结果，请手动记录识别到的平台和风险等级。
            </Text>
          </Banner>
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
                  {riskLevelBadge && <Badge tone={riskLevelBadge.tone}>{riskLevelBadge.label}</Badge>}
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
                        const riskBadgeMap: Record<
                          string,
                          { tone: "critical" | "success" | undefined; label: string }
                        > = {
                          high: { tone: "critical", label: "高" },
                          medium: { tone: undefined, label: "中" },
                          low: { tone: "success", label: "低" },
                        };
                        const riskBadge = riskBadgeMap[asset.riskLevel] || riskBadgeMap.medium;
                        const confidenceBadgeMap: Record<
                          string,
                          { tone: "success" | "info" | undefined; label: string }
                        > = {
                          high: { tone: "success", label: "高置信度" },
                          medium: { tone: "info", label: "中置信度" },
                          low: { tone: undefined, label: "低置信度" },
                        };
                        const confidenceBadge = confidenceBadgeMap[asset.confidence] || confidenceBadgeMap.medium;
                        return (
                          <Box key={index} background="bg-surface-secondary" padding="300" borderRadius="200">
                            <BlockStack gap="200">
                              <InlineStack align="space-between" blockAlign="start">
                                <BlockStack gap="100">
                                  <InlineStack gap="200" wrap>
                                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                                      {asset.displayName}
                                    </Text>
                                    {asset.platform && <Badge>{asset.platform}</Badge>}
                                    <Badge tone={riskBadge.tone}>{`${riskBadge.label}风险`}</Badge>
                                    <Badge tone={confidenceBadge.tone}>{confidenceBadge.label}</Badge>
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
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}
