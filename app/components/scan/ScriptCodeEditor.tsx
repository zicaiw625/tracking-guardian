

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  TextField,
  Badge,
  Box,
  Button,
  Icon,
  Banner,
  List,
} from "@shopify/polaris";
import { ClipboardIcon, CheckCircleIcon, InfoIcon } from "~/components/icons";
import type { ScriptAnalysisResult } from "~/services/scanner/types";

interface ScriptCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onAnalyze: () => void;
  analysisResult: ScriptAnalysisResult | null;
  isAnalyzing: boolean;
  placeholder?: string;
  enableRealtimeAnalysis?: boolean;
  onRealtimeAnalysis?: (content: string) => void;
  enableBatchPaste?: boolean;
}

function highlightCode(content: string): string {
  if (!content) return "";

  let highlighted = content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");

  const patterns = [

    {
      regex: /(&lt;\/?[\w\s="'-]+&gt;)/g,
      replacement: '<span style="color: #800000; font-weight: 500">$1</span>',
    },

    {
      regex: /\b(gtag|fbq|ttq|pintrk|snap|twq|dataLayer\.push)\b/gi,
      replacement: '<span style="color: #0451A5; font-weight: 600">$1</span>',
    },

    {

      regex: /(&#x27;|&quot;)(purchase|Purchase|CompletePayment|PageView|ViewContent|AddToCart|InitiateCheckout|BeginCheckout|Search|ViewItem)(&#x27;|&quot;)/gi,
      replacement: '<span style="color: #811F3F; font-weight: 600">$1$2$3</span>',
    },

    {
      regex: /\b(G-[A-Z0-9]+|AW-\d+|\d{15,16}|[A-Z0-9]{20,30})\b/g,
      replacement: '<span style="color: #098658; font-weight: 500">$1</span>',
    },

    {

      regex: /(&#x27;|&quot;)(?:(?=(\\?))\2.)*?\1/g,
      replacement: '<span style="color: #A31515">$&</span>',
    },

    {
      regex: /\b\d+\.?\d*\b/g,
      replacement: '<span style="color: #098658">$&</span>',
    },

    {
      regex: /(\w+)\s*\(/g,
      replacement: '<span style="color: #795E26; font-weight: 600">$1</span>(',
    },

    {
      regex: /(&lt;!--[\s\S]*?--&gt;|\/\/.*|\/\*[\s\S]*?\*\/)/g,
      replacement: '<span style="color: #6A9955; font-style: italic">$1</span>',
    },
  ];

  patterns.forEach(({ regex, replacement }) => {
    highlighted = highlighted.replace(regex, replacement);
  });

  return highlighted;
}

function detectScriptFragments(content: string): string[] {
  if (!content.trim()) return [];

  const fragments: string[] = [];
  const lines = content.split('\n');
  let currentFragment = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    if (trimmedLine.includes('<script') || trimmedLine.includes('&lt;script')) {
      if (currentFragment.trim()) {
        fragments.push(currentFragment.trim());
        currentFragment = '';
      }
      currentFragment += line + '\n';
    }

    else if (trimmedLine.includes('</script>') || trimmedLine.includes('&lt;/script&gt;')) {
      currentFragment += line + '\n';
      if (currentFragment.trim()) {
        fragments.push(currentFragment.trim());
        currentFragment = '';
      }
    }

    else if (trimmedLine === '' && lines[i + 1]?.trim() === '') {
      if (currentFragment.trim()) {
        fragments.push(currentFragment.trim());
        currentFragment = '';
      }
    }
    else {
      currentFragment += line + '\n';
    }
  }

  if (currentFragment.trim()) {
    fragments.push(currentFragment.trim());
  }

  if (fragments.length === 0 && content.trim()) {
    return [content.trim()];
  }

  return fragments.filter(f => f.length > 0);
}

function PreviewPanel({ result }: { result: ScriptAnalysisResult | null }) {
  if (!result || result.identifiedPlatforms.length === 0) {
    return null;
  }

  return (
    <Box
      background="bg-surface-secondary"
      padding="400"
      borderRadius="200"
      borderWidth="025"
      borderColor="border"
    >
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingSm">
            实时识别结果
          </Text>
          <Badge tone="info">
            {`${result.identifiedPlatforms.length} 个平台`}
          </Badge>
        </InlineStack>

        <BlockStack gap="200">
          {result.identifiedPlatforms.map((platform) => {
            const platformNames: Record<string, string> = {
              google: "Google Analytics",
              meta: "Meta (Facebook)",
              tiktok: "TikTok",
              pinterest: "Pinterest",
              bing: "Microsoft Ads",
              snapchat: "Snapchat",
            };

            const details = result.platformDetails.filter(
              (d) => d.platform === platform
            );

            return (
              <Box
                key={platform}
                background="bg-surface"
                padding="300"
                borderRadius="100"
              >
                <BlockStack gap="100">
                  <InlineStack align="space-between">
                    <Text as="span" fontWeight="semibold">
                      {platformNames[platform] || platform}
                    </Text>
                    <Badge
                      tone={
                        details[0]?.confidence === "high"
                          ? "success"
                          : "attention"
                      }
                    >
                      {details[0]?.confidence === "high" ? "高置信度" : "中置信度"}
                    </Badge>
                  </InlineStack>
                  {details.length > 0 && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      检测到: {details[0].type}
                    </Text>
                  )}
                </BlockStack>
              </Box>
            );
          })}
        </BlockStack>

        {result.riskScore > 0 && (
          <Box paddingBlockStart="200">
            <InlineStack align="space-between">
              <Text as="span" variant="bodySm">
                风险评分
              </Text>
              <Badge
                tone={
                  result.riskScore >= 70
                    ? "critical"
                    : result.riskScore >= 40
                      ? "warning"
                      : "info"
                }
              >
                {`${result.riskScore} / 100`}
              </Badge>
            </InlineStack>
          </Box>
        )}
      </BlockStack>
    </Box>
  );
}

export function ScriptCodeEditor({
  value,
  onChange,
  onAnalyze,
  analysisResult,
  isAnalyzing,
  placeholder,
  enableRealtimeAnalysis = false,
  onRealtimeAnalysis,
  enableBatchPaste = false,
}: ScriptCodeEditorProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fragments, setFragments] = useState<string[]>([]);
  const [activeFragmentIndex, setActiveFragmentIndex] = useState<number | null>(null);
  const analysisTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const highlightedCode = useMemo(() => highlightCode(value), [value]);

  const detectedFragments = useMemo(() => {
    if (!enableBatchPaste || !value.trim()) return [];
    return detectScriptFragments(value);
  }, [value, enableBatchPaste]);

  useEffect(() => {
    if (!enableRealtimeAnalysis || !onRealtimeAnalysis || !value.trim()) {
      return;
    }

    if (analysisTimeoutRef.current) {
      clearTimeout(analysisTimeoutRef.current);
    }

    analysisTimeoutRef.current = setTimeout(() => {
      onRealtimeAnalysis(value);
    }, 500);

    return () => {
      if (analysisTimeoutRef.current) {
        clearTimeout(analysisTimeoutRef.current);
      }
    };
  }, [value, enableRealtimeAnalysis, onRealtimeAnalysis]);

  useEffect(() => {
    if (enableBatchPaste && detectedFragments.length > 0) {
      setFragments(detectedFragments);
    } else {
      setFragments([]);
    }
  }, [detectedFragments, enableBatchPaste]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {

      if (process.env.NODE_ENV === "development") {

        console.error("Failed to copy:", err);
      }
    }
  };

  const handleFragmentClick = useCallback((index: number) => {
    setActiveFragmentIndex(index === activeFragmentIndex ? null : index);
  }, [activeFragmentIndex]);

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              脚本代码编辑器
            </Text>
            <InlineStack gap="200">
              {value && (
                <Button
                  size="slim"
                  variant="plain"
                  onClick={handleCopy}
                  icon={copied ? CheckCircleIcon : ClipboardIcon}
                >
                  {copied ? "已复制" : "复制"}
                </Button>
              )}
              {value && (
                <Button
                  size="slim"
                  variant="plain"
                  onClick={() => setShowPreview(!showPreview)}
                >
                  {showPreview ? "隐藏预览" : "显示预览"}
                </Button>
              )}
            </InlineStack>
          </InlineStack>

          {enableBatchPaste && fragments.length > 1 && (
            <Banner tone="info">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm">
                  检测到 {fragments.length} 个脚本片段，将分别分析
                </Text>
                <List type="bullet">
                  {fragments.map((fragment, index) => (
                    <List.Item key={index}>
                      <Text as="span" variant="bodySm">
                        片段 {index + 1}: {fragment.substring(0, 50)}
                        {fragment.length > 50 ? '...' : ''}
                      </Text>
                    </List.Item>
                  ))}
                </List>
              </BlockStack>
            </Banner>
          )}

          {enableRealtimeAnalysis && value.trim() && (
            <Banner tone="info">
              <Text as="p" variant="bodySm">
                💡 实时分析已启用，输入内容后会自动分析（延迟 500ms）
              </Text>
            </Banner>
          )}

          <Banner>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                如何从 Shopify Admin 复制脚本？
              </Text>
              <List type="number">
                <List.Item>
                  <Text as="span" variant="bodySm">
                    前往 Shopify 后台 → 设置 → 结账
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    找到「Additional scripts」部分
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    复制所有脚本内容并粘贴到下方
                  </Text>
                </List.Item>
              </List>
            </BlockStack>
          </Banner>

          <Box position="relative">
            <TextField
              label="粘贴脚本内容"
              value={value}
              onChange={onChange}
              multiline={12}
              autoComplete="off"
              placeholder={placeholder}
              helpText="支持检测 Google、Meta、TikTok、Pinterest 等平台的追踪代码"
            />

            {value && showPreview && (
              <BlockStack gap="300">
                <Box
                  padding="400"
                  background="bg-surface-secondary"
                  borderRadius="200"
                  borderWidth="025"
                  borderColor="border"
                >
                  <BlockStack gap="300">
                    <Text as="p" variant="bodySm" tone="subdued" fontWeight="semibold">
                      代码高亮预览：
                    </Text>
                    <Box
                      padding="300"
                      background="bg-surface"
                      borderRadius="100"
                    >
                      <pre
                        style={{
                          margin: 0,
                          fontSize: "13px",
                          lineHeight: "1.6",
                          fontFamily:
                            'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                        dangerouslySetInnerHTML={{ __html: highlightedCode }}
                      />
                    </Box>
                  </BlockStack>
                </Box>
              </BlockStack>
            )}
          </Box>

          {analysisResult && <PreviewPanel result={analysisResult} />}

          <InlineStack align="end">
            <Button
              variant="primary"
              onClick={onAnalyze}
              loading={isAnalyzing}
              disabled={!value.trim()}
            >
              分析脚本
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

