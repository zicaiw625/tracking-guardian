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
import type { ScriptAnalysisResult } from "../../services/scanner/types";
import { getSeverityBadge } from "./utils";
import { DEPRECATION_DATES, formatDeadlineDate } from "../../utils/migration-deadlines";
import { AnalysisResultSummary } from "./AnalysisResultSummary";
import { useTranslation, Trans } from "react-i18next";

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
  const { t } = useTranslation();
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
      setAnalysisError(t("scan.manualAnalysis.input.emptyError"));
      return;
    }

    if (trimmedContent.length > MAX_CONTENT_LENGTH) {
      setAnalysisError(t("scan.manualAnalysis.input.lengthError", { max: MAX_CONTENT_LENGTH }));
      return;
    }

    setIsAnalyzing(true);
    setAnalysisError(null);

    try {
      // Pass t to analyzeScriptContent for localization
      const result = analyzeScriptContent(trimmedContent, t);
      if (isMountedRef.current) {
        setAnalysisResult(result);
      }
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }
      const errorMessage = error instanceof Error ? error.message : t("scan.manualAnalysis.input.error");
      setAnalysisError(errorMessage);
      setAnalysisResult(null);

      const { debugError } = await import("../../utils/debug-log.client");
      const errorDetails = error instanceof Error ? error.stack : String(error);
      debugError("Script analysis error:", {
        message: errorMessage,
        details: errorDetails,
        contentLength: trimmedContent.length,
      });
    } finally {
      if (isMountedRef.current) {
        setIsAnalyzing(false);
      }
    }
  }, [scriptContent, scriptAnalysisMaxContentLength, t]);

  return (
    <BlockStack gap="500">
      <Box paddingBlockStart="400">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              {t("scan.manualAnalysis.title")}
            </Text>
            <BlockStack gap="200">
              <Text as="p" tone="subdued">
                {t("scan.manualAnalysis.description")}
              </Text>
              <Banner tone="warning" title={t("scan.manualAnalysis.privacy.title")}>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm">
                    • {t("scan.manualAnalysis.privacy.points.p1")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    • {t("scan.manualAnalysis.privacy.points.p2")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    • {t("scan.manualAnalysis.privacy.points.p3")}
                  </Text>
                </BlockStack>
              </Banner>
            </BlockStack>

            <Banner
              tone="critical"
              title={t("scan.manualAnalysis.deprecation.plus", {
                plusDate: formatDeadlineDate(DEPRECATION_DATES.plusScriptTagExecutionOff, "exact"),
                nonPlusDate: formatDeadlineDate(DEPRECATION_DATES.nonPlusScriptTagExecutionOff, "exact"),
              })}
            >
              <BlockStack gap="100">
                <Text as="p" variant="bodySm">
                  {t("scan.manualAnalysis.deprecation.desc")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  <strong>{t("scan.manualAnalysis.deprecation.important")}</strong>{t("scan.manualAnalysis.deprecation.disclaimer")}
                </Text>
                {deprecationStatus && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("scan.manualAnalysis.deprecation.remaining")} {deprecationStatus.additionalScripts.badge.text} —{" "}
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
                    {t("scan.manualAnalysis.actions.migrate")}
                  </Button>
                  <Button
                    url="/app/migrate#pixel"
                    icon={SettingsIcon}
                    size="slim"
                    variant="secondary"
                  >
                    {t("scan.manualAnalysis.actions.enablePixel")}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Banner>

            <Banner tone="info">
              <BlockStack gap="300">
                <Text as="p" fontWeight="semibold">
                  {t("scan.manualAnalysis.guide.title")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  📖 {t("scan.manualAnalysis.guide.docsRef")}<a href="https://help.shopify.com/en/manual/checkout-settings/order-status-page/additional-scripts" target="_blank" rel="noopener noreferrer">{t("scan.manualAnalysis.guide.shopifyDocs")}</a>
                </Text>
                <Divider />
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  {t("scan.manualAnalysis.guide.screenshotGuide")}
                </Text>

                <List type="number">
                  <List.Item>
                    <BlockStack gap="200">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {t("scan.manualAnalysis.guide.steps.step1.title")}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        <Trans i18nKey="scan.manualAnalysis.guide.steps.step1.desc" components={{ strong: <strong />, a: <a target="_blank" rel="noopener noreferrer" /> }} />
                      </Text>
                      <Banner tone="info">
                        <Text as="p" variant="bodySm">
                          <Trans i18nKey="scan.manualAnalysis.guide.steps.step1.tip" components={{ strong: <strong />, a: <a target="_blank" rel="noopener noreferrer" /> }} />
                        </Text>
                      </Banner>
                    </BlockStack>
                  </List.Item>
                  <List.Item>
                    <BlockStack gap="200">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {t("scan.manualAnalysis.guide.steps.step2.title")}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {t("scan.manualAnalysis.guide.steps.step2.desc")}
                      </Text>
                      <Banner tone="info">
                        <Text as="p" variant="bodySm">
                          <Trans i18nKey="scan.manualAnalysis.guide.steps.step2.tip" components={{ strong: <strong />, a: <a target="_blank" rel="noopener noreferrer" /> }} />
                        </Text>
                      </Banner>
                      <Text as="span" variant="bodySm" tone="subdued">
                        <Trans i18nKey="scan.manualAnalysis.guide.steps.step2.hint" components={{ strong: <strong />, a: <a target="_blank" rel="noopener noreferrer" /> }} />
                      </Text>
                    </BlockStack>
                  </List.Item>
                  <List.Item>
                    <BlockStack gap="200">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {t("scan.manualAnalysis.guide.steps.step3.title")}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {t("scan.manualAnalysis.guide.steps.step3.desc")}
                      </Text>
                      <Banner tone="info">
                        <Text as="p" variant="bodySm">
                          <Trans i18nKey="scan.manualAnalysis.guide.steps.step3.tip" components={{ strong: <strong />, a: <a target="_blank" rel="noopener noreferrer" /> }} />
                        </Text>
                      </Banner>
                      <Text as="span" variant="bodySm" tone="subdued">
                        <Trans i18nKey="scan.manualAnalysis.guide.steps.step3.hint" components={{ strong: <strong />, a: <a target="_blank" rel="noopener noreferrer" /> }} />
                      </Text>
                      <Banner tone="warning">
                        <Text as="p" variant="bodySm">
                          <Trans i18nKey="scan.manualAnalysis.guide.steps.step3.warning" components={{ strong: <strong />, a: <a target="_blank" rel="noopener noreferrer" /> }} />
                        </Text>
                        <List type="bullet">
                          <List.Item>
                            <Text as="span" variant="bodySm">{t("scan.manualAnalysis.guide.steps.step3.checks.c1")}</Text>
                          </List.Item>
                          <List.Item>
                            <Text as="span" variant="bodySm">{t("scan.manualAnalysis.guide.steps.step3.checks.c2")}</Text>
                          </List.Item>
                          <List.Item>
                            <Text as="span" variant="bodySm">{t("scan.manualAnalysis.guide.steps.step3.checks.c3")}</Text>
                          </List.Item>
                        </List>
                      </Banner>
                    </BlockStack>
                  </List.Item>
                  <List.Item>
                    <BlockStack gap="200">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {t("scan.manualAnalysis.guide.steps.step4.title")}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {t("scan.manualAnalysis.guide.steps.step4.desc")}
                      </Text>
                      <Banner tone="critical">
                        <Text as="p" variant="bodySm" fontWeight="semibold">
                          {t("scan.manualAnalysis.guide.steps.step4.warning")}
                        </Text>
                        <Text as="p" variant="bodySm">
                          • {t("scan.manualAnalysis.guide.steps.step4.warningPoints.p1")}
                        </Text>
                        <Text as="p" variant="bodySm">
                          • {t("scan.manualAnalysis.guide.steps.step4.warningPoints.p2")}
                        </Text>
                        <Text as="p" variant="bodySm">
                          • {t("scan.manualAnalysis.guide.steps.step4.warningPoints.p3")}
                        </Text>
                      </Banner>
                      <Text as="span" variant="bodySm" tone="subdued">
                        <Trans i18nKey="scan.manualAnalysis.guide.steps.step4.hint" components={{ strong: <strong />, a: <a target="_blank" rel="noopener noreferrer" /> }} />
                      </Text>
                    </BlockStack>
                  </List.Item>
                  <List.Item>
                    <BlockStack gap="200">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {t("scan.manualAnalysis.guide.steps.step5.title")}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {t("scan.manualAnalysis.guide.steps.step5.desc")}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        <Trans i18nKey="scan.manualAnalysis.guide.steps.step5.hint" components={{ strong: <strong />, a: <a target="_blank" rel="noopener noreferrer" /> }} />
                      </Text>
                    </BlockStack>
                  </List.Item>
                </List>
                <Divider />
                <Text as="p" variant="bodySm" tone="subdued">
                  <Trans i18nKey="scan.manualAnalysis.guide.notFound" components={{ strong: <strong />, a: <a target="_blank" rel="noopener noreferrer" /> }} />
                </Text>
              </BlockStack>
            </Banner>

            <TextField
              label={t("scan.manualAnalysis.input.label")}
              value={scriptContent}
              onChange={setScriptContent}
              multiline={8}
              autoComplete="off"
              placeholder={t("scan.manualAnalysis.input.placeholder")}
              helpText={t("scan.manualAnalysis.input.help")}
            />

            <InlineStack align="end">
              <Button
                variant="primary"
                onClick={handleAnalyzeScript}
                loading={isAnalyzing}
                disabled={!scriptContent.trim()}
                icon={ClipboardIcon}
              >
                {t("scan.manualAnalysis.input.analyze")}
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
              {t("scan.manualAnalysis.results.riskTitle")}
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
                      {getSeverityBadge(risk.severity, t)}
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
                {t("scan.manualAnalysis.results.recommendationTitle")}
              </Text>
              <Badge tone="info">{t("scan.manualAnalysis.results.manualLabel")}</Badge>
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

                // Check for checklist recommendation using translated string
                const checklistTitle = t("scan.analysis.recommendations.checklist").split("\n")[0];
                const isChecklist = rec.includes(checklistTitle) || rec.includes("Migration Checklist");

                if (isChecklist) {
                  return (
                    <Box
                      key={index}
                      background="bg-surface-secondary"
                      padding="400"
                      borderRadius="200"
                    >
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">
                          {t("scan.manualAnalysis.results.generalTitle")}
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
                            {t("scan.manualAnalysis.results.configure")}
                          </Button>
                        )}
                        {isExternal && !isInternal && (
                          <Button url={url!} external size="slim" icon={ShareIcon}>
                            {t("scan.manualAnalysis.results.viewApp")}
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
              {t("scan.manualAnalysis.results.goToMigrate")}
            </Button>
          </BlockStack>
        </Card>
      )}
    </BlockStack>
  );
}
