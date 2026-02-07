import { useState, useEffect, useMemo, useRef } from "react";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  TextField,
  Badge,
  Box,
  Button,
  Banner,
  List,
} from "@shopify/polaris";
import { ClipboardIcon, CheckCircleIcon } from "~/components/icons";
import type { ScriptAnalysisResult } from "~/services/scanner/types";
import { useTranslation } from "react-i18next";

export interface ScriptCodeEditorProps {
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
  const { t } = useTranslation();
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
            {t("scriptEditor.preview.title")}
          </Text>
          <Badge tone="info">
            {t("scriptEditor.preview.platformCount", { count: result.identifiedPlatforms.length })}
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
                      {details[0]?.confidence === "high" ? t("scriptEditor.preview.highConfidence") : t("scriptEditor.preview.mediumConfidence")}
                    </Badge>
                  </InlineStack>
                  {details.length > 0 && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("scriptEditor.preview.detectedType", { type: details[0].type })}
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
                {t("scriptEditor.preview.riskScore")}
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
  const { t } = useTranslation();
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fragments, setFragments] = useState<string[]>([]);
  const analysisTimeoutRef = useRef<NodeJS.Timeout | null>(null);
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
      const { debugError } = await import("../../utils/debug-log.client");
      debugError("Failed to copy:", err);
    }
  };
  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              {t("scriptEditor.title")}
            </Text>
            <InlineStack gap="200">
              {value && (
                <Button
                  size="slim"
                  variant="plain"
                  onClick={handleCopy}
                  icon={copied ? CheckCircleIcon : ClipboardIcon}
                >
                  {copied ? t("scriptEditor.copied") : t("scriptEditor.copy")}
                </Button>
              )}
              {value && (
                <Button
                  size="slim"
                  variant="plain"
                  onClick={() => setShowPreview(!showPreview)}
                >
                  {showPreview ? t("scriptEditor.hidePreview") : t("scriptEditor.showPreview")}
                </Button>
              )}
            </InlineStack>
          </InlineStack>
          {enableBatchPaste && fragments.length > 1 && (
            <Banner tone="info">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm">
                  {t("scriptEditor.fragmentsDetected", { count: fragments.length })}
                </Text>
                <List type="bullet">
                  {fragments.map((fragment, index) => (
                    <List.Item key={index}>
                      <Text as="span" variant="bodySm">
                        {t("scriptEditor.fragmentLabel", { index: index + 1 })}: {fragment.substring(0, 50)}
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
                {t("scriptEditor.realtimeAnalysis")}
              </Text>
            </Banner>
          )}
          <Banner>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("scriptEditor.howToCopyTitle")}
              </Text>
              <List type="number">
                <List.Item>
                  <Text as="span" variant="bodySm">
                    {t("scriptEditor.step1")}
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    {t("scriptEditor.step2")}
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    {t("scriptEditor.step3")}
                  </Text>
                </List.Item>
              </List>
            </BlockStack>
          </Banner>
          <Box position="relative">
            <TextField
              label={t("scriptEditor.inputLabel")}
              value={value}
              onChange={onChange}
              multiline={12}
              autoComplete="off"
              placeholder={placeholder || t("scriptEditor.placeholder")}
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
                      {t("scriptEditor.codePreviewTitle")}
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
                      >
                        {value}
                      </pre>
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
              {t("scriptEditor.analyzeButton")}
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
