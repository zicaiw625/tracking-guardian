

import { useState, useEffect, useMemo } from "react";
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
} from "@shopify/polaris";
import { ClipboardIcon, CheckCircleIcon } from "~/components/icons";
import type { ScriptAnalysisResult } from "~/services/scanner/types";

interface ScriptCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onAnalyze: () => void;
  analysisResult: ScriptAnalysisResult | null;
  isAnalyzing: boolean;
  placeholder?: string;
}

function highlightCode(content: string): string {
  if (!content) return "";

  const patterns = [

    {
      regex: /(\w+)\s*\(/g,
      replacement: '<span style="color: #795E26; font-weight: 600">$1</span>(',
    },

    {
      regex: /(['"])(?:(?=(\\?))\2.)*?\1/g,
      replacement: '<span style="color: #A31515">$&</span>',
    },

    {
      regex: /\b\d+\b/g,
      replacement: '<span style="color: #098658">$&</span>',
    },

    {
      regex: /\b(gtag|fbq|ttq|pintrk|snap|twq)\b/gi,
      replacement: '<span style="color: #0451A5; font-weight: 600">$1</span>',
    },

    {
      regex: /['"](purchase|Purchase|CompletePayment|PageView|ViewContent|AddToCart|InitiateCheckout)['"]/gi,
      replacement: '<span style="color: #811F3F; font-weight: 600">$&</span>',
    },

    {
      regex: /(&lt;[^&]+&gt;)/g,
      replacement: '<span style="color: #800000">$1</span>',
    },
  ];

  let highlighted = content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  patterns.forEach(({ regex, replacement }) => {
    highlighted = highlighted.replace(regex, replacement);
  });

  return highlighted;
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
            {result.identifiedPlatforms.length} 个平台
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
                {result.riskScore} / 100
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
}: ScriptCodeEditorProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);

  const highlightedCode = useMemo(() => highlightCode(value), [value]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

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

          {}
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

            {}
            {value && showPreview && (
              <Box
                padding="400"
                background="bg-surface-secondary"
                borderRadius="200"
                borderWidth="025"
                borderColor="border"
                marginBlockStart="300"
              >
                <Text as="p" variant="bodySm" tone="subdued" fontWeight="semibold">
                  代码高亮预览：
                </Text>
                <Box
                  padding="300"
                  background="bg-surface"
                  borderRadius="100"
                  marginBlockStart="200"
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
              </Box>
            )}
          </Box>

          {}
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

