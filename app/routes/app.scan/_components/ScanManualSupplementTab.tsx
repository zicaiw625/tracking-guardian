import { BlockStack, Box, Card, Text, Banner, Button, InlineStack, Divider, ProgressBar, Badge, List } from "@shopify/polaris";
import { Suspense } from "react";
import { ArrowRightIcon, SettingsIcon, CheckCircleIcon, ShareIcon } from "~/components/icons";
import { CardSkeleton } from "~/components/ui";
import { AnalysisResultSummary } from "~/components/scan/AnalysisResultSummary";
import { ManualPastePanel } from "~/components/scan/ManualPastePanel";
import { getSeverityBadge } from "~/components/scan";
import { getDateDisplayLabel, DEPRECATION_DATES } from "~/utils/deprecation-dates";
import type { ScriptAnalysisResult } from "~/services/scanner.server";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";

interface ScanManualSupplementTabProps {
    shop: { id: string } | null;
    deprecationStatus: {
        additionalScripts?: {
            badge: { text: string };
            description: string;
        };
    } | null;
    scriptContent: string;
    setScriptContent: (value: string) => void;
    analysisResult: ScriptAnalysisResult | null;
    analysisError: string | null;
    isAnalyzing: boolean;
    analysisProgress: { current: number; total: number } | null;
    handleAnalyzeScript: () => void;
    onShowGuidance: (title: string) => void;
    onOpenGuidedSupplement: () => void;
    onOpenManualInputWizard: () => void;
    onAssetsCreated: (count: number) => void;
    // 懒加载的脚本编辑器组件，放宽为 any 以兼容现有实现
    ScriptCodeEditor: ComponentType<any>;
    analysisSaved: boolean;
    isSavingAnalysis: boolean;
    isProcessingPaste: boolean;
    pasteProcessed: boolean;
    onSaveAnalysis: () => void;
    onProcessManualPaste: () => void;
    saveAnalysisFetcherData: unknown;
    processPasteFetcherData: unknown;
    replacementChecklistItems: Array<{ id: string; contentSummary: string; result: ScriptAnalysisResult }>;
    onAddToReplacementChecklist: () => void;
    onRemoveFromReplacementChecklist: (id: string) => void;
    onExportReplacementChecklistCSV: () => void;
}

