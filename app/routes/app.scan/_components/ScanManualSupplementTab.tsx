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
                                    <Text as="p" variant="bodySm">
                                        • 请勿将脚本内容分享给他人或在公共场所粘贴。
                                    </Text>
                                </BlockStack>
                            </Banner>
                        </BlockStack>
                        <Banner tone="critical" title={`Plus：${getDateDisplayLabel(DEPRECATION_DATES.plusScriptTagExecutionOff, "exact")} / 非 Plus：${getDateDisplayLabel(DEPRECATION_DATES.nonPlusScriptTagExecutionOff, "exact")} 将失效`}>
                            <BlockStack gap="100">
                                <Text as="p" variant="bodySm">
                                    这是 Thank you / Order status 页面迁移的硬性截止时间。提前粘贴 Additional Scripts 代码并完成迁移，可避免追踪中断。
                                </Text>
                                <Text as="p" variant="bodySm" tone="subdued">
                                    以上日期来自 Shopify 官方公告，仅供参考。实际截止日期请以 Shopify Admin 中的提示为准。Shopify 可能会更新策略，我们建议您定期查看 Shopify 官方文档。
                                </Text>
                                {deprecationStatus && (
                                    <Text as="p" variant="bodySm" tone="subdued">
                                        当前剩余：{deprecationStatus.additionalScripts?.badge.text} — {deprecationStatus.additionalScripts?.description}
                                    </Text>
                                )}
                                <InlineStack gap="200">
                                    <Button url="/app/migrate" icon={ArrowRightIcon} size="slim" variant="primary">
                                        前往迁移页面
                                    </Button>
                                    <Button url="/app/migrate#pixel" icon={SettingsIcon} size="slim" variant="secondary">
                                        启用/升级 App Pixel
                                    </Button>
                                </InlineStack>
                            </BlockStack>
                        </Banner>
                        <Banner tone="info">
                            <BlockStack gap="200">
                                <InlineStack align="space-between" blockAlign="start">
                                    <BlockStack gap="200">
                                        <Text as="p" fontWeight="semibold">如何获取 Additional Scripts：</Text>
                                        <Text as="p" variant="bodySm">
                                            1. 前往 Shopify 后台 → 设置 → 结账
                                            <br />2. 找到「订单状态页面」或「Additional Scripts」区域
                                            <br />3. 复制其中的所有代码
                                            <br />4. 粘贴到下方文本框中
                                        </Text>
                                    </BlockStack>
                                    <InlineStack gap="200">
                                        <Button
                                            onClick={onOpenGuidedSupplement}
                                            variant="primary"
                                            size="slim"
                                        >
                                            从升级向导补充
                                        </Button>
                                        <Button
                                            onClick={onOpenManualInputWizard}
                                            size="slim"
                                        >
                                            引导补充信息
                                        </Button>
                                        <Button
                                            onClick={() => onShowGuidance("从 Shopify 升级向导导入脚本")}
                                            variant="plain"
                                            size="slim"
                                        >
                                            从升级向导导入
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
                                placeholder={`<!-- 示例 -->
<script>
  gtag('event', 'purchase', {...});
  fbq('track', 'Purchase', {...});
</script>`}
                                enableRealtimeAnalysis={false}
                                enableBatchPaste={true}
                            />
                        </Suspense>
                        {analysisProgress && (
                            <Box paddingBlockStart="200">
                                <Text as="p" variant="bodySm" tone="subdued">
                                    分析进度: {analysisProgress.current} / {analysisProgress.total}
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
                                    加入清单并添加下一条
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
                                替代方案清单
                            </Text>
                            <Button onClick={onExportReplacementChecklistCSV} variant="primary" size="slim">
                                导出替代方案清单 CSV
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
                                const replacement = hasTracking ? "Web Pixel 迁移" : hasDomRisk ? "Checkout UI Extension 或需人工复核" : "需人工复核（review & replace）";
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
                                                        平台: {platforms}
                                                    </Text>
                                                    <Text as="span" variant="bodySm">
                                                        建议: {replacement}
                                                    </Text>
                                                    <Text as="span" variant="bodySm">
                                                        风险分: {item.result.riskScore}
                                                    </Text>
                                                    <Text as="span" variant="bodySm">
                                                        主要风险: {topRisk}
                                                    </Text>
                                                </InlineStack>
                                            </BlockStack>
                                            <Button
                                                variant="plain"
                                                tone="critical"
                                                size="slim"
                                                onClick={() => onRemoveFromReplacementChecklist(item.id)}
                                            >
                                                移除
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
                            风险详情
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
                                if (rec.includes("迁移清单建议")) {
                                    return (
                                        <Box key={index} background="bg-surface-secondary" padding="400" borderRadius="200">
                                            <BlockStack gap="200">
                                                <Text as="h3" variant="headingSm">📋 综合迁移建议</Text>
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
            {analysisResult && (
                <Card>
                    <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="100">
                                <Text as="h2" variant="headingMd">
                                    保存分析结果
                                </Text>
                                <Text as="p" variant="bodySm" tone="subdued">
                                    将分析结果保存到审计资产记录，方便后续跟踪迁移进度
                                </Text>
                            </BlockStack>
                            {analysisSaved ? (
                                <Badge tone="success">已保存</Badge>
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
                                    {pasteProcessed ? "已处理" : "直接处理粘贴内容"}
                                </Button>
                            )}
                            <Button
                                onClick={onSaveAnalysis}
                                loading={isSavingAnalysis}
                                disabled={analysisSaved || (analysisResult.identifiedPlatforms.length === 0 && analysisResult.riskScore === 0)}
                                icon={CheckCircleIcon}
                            >
                                {analysisSaved ? "已保存" : "保存到审计记录"}
                            </Button>
                        </InlineStack>
                    </BlockStack>
                </Card>
            )}
        </BlockStack>
    );
}
