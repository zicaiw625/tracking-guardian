import { useState, useCallback, useEffect, Suspense } from "react";
import { useTranslation } from "react-i18next";
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

export function ManualPastePanel({ shopId: _shopId, onAssetsCreated: _onAssetsCreated, scriptCodeEditor }: ManualPastePanelProps) {
  const { t } = useTranslation();
  const Editor = scriptCodeEditor;
  const [scriptContent, setScriptContent] = useState("");
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isProcessing] = useState(false);
  const [realtimeAnalysisResult, setRealtimeAnalysisResult] = useState<ScriptAnalysisResult | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [piiWarnings, setPiiWarnings] = useState<string[]>([]);
  const [detectedSnippets, setDetectedSnippets] = useState<Array<{ platform: string; content: string; startIndex: number; endIndex: number }>>([]);
  const detectPII = useCallback((content: string): string[] => {
    const warnings: string[] = [];
    if (!content.trim()) {
      return warnings;
    }
    const piiPatterns = [
      {
        pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
        message: t("manualPaste.pii.emailDetected"),
        type: "email",
      },
      {
        pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b|\b\+?\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}\b/g,
        message: t("manualPaste.pii.phoneDetected"),
        type: "phone",
      },
      {
        pattern: /\b\d{4}[-.\s]?\d{4}[-.\s]?\d{4}[-.\s]?\d{4}\b/g,
        message: t("manualPaste.pii.creditCardDetected"),
        type: "credit_card",
      },
      {
        pattern: /\b[A-Za-z0-9]{20,}\b/g,
        message: t("manualPaste.pii.longStringDetected"),
        type: "token",
      },
      {
        pattern: /(?:api[_-]?key|access[_-]?token|bearer[_-]?token|secret[_-]?key|private[_-]?key)\s*[:=]\s*['"]?([A-Za-z0-9_.-]{20,})['"]?/gi,
        message: t("manualPaste.pii.apiKeyDetected"),
        type: "api_key",
      },
      {
        pattern: /(?:password|pwd|pass)\s*[:=]\s*['"]?([^'"]+)['"]?/gi,
        message: t("manualPaste.pii.passwordDetected"),
        type: "password",
      },
    ];
    piiPatterns.forEach(({ pattern, message, type: _type }) => {
      const matches = content.match(pattern);
      if (matches && matches.length > 0) {
        const uniqueMatches = Array.from(new Set(matches)).slice(0, 3);
        warnings.push(t("manualPaste.pii.matchSummary", { message, count: matches.length, examples: uniqueMatches.join(", ") }));
      }
    });
    return warnings;
  }, [t]);
  const validateScript = useCallback((content: string): string[] => {
    const errors: string[] = [];
    if (!content.trim()) {
      return errors;
    }
    const dangerousPatterns = [
      {
        pattern: /eval\s*\(/gi,
        message: t("manualPaste.validation.evalDetected"),
      },
      {
        pattern: /document\.cookie\s*=/gi,
        message: t("manualPaste.validation.cookieDetected"),
      },
      {
        pattern: /innerHTML\s*=/gi,
        message: t("manualPaste.validation.innerHtmlDetected"),
      },
      {
        pattern: /document\.write\s*\(/gi,
        message: t("manualPaste.validation.documentWriteDetected"),
      },
      {
        pattern: /<script[^>]*src[^>]*>/gi,
        message: t("manualPaste.validation.externalScriptDetected"),
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
          errors.push(t("manualPaste.validation.unclosedTag", { index: index + 1 }));
        }
      });
    }
    const unescapedHtml = content.match(/<[^>]+>(?![^<]*<\/script>)/g);
    if (unescapedHtml && unescapedHtml.length > 0) {
      errors.push(t("manualPaste.validation.unescapedHtml"));
    }
    return errors;
  }, [t]);
  const detectScriptSnippets = useCallback((content: string): Array<{ platform: string; content: string; startIndex: number; endIndex: number }> => {
    const snippets: Array<{ platform: string; content: string; startIndex: number; endIndex: number }> = [];
    if (!content.trim()) {
      return snippets;
    }
    const platformPatterns: Array<{ platform: string; patterns: RegExp[] }> = [
      {
        platform: "Meta Pixel",
        patterns: [
          /<script[^>]*>[\s\S]*?fbq\s*\([^)]*\)[\s\S]*?<\/script>/gi,
          /fbq\s*\(['"]init['"]\s*,[^)]+\)/gi,
        ],
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
        patterns: [
          /<script[^>]*>[\s\S]*?ttq\s*[.(][^)]*\)[\s\S]*?<\/script>/gi,
          /ttq\s*\.\s*load\s*\([^)]+\)/gi,
        ],
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
        let detectedPlatform = t("manualPaste.snippet.unknownScript");
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
  }, [t]);
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
  const performLocalAnalysis = useCallback((content: string): AnalysisResult | null => {
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
    const unknownLabel = t("manualPaste.snippet.unknownScript");
    for (const snippet of snippets) {
      const platform = snippet.platform;
      if (platform && platform !== unknownLabel) {
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
        platform: platform !== unknownLabel ? platform : undefined,
        displayName: platform,
        riskLevel: "medium" as const,
        suggestedMigration: category === "pixel" ? "web_pixel" : "none",
        confidence: "medium" as const,
      });
    }
    const overallRiskLevel = assets.length > 0 ? "medium" as const : "low" as const;
    return {
      assets,
      summary: {
        totalSnippets: snippets.length,
        identifiedCategories,
        identifiedPlatforms: Array.from(identifiedPlatforms),
        overallRiskLevel,
      },
    };
  }, [detectScriptSnippets, t]);
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
  const handleRealtimeAnalysis = useCallback((content: string) => {
    if (!content.trim()) return;
    const result = performLocalAnalysis(content);
    if (result) {
      setRealtimeAnalysisResult({
        identifiedPlatforms: result.summary.identifiedPlatforms,
        platformDetails: result.assets.map(a => ({
          platform: a.platform || "unknown",
          type: a.category,
          confidence: a.confidence,
          matchedPattern: a.displayName,
        })),
        risks: [],
        riskScore: result.summary.overallRiskLevel === "high" ? 70 : result.summary.overallRiskLevel === "medium" ? 40 : 20,
        recommendations: [],
      });
    }
  }, [performLocalAnalysis]);
  const riskLevelBadge = analysisResult
    ? {
        high: { tone: "critical" as const, label: t("manualPaste.risk.high") },
        medium: { tone: "warning" as const, label: t("manualPaste.risk.medium") },
        low: { tone: "success" as const, label: t("manualPaste.risk.low") },
      }[analysisResult.summary.overallRiskLevel]
    : null;
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            {t("manualPaste.header.title")}
          </Text>
          <Badge>{t("manualPaste.header.badge")}</Badge>
        </InlineStack>
        <Banner tone="info">
          <BlockStack gap="400">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {t("manualPaste.guide.title")}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("manualPaste.guide.description")}
            </Text>
            <Banner tone="warning">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  {t("manualPaste.guide.screenshotTitle")}
                </Text>
                <Text as="p" variant="bodySm">
                  {t("manualPaste.guide.screenshotDescription")}
                </Text>
                <List type="bullet">
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      {t("manualPaste.guide.screenshotBenefit1")}
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      {t("manualPaste.guide.screenshotBenefit2")}
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      {t("manualPaste.guide.screenshotBenefit3")}
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      {t("manualPaste.guide.screenshotBenefit4")}
                    </Text>
                  </List.Item>
                </List>
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  {t("manualPaste.guide.keyScreenshotsTitle")}
                </Text>
                <List type="number">
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      {t("manualPaste.guide.screenshot1Title")}
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {t("manualPaste.guide.screenshot1Tip")}
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      {t("manualPaste.guide.screenshot2Title")}
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {t("manualPaste.guide.screenshot2Tip")}
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      {t("manualPaste.guide.screenshot3Title")}
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {t("manualPaste.guide.screenshot3Tip")}
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      {t("manualPaste.guide.screenshot4Title")}
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {t("manualPaste.guide.screenshot4Tip")}
                    </Text>
                  </List.Item>
                </List>
                <Banner tone="info">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      {t("manualPaste.guide.wizardPathTitle")}
                    </Text>
                    <Text as="p" variant="bodySm">
                      {t("manualPaste.guide.wizardPathDescription")}
                    </Text>
                    <List type="number">
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          {t("manualPaste.guide.wizardPathStep1")}
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          {t("manualPaste.guide.wizardPathStep2")}
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          {t("manualPaste.guide.wizardPathStep3")}
                        </Text>
                      </List.Item>
                    </List>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("manualPaste.guide.wizardPathTip")}
                    </Text>
                  </BlockStack>
                </Banner>
              </BlockStack>
            </Banner>
            <List type="number">
              <List.Item>
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    {t("manualPaste.steps.step1Title")}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("manualPaste.steps.step1Description")}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("manualPaste.steps.step1Tip")}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("manualPaste.steps.step1Location")}
                  </Text>
                </BlockStack>
              </List.Item>
              <List.Item>
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    {t("manualPaste.steps.step2Title")}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("manualPaste.steps.step2Description")}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("manualPaste.steps.step2Tip")}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("manualPaste.steps.step2Location")}
                  </Text>
                </BlockStack>
              </List.Item>
              <List.Item>
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    {t("manualPaste.steps.step3Title")}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("manualPaste.steps.step3Description")}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("manualPaste.steps.step3Tip")}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("manualPaste.steps.step3LocationNote")}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("manualPaste.steps.step3LocationDetail")}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("manualPaste.steps.step3ScreenshotTip")}
                  </Text>
                </BlockStack>
              </List.Item>
              <List.Item>
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    {t("manualPaste.steps.step4Title")}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("manualPaste.steps.step4Description")}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("manualPaste.steps.step4Important")}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("manualPaste.steps.step4Tip")}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("manualPaste.steps.step4Operation")}
                  </Text>
                </BlockStack>
              </List.Item>
              <List.Item>
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    {t("manualPaste.steps.step5Title")}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("manualPaste.steps.step5Description")}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("manualPaste.steps.step5Tip")}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("manualPaste.steps.step5Operation")}
                  </Text>
                </BlockStack>
              </List.Item>
            </List>
            <Divider />
            <Banner tone="critical">
              <BlockStack gap="300">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  {t("manualPaste.sensitive.title")}
                </Text>
                <Text as="p" variant="bodySm">
                  {t("manualPaste.sensitive.description")}
                </Text>
                <List type="bullet">
                  <List.Item>
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      {t("manualPaste.sensitive.apiKeysTitle")}
                    </Text>
                    <Text as="span" variant="bodySm">
                      {" "}{t("manualPaste.sensitive.apiKeysDescription")}
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      {t("manualPaste.sensitive.piiTitle")}
                    </Text>
                    <Text as="span" variant="bodySm">
                      {" "}{t("manualPaste.sensitive.piiDescription")}
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      {t("manualPaste.sensitive.secretsTitle")}
                    </Text>
                    <Text as="span" variant="bodySm">
                      {" "}{t("manualPaste.sensitive.secretsDescription")}
                    </Text>
                  </List.Item>
                </List>
                <Banner tone="info">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      {t("manualPaste.sensitive.exampleTitle")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("manualPaste.sensitive.exampleBefore")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("manualPaste.sensitive.exampleAfter")}
                    </Text>
                  </BlockStack>
                </Banner>
              </BlockStack>
            </Banner>
            <Banner tone="warning">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  {t("manualPaste.notes.title")}
                </Text>
                <List type="bullet">
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      {t("manualPaste.notes.apiLimitation")}
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      {t("manualPaste.notes.autoDetection")}
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      {t("manualPaste.notes.commonScripts")}
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      {t("manualPaste.notes.emptyScripts")}
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      {t("manualPaste.notes.localAnalysis")}
                    </Text>
                  </List.Item>
                </List>
              </BlockStack>
            </Banner>
            <Banner tone="info">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  {t("manualPaste.reference.title")}
                </Text>
                <Text as="p" variant="bodySm">
                  {t("manualPaste.reference.description")}
                </Text>
                <Text as="p" variant="bodySm">
                  <a href="https://shopify.dev/docs/apps/checkout/upgrade-guide" target="_blank" rel="noopener noreferrer">
                    Shopify Checkout Upgrade Guide
                  </a>
                </Text>
              </BlockStack>
            </Banner>
            <Banner tone="info">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  {t("manualPaste.privacy.title")}
                </Text>
                <Text as="p" variant="bodySm">
                  {t("manualPaste.privacy.description")}
                </Text>
              </BlockStack>
            </Banner>
          </BlockStack>
        </Banner>
        {piiWarnings.length > 0 && (
          <Banner tone="critical">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("manualPaste.detection.piiWarningTitle")}
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
                {t("manualPaste.detection.piiWarningDescription")}
              </Text>
            </BlockStack>
          </Banner>
        )}
        {detectedSnippets.length > 0 && (
          <Banner tone="info">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("manualPaste.detection.snippetsFound", { count: detectedSnippets.length })}
              </Text>
              <List>
                {detectedSnippets.map((snippet, index) => (
                  <List.Item key={index}>
                    <Text as="span" variant="bodySm">
                      <strong>{snippet.platform}</strong>{t("manualPaste.detection.snippetLocation", { start: snippet.startIndex + 1, end: snippet.endIndex })}
                    </Text>
                  </List.Item>
                ))}
              </List>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("manualPaste.detection.snippetsTip")}
              </Text>
            </BlockStack>
          </Banner>
        )}
        {validationErrors.length > 0 && (
          <Banner tone="warning">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("manualPaste.detection.issuesTitle")}
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
            label={t("manualPaste.editor.label")}
            value={scriptContent}
            onChange={setScriptContent}
            multiline={10}
            placeholder={t("manualPaste.editor.placeholder")}
            helpText={t("manualPaste.editor.helpText", { count: scriptContent.length })}
            disabled={isAnalyzing || isProcessing}
            autoComplete="off"
          />
        }>
          <Editor
            value={scriptContent}
            onChange={setScriptContent}
            onAnalyze={handleAnalyze}
            analysisResult={realtimeAnalysisResult}
            isAnalyzing={isAnalyzing}
            placeholder={t("manualPaste.editor.richPlaceholder")}
            enableRealtimeAnalysis={true}
            onRealtimeAnalysis={handleRealtimeAnalysis}
            enableBatchPaste={true}
          />
        </Suspense>
        {analysisResult && (
          <Banner tone="info">
            <Text as="p" variant="bodySm">
              {t("manualPaste.result.analysisComplete")}
            </Text>
          </Banner>
        )}
        {isProcessing && (
          <Box padding="400">
            <InlineStack gap="300" blockAlign="center">
              <Spinner size="small" />
              <Text as="span" variant="bodySm" tone="subdued">
                {t("manualPaste.result.creatingAssets")}
              </Text>
            </InlineStack>
          </Box>
        )}
        {analysisResult && (
          <BlockStack gap="400">
            <Divider />
            <Text as="h3" variant="headingSm">
              {t("manualPaste.result.title")}
            </Text>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    {t("manualPaste.result.snippetsLabel")}
                  </Text>
                  <Badge>{t("manualPaste.result.snippetsCount", { count: analysisResult.summary.totalSnippets })}</Badge>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    {t("manualPaste.result.platformsLabel")}
                  </Text>
                  {analysisResult.summary.identifiedPlatforms.length > 0 ? (
                    <InlineStack gap="100" wrap>
                      {analysisResult.summary.identifiedPlatforms.map((p) => (
                        <Badge key={p}>{p}</Badge>
                      ))}
                    </InlineStack>
                  ) : (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {t("manualPaste.result.none")}
                    </Text>
                  )}
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    {t("manualPaste.result.riskLabel")}
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
                      {t("manualPaste.result.assetsTitle", { count: analysisResult.assets.length })}
                    </Text>
                    <BlockStack gap="200">
                      {analysisResult.assets.map((asset, index) => {
                        const riskBadgeMap: Record<string, { tone: "critical" | "success" | undefined; label: string }> = {
                          high: { tone: "critical", label: t("manualPaste.result.riskHigh") },
                          medium: { tone: undefined, label: t("manualPaste.result.riskMedium") },
                          low: { tone: "success", label: t("manualPaste.result.riskLow") },
                        };
                        const riskBadge = riskBadgeMap[asset.riskLevel] || riskBadgeMap.medium;
                        const confidenceBadgeMap: Record<string, { tone: "success" | "info" | undefined; label: string }> = {
                          high: { tone: "success", label: t("manualPaste.result.confidenceHigh") },
                          medium: { tone: "info", label: t("manualPaste.result.confidenceMedium") },
                          low: { tone: undefined, label: t("manualPaste.result.confidenceLow") },
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
                                    <Badge tone={riskBadge.tone}>{riskBadge.label}</Badge>
                                    <Badge tone={confidenceBadge.tone}>
                                      {confidenceBadge.label}
                                    </Badge>
                                  </InlineStack>
                                  <Text as="span" variant="bodySm">
                                    {t("manualPaste.result.assetDetail", { category: asset.category, migration: asset.suggestedMigration })}
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