export function ScanManualSupplementTab({
    shop,
    deprecationStatus,
    scriptContent,
    setScriptContent,
    analysisResult,
    analysisError,
    isAnalyzing,
    analysisProgress,
    handleAnalyzeScript,
    onShowGuidance,
    onOpenGuidedSupplement,
    onOpenManualInputWizard,
    onAssetsCreated,
    ScriptCodeEditor,
    analysisSaved,
    isSavingAnalysis,
    isProcessingPaste,
    pasteProcessed,
    onSaveAnalysis,
    onProcessManualPaste,
    saveAnalysisFetcherData,
    processPasteFetcherData,
    replacementChecklistItems,
    onAddToReplacementChecklist,
    onRemoveFromReplacementChecklist,
    onExportReplacementChecklistCSV,
}: ScanManualSupplementTabProps) {
    const { t } = useTranslation();
    return (
        <BlockStack gap="500">
            <Box paddingBlockStart="400">
                <Card>
                    <BlockStack gap="400">
                        <Text as="h2" variant="headingMd">
                            {t("scan.manualSupplement.title")}
                        </Text>
                        <BlockStack gap="200">
                            <Text as="p" tone="subdued">
                                {t("scan.manualSupplement.desc")}
                            </Text>
                            <Banner tone="warning" title={t("scan.manualSupplement.privacy.title")}>
                                <BlockStack gap="100">
                                    <Text as="p" variant="bodySm">
                                        {t("scan.manualSupplement.privacy.item1")}
                                    </Text>
                                    <Text as="p" variant="bodySm">
                                        {t("scan.manualSupplement.privacy.item2")}
                                    </Text>
                                    <Text as="p" variant="bodySm">
                                        {t("scan.manualSupplement.privacy.item3")}
                                    </Text>
                                    <Text as="p" variant="bodySm">
                                        {t("scan.manualSupplement.privacy.item4")}
                                    </Text>
                                </BlockStack>
                            </Banner>
                        </BlockStack>
                        <Banner tone="critical" title={t("scan.manualSupplement.deadline.title", {
                            plusDate: getDateDisplayLabel(DEPRECATION_DATES.plusScriptTagExecutionOff, "exact"),
                            nonPlusDate: getDateDisplayLabel(DEPRECATION_DATES.nonPlusScriptTagExecutionOff, "exact")
                        })}>
                            <BlockStack gap="100">
                                <Text as="p" variant="bodySm">
                                    {t("scan.manualSupplement.deadline.desc")}
                                </Text>
                                <Text as="p" variant="bodySm" tone="subdued">
                                    {t("scan.manualSupplement.deadline.disclaimer")}
                                </Text>
                                {deprecationStatus && (
                                    <Text as="p" variant="bodySm" tone="subdued">
                                        {t("scan.manualSupplement.deadline.remaining", {
                                            text: deprecationStatus.additionalScripts?.badge.text,
                                            desc: deprecationStatus.additionalScripts?.description
                                        })}
                                    </Text>
                                )}
                                <InlineStack gap="200">
                                    <Button url="/app/migrate" icon={ArrowRightIcon} size="slim" variant="primary">
                                        {t("scan.manualSupplement.actions.migrate")}
                                    </Button>
                                    <Button url="/app/migrate#pixel" icon={SettingsIcon} size="slim" variant="secondary">
                                        {t("scan.manualSupplement.actions.pixel")}
                                    </Button>
                                </InlineStack>
                            </BlockStack>
                        </Banner>
                        <Banner tone="info">
                            <BlockStack gap="200">
                                <InlineStack align="space-between" blockAlign="start">
                                    <BlockStack gap="200">
                                        <Text as="p" fontWeight="semibold">{t("scan.manualSupplement.howTo.title")}</Text>
                                        <Text as="p" variant="bodySm">
                                            {t("scan.manualSupplement.howTo.step1")}
                                            <br />{t("scan.manualSupplement.howTo.step2")}
                                            <br />{t("scan.manualSupplement.howTo.step3")}
                                            <br />{t("scan.manualSupplement.howTo.step4")}
                                        </Text>
                                    </BlockStack>
                                    <InlineStack gap="200">
                                        <Button
                                            onClick={onOpenGuidedSupplement}
                                            variant="primary"
                                            size="slim"
                                        >
                                            {t("scan.manualSupplement.buttons.upgradeWizard")}
                                        </Button>
                                        <Button
                                            onClick={onOpenManualInputWizard}
                                            size="slim"
                                        >
                                            {t("scan.manualSupplement.buttons.guidedInfo")}
                                        </Button>
                                        <Button
                                            onClick={() => onShowGuidance(t("scan.manualSupplement.buttons.importWizard"))}
                                            variant="plain"
                                            size="slim"
                                        >
                                            {t("scan.manualSupplement.buttons.importWizard")}
                                        </Button>
                                    </InlineStack>
                                </InlineStack>
                            </BlockStack>
                        </Banner>
                        <ManualPastePanel
                            shopId={shop?.id || ""}
                            onAssetsCreated={onAssetsCreated}
                            scriptCodeEditor={ScriptCodeEditor}
                        />
                        <Divider />
                        <Suspense fallback={<CardSkeleton lines={5} />}>
                            <ScriptCodeEditor
                                value={scriptContent}
                                onChange={setScriptContent}
                                onAnalyze={handleAnalyzeScript}
                                analysisResult={analysisResult}
                                isAnalyzing={isAnalyzing}
                                placeholder={t("scan.manualSupplement.editorPlaceholder")}
                                enableRealtimeAnalysis={false}
                                enableBatchPaste={true}
                            />
                        </Suspense>
                        {analysisProgress && (
                            <Box paddingBlockStart="200">
                                <Text as="p" variant="bodySm" tone="subdued">
                                    {t("scan.manualSupplement.progress", { current: analysisProgress.current, total: analysisProgress.total })}
                                </Text>
                                <ProgressBar progress={(analysisProgress.current / analysisProgress.total) * 100} />
                            </Box>
                        )}
                        {analysisError && (
                            <Banner tone="critical">
                                <div role="alert" aria-live="assertive">
                                    <Text as="p" variant="bodySm">{analysisError}</Text>
                                </div>
                            </Banner>
                        )}
                        {analysisResult && (
                            <InlineStack gap="200">
                                <Button onClick={onAddToReplacementChecklist} variant="secondary" size="slim">
                                    {t("scan.manualSupplement.addChecklist")}
                                </Button>
                            </InlineStack>
                        )}
                    </BlockStack>
                </Card>
            </Box>
            {replacementChecklistItems.length > 0 && (
                <Card>
                    <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                            <Text as="h2" variant="headingMd">
                                {t("scan.manualSupplement.checklist.title")}
                            </Text>
                            <Button onClick={onExportReplacementChecklistCSV} variant="primary" size="slim">
                                {t("scan.manualSupplement.checklist.exportCSV")}
                            </Button>
                        </InlineStack>
                        <BlockStack gap="200">
                            {replacementChecklistItems.map((item, index) => {
                                const hasTracking = ["google", "meta", "tiktok", "facebook", "ga4", "pixel"].some((t) =>
                                    item.result.identifiedPlatforms.some((p) => p.toLowerCase().includes(t))
                                );
                                const hasDomRisk = item.result.risks.some(
                                    (r) => /window|document|dom/i.test(r.id) || /window|document|dom/i.test(r.name || "")
                                );
                                const replacement = hasTracking ? t("scan.manualSupplement.checklist.suggestions.webPixel") : hasDomRisk ? t("scan.manualSupplement.checklist.suggestions.uiExtension") : t("scan.manualSupplement.checklist.suggestions.manual");
                                const platforms = item.result.identifiedPlatforms.join(", ") || "-";
                                const topRisk = item.result.risks[0]?.name || "-";
                                return (
                                    <Box key={item.id} padding="300" background="bg-surface-secondary" borderRadius="200">
                                        <InlineStack align="space-between" blockAlign="center" gap="400">
                                            <BlockStack gap="100">
                                                <InlineStack gap="200" blockAlign="center">
                                                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                                                        #{index + 1}
                                                    </Text>
                                                    <Text as="span" variant="bodySm" tone="subdued">
                                                        {item.contentSummary}
                                                    </Text>
                                                </InlineStack>
                                                <InlineStack gap="400" wrap>
                                                    <Text as="span" variant="bodySm">
                                                        {t("scan.manualSupplement.checklist.platform")}: {platforms}
                                                    </Text>
                                                    <Text as="span" variant="bodySm">
                                                        {t("scan.manualSupplement.checklist.suggestion")}: {replacement}
                                                    </Text>
                                                    <Text as="span" variant="bodySm">
                                                        {t("scan.manualSupplement.checklist.riskScore")}: {item.result.riskScore}
                                                    </Text>
                                                    <Text as="span" variant="bodySm">
                                                        {t("scan.manualSupplement.checklist.majorRisk")}: {topRisk}
                                                    </Text>
                                                </InlineStack>
                                            </BlockStack>
                                            <Button
                                                variant="plain"
                                                tone="critical"
                                                size="slim"
                                                onClick={() => onRemoveFromReplacementChecklist(item.id)}
                                            >
                                                {t("scan.manualSupplement.checklist.remove")}
                                            </Button>
                                        </InlineStack>
                                    </Box>
                                );
                            })}
                        </BlockStack>
                    </BlockStack>
                </Card>
            )}
            {analysisResult && <AnalysisResultSummary analysisResult={analysisResult} />}
            {analysisResult && analysisResult.risks.length > 0 && (
                <Card>
                    <BlockStack gap="400">
                        <Text as="h2" variant="headingMd">
                            {t("scan.manualSupplement.riskDetails")}
                        </Text>
                        <BlockStack gap="300">
                            {analysisResult.risks.map((risk, index) => (
                                <Box key={index} background="bg-surface-secondary" padding="400" borderRadius="200">
                                    <BlockStack gap="200">
                                        <InlineStack align="space-between">
                                            <InlineStack gap="200">
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
                                {t("scan.manualSupplement.migrationSuggestions.title")}
                            </Text>
                            <Badge tone="info">{t("scan.manualSupplement.migrationSuggestions.badge")}</Badge>
                        </InlineStack>
                        <BlockStack gap="300">
                            {analysisResult.recommendations.map((rec, index) => {
                                const lines = typeof rec === 'string' ? rec.split('\n') : [];
                                const titleLine = lines.length > 0 ? (lines[0] || "") : "";
                                const titleMatch = titleLine.match(/\*\*(.*?)\*\*/);
                                const title = titleMatch ? titleMatch[1] : titleLine.replace(/^[^\w\u4e00-\u9fa5]+/, '');
                                const details = lines.length > 1 ? lines.slice(1).map(l => l.trim()).filter(l => l.length > 0) : [];
                                const linkLine = details.find(l => l.includes("http"));
                                const urlMatch = linkLine?.match(/(https?:\/\/[^\s]+)/);
                                const url = urlMatch ? urlMatch[1] : null;
                                const isInternal = title.includes("Google Analytics") || title.includes("Meta Pixel") || title.includes("TikTok");
                                const isExternal = !!url;
                                if (rec.includes("迁移清单建议") || rec.includes("Migration Checklist")) {
                                    return (
                                        <Box key={index} background="bg-surface-secondary" padding="400" borderRadius="200">
                                            <BlockStack gap="200">
                                                <Text as="h3" variant="headingSm">📋 {t("scan.manualSupplement.migrationSuggestions.comprehensive")}</Text>
                                                <List type="number">
                                                    {details.map((d, i) => {
                                                        const cleanText = d.replace(/^\d+\.\s*/, '').trim();
                                                        if (!cleanText) return null;
                                                        return <List.Item key={i}>{cleanText}</List.Item>;
                                                    })}
                                                </List>
                                            </BlockStack>
                                        </Box>
                                    );
                                }
                                return (
                                    <Box key={index} background="bg-surface-secondary" padding="400" borderRadius="200">
                                        <BlockStack gap="300">
                                            <InlineStack align="space-between" blockAlign="start">
                                                <BlockStack gap="100">
                                                    <Text as="h3" variant="headingSm">{title}</Text>
                                                    {details.map((line, i) => (
                                                        <Text key={i} as="p" variant="bodySm" tone="subdued">
                                                            {line}
                                                        </Text>
                                                    ))}
                                                </BlockStack>
                                                {isInternal && (
                                                    <Button url="/app/migrate" size="slim" icon={ArrowRightIcon}>
                                                        {t("scan.manualSupplement.migrationSuggestions.configure")}
                                                    </Button>
                                                )}
                                                {isExternal && !isInternal && (
                                                    <Button url={url!} external size="slim" icon={ShareIcon}>
                                                        {t("scan.manualSupplement.migrationSuggestions.viewApp")}
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
                            {t("scan.manualSupplement.migrationSuggestions.tool")}
                        </Button>
                    </BlockStack>
                </Card>
            )}
            {analysisResult && (
                <Card>
                    <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="100">
                                <Text as="h2" variant="headingMd">
                                    {t("scan.manualSupplement.save.title")}
                                </Text>
                                <Text as="p" variant="bodySm" tone="subdued">
                                    {t("scan.manualSupplement.save.desc")}
                                </Text>
                            </BlockStack>
                            {analysisSaved ? (
                                <Badge tone="success">{t("scan.manualSupplement.save.saved")}</Badge>
                            ) : null}
                        </InlineStack>
                        {(saveAnalysisFetcherData as { error?: string } | undefined)?.error && (
                            <Banner tone="critical">
                                <Text as="p">{(saveAnalysisFetcherData as { error?: string }).error}</Text>
                            </Banner>
                        )}
                        {(saveAnalysisFetcherData as { success?: boolean; message?: string } | undefined)?.success && (
                            <Banner tone="success">
                                <Text as="p">{(saveAnalysisFetcherData as { message?: string }).message}</Text>
                            </Banner>
                        )}
                        {(processPasteFetcherData as { error?: string } | undefined)?.error && (
                            <Banner tone="critical">
                                <Text as="p">{(processPasteFetcherData as { error?: string }).error}</Text>
                            </Banner>
                        )}
                        {(processPasteFetcherData as { success?: boolean; message?: string } | undefined)?.success && (
                            <Banner tone="success">
                                <Text as="p">{(processPasteFetcherData as { message?: string }).message}</Text>
                            </Banner>
                        )}
                        <InlineStack gap="200" align="end">
                            {scriptContent.trim() && (
                                <Button
                                    onClick={onProcessManualPaste}
                                    loading={isProcessingPaste}
                                    disabled={pasteProcessed || !scriptContent.trim()}
                                    icon={CheckCircleIcon}
                                    variant="primary"
                                >
                                    {pasteProcessed ? t("scan.manualSupplement.save.processed") : t("scan.manualSupplement.save.processPaste")}
                                </Button>
                            )}
                            <Button
                                onClick={onSaveAnalysis}
                                loading={isSavingAnalysis}
                                disabled={analysisSaved || (analysisResult.identifiedPlatforms.length === 0 && analysisResult.riskScore === 0)}
                                icon={CheckCircleIcon}
                            >
                                {analysisSaved ? t("scan.manualSupplement.save.saved") : t("scan.manualSupplement.save.saveAudit")}
                            </Button>
                        </InlineStack>
                    </BlockStack>
                </Card>
            )}
        </BlockStack>
    );
}