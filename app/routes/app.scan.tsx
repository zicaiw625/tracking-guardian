import type { loader } from "./app.scan/loader.server";
import type { action } from "./app.scan/action.server";

export { loader } from "./app.scan/loader.server";
export { action } from "./app.scan/action.server";
import { useLoaderData, useSubmit, useNavigation, useFetcher, useActionData, useSearchParams } from "@remix-run/react";
import { useState, useCallback, useMemo, useEffect, useRef, lazy, Suspense } from "react";
import { Page, Layout, Card, Text, BlockStack, InlineStack, Badge, Button, Banner, Box, Divider, ProgressBar, Icon, DataTable, Tabs, Modal, List, RangeSlider, } from "@shopify/polaris";
import { AlertCircleIcon, CheckCircleIcon, SearchIcon, ArrowRightIcon, ClipboardIcon, RefreshIcon, InfoIcon, ExportIcon, ShareIcon, SettingsIcon, ClockIcon, } from "~/components/icons";
import { CardSkeleton, EnhancedEmptyState, useToastContext } from "~/components/ui";
import { AnalysisResultSummary, getPlatformName, getSeverityBadge, getStatusText, getUpgradeBannerTone } from "~/components/scan";
import { MigrationDependencyGraph } from "~/components/scan/MigrationDependencyGraph";
import { AuditAssetsByRisk } from "~/components/scan/AuditAssetsByRisk";
import { ManualInputWizard, type ManualInputData } from "~/components/scan/ManualInputWizard";
import { MigrationChecklistEnhanced } from "~/components/scan/MigrationChecklistEnhanced";
import { ManualPastePanel } from "~/components/scan/ManualPastePanel";
import { GuidedSupplement } from "~/components/scan/GuidedSupplement";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { AuditPaywallCard } from "~/components/paywall/AuditPaywallCard";
import { ScanSummaryCards, MigrationImpactAnalysis } from "./app.scan/_components";

const ScriptCodeEditor = lazy(() => import("~/components/scan/ScriptCodeEditor").then(module => ({ default: module.ScriptCodeEditor })));
const MigrationChecklistTab = lazy(() => import("./app.scan/_components/MigrationChecklistTab").then(m => ({ default: m.MigrationChecklistTab })));
const ScanAutoTab = lazy(() => import("./app.scan/_components/ScanAutoTab").then(m => ({ default: m.ScanAutoTab })));
const ScanManualSupplementTab = lazy(() => import("./app.scan/_components/ScanManualSupplementTab").then(m => ({ default: m.ScanManualSupplementTab })));
import { getDateDisplayLabel, DEPRECATION_DATES } from "../utils/deprecation-dates";
import { isPlanAtLeast } from "../utils/plans";
import {
    validateScriptTagsArray,
    validateRiskItemsArray,
    validateStringArray,
    validateRiskScore,
} from "../utils/scan-data-validation";
import { generateChecklistText } from "../utils/scan-format";
import { useScriptAnalysis } from "./app.scan/_components/useScriptAnalysis";
import { getShopifyAdminUrl } from "../utils/helpers";
import { TIMEOUTS } from "../utils/scan-constants";
import { isFetcherResult, parseDateSafely, type FetcherResult } from "../utils/scan-validation";



type ScanPageProps = {
    initialTab?: number;
    showTabs?: boolean;
    pageTitle?: string;
    pageSubtitle?: string;
    showMigrationButtons?: boolean;
};

export function ScanPage({
    initialTab = 0,
    showTabs = true,
    pageTitle = "Audit 风险报告（免费获客）",
    pageSubtitle = "迁移清单 + 风险分级 + 替代路径（Web Pixel / 不可迁移）• 明确提示 checkout.liquid / additional scripts / script tags 在 Thank you/Order status 的弃用与限制 • 可导出 CSV",
    showMigrationButtons = false,
}: ScanPageProps) {
    const [searchParams] = useSearchParams();
    const tabParam = searchParams.get("tab");
    const tabFromUrl = tabParam === "1" ? 1 : tabParam === "2" ? 2 : 0;
    const effectiveInitialTab = tabParam !== null && tabParam !== "" ? tabFromUrl : initialTab;
    const { shop, latestScan, scanHistory, deprecationStatus, upgradeStatus, migrationActions, planId, planLabel, planTagline, migrationTimeline, migrationProgress, dependencyGraph, auditAssets, migrationChecklist, scriptAnalysisMaxContentLength, scriptAnalysisChunkSize, scannerMaxScriptTags, scannerMaxWebPixels } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();
    const navigation = useNavigation();
    const deleteFetcher = useFetcher();
    const upgradeFetcher = useFetcher();
    const saveAnalysisFetcher = useFetcher();
    const processPasteFetcher = useFetcher();
    const { showSuccess, showError } = useToastContext();
    const [selectedTab, setSelectedTab] = useState(effectiveInitialTab);
    const [analysisSaved, setAnalysisSaved] = useState(false);
    const scriptAnalysis = useScriptAnalysis(scriptAnalysisMaxContentLength, scriptAnalysisChunkSize);
    const { scriptContent, setScriptContent, analysisResult, analysisError, isAnalyzing, analysisProgress, handleAnalyzeScript } = scriptAnalysis;
    const [guidanceModalOpen, setGuidanceModalOpen] = useState(false);
    const [guidanceContent, setGuidanceContent] = useState<{ title: string; platform?: string; scriptTagId?: number } | null>(null);
    const [manualInputWizardOpen, setManualInputWizardOpen] = useState(false);
    const [guidedSupplementOpen, setGuidedSupplementOpen] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<{ type: "webPixel"; id: string; gid: string; title: string } | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [monthlyOrders, setMonthlyOrders] = useState(500);
    const [isCopying, setIsCopying] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [pasteProcessed, setPasteProcessed] = useState(false);
    const isScanning = navigation.state === "submitting";
    const isReloadingRef = useRef(false);
    const isMountedRef = useRef(true);
    const paywallViewTrackedRef = useRef(false);
    const reloadTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const exportTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const exportBlobUrlRef = useRef<string | null>(null);
    const introConfig = useMemo(() => {
        if (selectedTab === 1) {
            return {
                title: "手动补充 Additional Scripts",
                description: "补齐 Shopify API 无法读取的 Additional Scripts，确保报告覆盖 Thank you / Order status。",
                items: [
                    "粘贴 Additional Scripts 内容进行分析",
                    "生成完整的迁移清单与风险分级",
                    "支持一键保存到审计记录",
                ],
                primaryAction: { content: "进入手动分析", url: "/app/scan?tab=1" },
                secondaryAction: { content: "查看报告", url: "/app/scan?tab=2" },
            };
        }
        if (selectedTab === 2) {
            return {
                title: "Audit 迁移清单",
                description: "查看风险分级、推荐迁移路径与预估工时，作为迁移交付清单。",
                items: [
                    "清单支持 CSV 导出",
                    "标注 Web Pixel / 不可迁移 路径",
                    "优先处理高风险资产",
                ],
                primaryAction: { content: "查看完整报告", url: "/app/scan?tab=2" },
                secondaryAction: { content: "返回扫描", url: "/app/scan" },
            };
        }
        return {
            title: "Audit 自动扫描",
            description: "自动扫描 ScriptTags 与 Web Pixels，生成迁移风险评估和建议。",
            items: [
                "检测已安装像素与平台信号",
                "识别高风险脚本与阻塞项",
                "输出迁移路径与工时建议",
            ],
            primaryAction: { content: "开始扫描", url: "/app/scan" },
            secondaryAction: { content: "手动补充", url: "/app/scan?tab=1" },
        };
    }, [selectedTab]);
    useEffect(() => {
        setSelectedTab(effectiveInitialTab);
    }, [effectiveInitialTab]);
    const planIdSafe = planId || "free";
    const isGrowthOrAbove = isPlanAtLeast(planIdSafe, "growth");
    const isProOrAbove = isPlanAtLeast(planIdSafe, "pro");
    const isAgency = isPlanAtLeast(planIdSafe, "agency");
    const additionalScriptsWarning = (
      <Banner tone="warning" title="Additional Scripts 需手动粘贴">
        <BlockStack gap="200">
          <Text as="p">
            Shopify API 无法读取 checkout.liquid / Additional Scripts。请在下方「脚本内容分析」中粘贴原始脚本，确保迁移报告涵盖 Thank you / Order status 页的自定义逻辑。
          </Text>
          {deprecationStatus?.additionalScripts && (
            <Text as="p" tone="subdued">
              截止提醒：{deprecationStatus.additionalScripts.badge.text} — {deprecationStatus.additionalScripts.description}
            </Text>
          )}
          <Button
            size="slim"
            variant="plain"
            onClick={() => {
              setGuidanceContent({
                title: "如何从 Shopify 升级向导获取脚本清单",
                platform: undefined,
              });
              setGuidanceModalOpen(true);
            }}
          >
            📋 查看获取脚本清单的详细步骤
          </Button>
        </BlockStack>
      </Banner>
    );
    const identifiedPlatforms = useMemo(() => {
        return validateStringArray(latestScan?.identifiedPlatforms);
    }, [latestScan?.identifiedPlatforms]);
    const scriptTags = useMemo(() => {
        return validateScriptTagsArray(latestScan?.scriptTags);
    }, [latestScan?.scriptTags]);
    const identifiedPlatformsCount = identifiedPlatforms.length;
    const scriptTagsCount = scriptTags.length;
    const isDeleting = deleteFetcher.state === "submitting";
    const isUpgrading = upgradeFetcher.state === "submitting";
    const handleShowScriptTagGuidance = useCallback((scriptTagId: number, platform?: string) => {
        setGuidanceContent({
            title: `清理 ScriptTag #${scriptTagId}`,
            platform,
            scriptTagId,
        });
        setGuidanceModalOpen(true);
    }, []);
    const closeGuidanceModal = useCallback(() => {
        setGuidanceModalOpen(false);
        setGuidanceContent(null);
    }, []);
    const handleDeleteWebPixel = useCallback((webPixelGid: string, platform?: string) => {
        setPendingDelete({
            type: "webPixel",
            id: webPixelGid,
            gid: webPixelGid,
            title: `WebPixel${platform ? ` (${platform})` : ""}`,
        });
        setDeleteError(null);
        setDeleteModalOpen(true);
    }, []);
    const confirmDelete = useCallback(() => {
        if (!pendingDelete || isDeleting) return;
        if (!pendingDelete.gid || typeof pendingDelete.gid !== "string") {
            setDeleteError("无效的 WebPixel ID");
            return;
        }
        if (!pendingDelete.gid.startsWith("gid://shopify/WebPixel/")) {
            setDeleteError("WebPixel ID 格式不正确");
            return;
        }
        const formData = new FormData();
        formData.append("webPixelGid", pendingDelete.gid);
        setDeleteError(null);
        deleteFetcher.submit(formData, {
            method: "post",
            action: "/app/actions/delete-web-pixel",
        });
    }, [pendingDelete, deleteFetcher, isDeleting]);
    const closeDeleteModal = useCallback(() => {
        if (isDeleting) return;
        setDeleteModalOpen(false);
        setPendingDelete(null);
        setDeleteError(null);
    }, [isDeleting]);
    const handleUpgradePixelSettings = useCallback(() => {
        if (isUpgrading) return;
        const formData = new FormData();
        upgradeFetcher.submit(formData, {
            method: "post",
            action: "/app/actions/upgrade-web-pixel",
        });
    }, [upgradeFetcher, isUpgrading]);
    const handleScan = () => {
        const formData = new FormData();
        formData.append("_action", "scan");
        submit(formData, { method: "post" });
    };
    const wrappedHandleAnalyzeScript = useCallback(async () => {
        await handleAnalyzeScript();
    }, [handleAnalyzeScript]);
    useEffect(() => {
        if (analysisResult && (analysisResult.identifiedPlatforms.length > 0 || analysisResult.risks.length > 0)) {
            const formData = new FormData();
            formData.append("_action", "analyze_manual_script");
            formData.append("scriptContent", scriptContent.trim());
            submit(formData, { method: "post" });
        }
    }, [analysisResult, scriptContent, submit]);
    const isSavingAnalysis = saveAnalysisFetcher.state === "submitting";
    const analysisSavedRef = useRef(false);
    const handleSaveAnalysis = useCallback(() => {
        if (!analysisResult) return;
        if (analysisSavedRef.current || isSavingAnalysis || saveAnalysisFetcher.state !== "idle") {
            return;
        }
        analysisSavedRef.current = true;
        setAnalysisSaved(true);
        const formData = new FormData();
        formData.append("_action", "save_analysis");
        formData.append("analysisData", JSON.stringify(analysisResult));
        saveAnalysisFetcher.submit(formData, { method: "post" });
    }, [analysisResult, saveAnalysisFetcher, isSavingAnalysis]);
    const handleProcessManualPaste = useCallback(() => {
        if (!scriptContent.trim() || processPasteFetcher.state !== "idle") {
            return;
        }
        const formData = new FormData();
        formData.append("_action", "process_manual_paste");
        formData.append("scriptContent", scriptContent);
        processPasteFetcher.submit(formData, { method: "post" });
    }, [scriptContent, processPasteFetcher]);
    const handleManualInputComplete = useCallback(async (data: ManualInputData) => {
        if (!shop) {
            showError("店铺信息未找到");
            return;
        }
        try {
            const assets = [];
            for (const platform of data.platforms) {
                if (platform === "other") continue;
                assets.push({
                    sourceType: data.fromUpgradeWizard ? "merchant_confirmed" : "manual_paste" as const,
                    category: "pixel" as const,
                    platform,
                    displayName: `手动补充: ${platform}`,
                    riskLevel: "medium" as const,
                    suggestedMigration: "web_pixel" as const,
                    details: {
                        fromWizard: true,
                        fromUpgradeWizard: data.fromUpgradeWizard,
                        additionalInfo: data.additionalInfo,
                    },
                });
            }
            for (const feature of data.features) {
                if (feature === "other") continue;
                const categoryMap: Record<string, "survey" | "support" | "affiliate" | "other"> = {
                    survey: "survey",
                    support: "support",
                    affiliate: "affiliate",
                    reorder: "other",
                    upsell: "other",
                    tracking: "other",
                };
                const migrationMap: Record<string, "ui_extension" | "web_pixel" | "server_side"> = {
                    survey: "ui_extension",
                    support: "ui_extension",
                    affiliate: "server_side",
                    reorder: "ui_extension",
                    upsell: "ui_extension",
                    tracking: "ui_extension",
                };
                assets.push({
                    sourceType: data.fromUpgradeWizard ? "merchant_confirmed" : "manual_paste" as const,
                    category: categoryMap[feature] || "other",
                    displayName: `手动补充: ${feature}`,
                    riskLevel: "medium" as const,
                    suggestedMigration: migrationMap[feature] || "ui_extension",
                    details: {
                        fromWizard: true,
                        fromUpgradeWizard: data.fromUpgradeWizard,
                        additionalInfo: data.additionalInfo,
                    },
                });
            }
            if (assets.length > 0) {
                const formData = new FormData();
                formData.append("_action", "create_from_wizard");
                formData.append("assets", JSON.stringify(assets));
                submit(formData, { method: "post" });
                showSuccess(`正在创建 ${assets.length} 个审计资产记录...`);
            } else {
                showError("请至少选择一个平台或功能");
            }
        } catch (error) {
            const { debugError } = await import("../utils/debug-log.client");
            debugError("Failed to process manual input", error);
            showError("处理失败，请稍后重试");
        }
    }, [shop, showSuccess, showError, submit]);
    const isProcessingPaste = processPasteFetcher.state === "submitting";
    useEffect(() => {
        const result = isFetcherResult(processPasteFetcher.data) ? processPasteFetcher.data : undefined;
        if (!result || processPasteFetcher.state !== "idle" || !isMountedRef.current) return;
        if (result.success) {
            setPasteProcessed(true);
            showSuccess(result.message || "已成功处理粘贴内容");
            if (reloadTimeoutRef.current) {
                clearTimeout(reloadTimeoutRef.current);
            }
            reloadTimeoutRef.current = setTimeout(() => {
                window.location.reload();
            }, 1500);
        } else if (result.error) {
            showError(result.error);
        }
    }, [processPasteFetcher.data, processPasteFetcher.state, showSuccess, showError]);
    useEffect(() => {
        const result = isFetcherResult(saveAnalysisFetcher.data) ? saveAnalysisFetcher.data : undefined;
        if (!result || saveAnalysisFetcher.state !== "idle" || !isMountedRef.current) return;
        if (result.success) {
            if (!analysisSavedRef.current) {
                analysisSavedRef.current = true;
            }
            setAnalysisSaved(true);
            showSuccess("分析结果已保存！");
        } else if (result.error) {
            analysisSavedRef.current = false;
            setAnalysisSaved(false);
            showError("保存失败：" + result.error);
        }
    }, [saveAnalysisFetcher.data, saveAnalysisFetcher.state, showSuccess, showError]);
    useEffect(() => {
        if (analysisResult) {
            analysisSavedRef.current = false;
            setAnalysisSaved(false);
        }
    }, [analysisResult]);
    const reloadData = useCallback(() => {
        if (isReloadingRef.current || !isMountedRef.current) return;
        if (reloadTimeoutRef.current) {
            clearTimeout(reloadTimeoutRef.current);
            reloadTimeoutRef.current = null;
        }
        isReloadingRef.current = true;
        submit(new FormData(), { method: "get" });
        const timeoutId = setTimeout(() => {
            if (isMountedRef.current && reloadTimeoutRef.current === timeoutId) {
                isReloadingRef.current = false;
                reloadTimeoutRef.current = null;
            }
        }, 1000);
        reloadTimeoutRef.current = timeoutId;
    }, [submit]);
    useEffect(() => {
        const deleteResult = isFetcherResult(deleteFetcher.data) ? deleteFetcher.data : undefined;
        if (!deleteResult || deleteFetcher.state !== "idle" || !isMountedRef.current) return;
        if (deleteResult.success) {
            showSuccess(deleteResult.message || "删除成功！");
            setDeleteModalOpen(false);
            setPendingDelete(null);
            setDeleteError(null);
            reloadData();
        } else {
            let errorMessage = deleteResult.error || "删除失败";
            if (deleteResult.details && typeof deleteResult.details === "object") {
                const details = deleteResult.details as { message?: string };
                if (details.message) {
                    errorMessage = details.message;
                }
            }
            setDeleteError(errorMessage);
            showError(errorMessage);
        }
    }, [deleteFetcher.data, deleteFetcher.state, showSuccess, showError, reloadData]);
    useEffect(() => {
        const upgradeResult = isFetcherResult(upgradeFetcher.data) ? upgradeFetcher.data : undefined;
        if (!upgradeResult || upgradeFetcher.state !== "idle" || !isMountedRef.current) return;
        if (upgradeResult.success) {
            showSuccess(upgradeResult.message || "升级成功！");
            reloadData();
        } else {
            let errorMessage = upgradeResult.error || "升级失败";
            if (upgradeResult.details && typeof upgradeResult.details === "object") {
                const details = upgradeResult.details as { message?: string };
                if (details.message) {
                    errorMessage = details.message;
                }
            }
            showError(errorMessage);
        }
    }, [upgradeFetcher.data, upgradeFetcher.state, showSuccess, showError, reloadData]);
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            if (reloadTimeoutRef.current) {
                clearTimeout(reloadTimeoutRef.current);
                reloadTimeoutRef.current = null;
            }
            if (exportTimeoutRef.current) {
                clearTimeout(exportTimeoutRef.current);
                exportTimeoutRef.current = null;
            }
            if (exportBlobUrlRef.current) {
                URL.revokeObjectURL(exportBlobUrlRef.current);
                exportBlobUrlRef.current = null;
            }
            isReloadingRef.current = false;
            analysisSavedRef.current = false;
        };
    }, []);
  const tabs = [
    { id: "auto-scan", content: "自动扫描" },
    { id: "manual-supplement", content: "手动补充" },
    { id: "migration-checklist", content: "迁移清单" },
  ];
  const visibleTabs = showTabs ? tabs : [];
  const shouldShowMigrationButtons = showMigrationButtons && (!showTabs || selectedTab === 2 || pageTitle === "Audit 迁移清单");
  const auditAssetCount = useMemo(
    () => (Array.isArray(auditAssets) ? auditAssets.filter((asset): asset is NonNullable<typeof asset> => asset !== null).length : 0),
    [auditAssets]
  );
  useEffect(() => {
    if (paywallViewTrackedRef.current || !shouldShowMigrationButtons) {
      return;
    }
    paywallViewTrackedRef.current = true;
    const riskScore = latestScan?.riskScore ?? 0;
    void fetch("/api/analytics-track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "app_paywall_viewed",
        eventId: `app_paywall_viewed_${shop?.id ?? "unknown"}_audit_report`,
        metadata: {
          triggerPage: "audit_report",
          plan: planIdSafe,
          role: isAgency ? "agency" : "merchant",
          risk_score: riskScore,
          asset_count: auditAssetCount,
        },
      }),
    });
  }, [auditAssetCount, isAgency, latestScan?.riskScore, planIdSafe, shouldShowMigrationButtons, shop?.id]);
  const paginationLimitWarning = (
    <Banner tone="info" title="扫描分页说明">
      <BlockStack gap="200">
        <Text as="p">
          Shopify API 结果是分页的。本扫描会自动迭代页面，但为了性能会在以下阈值停止并提示：
        </Text>
        <List type="bullet">
          <List.Item>ScriptTags 最多处理 {scannerMaxScriptTags.toLocaleString()} 条记录</List.Item>
          <List.Item>Web Pixel 最多处理 {scannerMaxWebPixels.toLocaleString()} 条记录</List.Item>
        </List>
        <Text as="p" tone="subdued">
          如果商店超过以上数量，请在「手动分析」中粘贴剩余脚本，或联系支持获取完整导出（当前上限可调整，请联系我们）。
        </Text>
      </BlockStack>
    </Banner>
  );
    const MAX_VISIBLE_ACTIONS = 5;
    const handleGenerateChecklistText = useCallback((format: "markdown" | "plain"): string => {
        return generateChecklistText(migrationActions, shop?.domain, format);
    }, [migrationActions, shop?.domain]);
    const handleExportCSV = useCallback(async () => {
        if (!latestScan) return;
        try {
            const response = await fetch(`/api/scan-report/csv?reportId=${encodeURIComponent(latestScan.id)}`);
            if (!response.ok) {
                let msg = "导出失败";
                try {
                    const errorData = await response.json();
                    msg = errorData.error || msg;
                } catch {
                    // JSON 解析失败，使用默认错误消息
                }
                showError(msg);
                return;
            }
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `scan-report-${latestScan.id}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showSuccess("扫描报告 CSV 导出成功");
        } catch (error) {
            showError("导出失败：" + (error instanceof Error ? error.message : "未知错误"));
        }
    }, [latestScan, showSuccess, showError]);
    const handleCopyChecklist = useCallback(async () => {
        if (isCopying) return;
        setIsCopying(true);
        try {
            const checklist = handleGenerateChecklistText("markdown");
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(checklist);
                showSuccess("清单已复制到剪贴板");
            } else {
                showError("浏览器不支持复制功能");
            }
        } catch (error) {
            const { debugError } = await import("../utils/debug-log.client");
            debugError("复制失败:", error);
            showError("复制失败，请手动复制");
        } finally {
            setIsCopying(false);
        }
    }, [isCopying, handleGenerateChecklistText, showSuccess, showError]);
    const handleExportChecklist = useCallback(() => {
        if (isExporting) return;
        setIsExporting(true);
        if (exportBlobUrlRef.current) {
            URL.revokeObjectURL(exportBlobUrlRef.current);
            exportBlobUrlRef.current = null;
        }
        try {
            const checklist = handleGenerateChecklistText("plain");
            const blob = new Blob([checklist], { type: "text/plain" });
            const url = URL.createObjectURL(blob);
            exportBlobUrlRef.current = url;
            const a = document.createElement("a");
            a.href = url;
            a.download = `migration-checklist-${new Date().toISOString().split("T")[0]}.txt`;
            try {
                document.body.appendChild(a);
                a.click();
                exportTimeoutRef.current = setTimeout(() => {
                    try {
                        if (a.parentNode) {
                            document.body.removeChild(a);
                        }
                    } catch (removeError) {
                        import("../utils/debug-log.client").then(({ debugWarn }) => {
                          debugWarn("Failed to remove download link:", removeError);
                        });
                    }
                    if (exportBlobUrlRef.current) {
                        URL.revokeObjectURL(exportBlobUrlRef.current);
                        exportBlobUrlRef.current = null;
                    }
                    exportTimeoutRef.current = null;
                }, TIMEOUTS.EXPORT_CLEANUP);
            } catch (domError) {
                import("../utils/debug-log.client").then(({ debugError }) => {
                  debugError("Failed to trigger download:", domError);
                });
                if (exportBlobUrlRef.current) {
                    URL.revokeObjectURL(exportBlobUrlRef.current);
                    exportBlobUrlRef.current = null;
                }
                showError("导出失败：无法创建下载链接");
                setIsExporting(false);
                return;
            }
            showSuccess("清单导出成功");
            setIsExporting(false);
        } catch (error) {
            import("../utils/debug-log.client").then(({ debugError }) => {
              debugError("导出失败:", error);
            });
            if (exportBlobUrlRef.current) {
                URL.revokeObjectURL(exportBlobUrlRef.current);
                exportBlobUrlRef.current = null;
            }
            showError("导出失败，请重试");
            setIsExporting(false);
        }
    }, [isExporting, handleGenerateChecklistText, showSuccess, showError]);
    const riskItems = useMemo(() => {
        return validateRiskItemsArray(latestScan?.riskItems);
    }, [latestScan?.riskItems]);
  const partialRefreshWarning = actionData &&
    typeof actionData === "object" &&
    actionData !== null &&
    "partialRefresh" in actionData &&
    (actionData as { partialRefresh?: boolean }).partialRefresh ? (
    <Banner tone="warning" title="部分数据刷新失败">
      <BlockStack gap="200">
        <Text as="p" variant="bodySm">
          扫描使用了缓存数据，但无法刷新 Web Pixels 信息。Web Pixels、重复像素检测和迁移操作建议可能不完整。
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          建议：点击「开始扫描」按钮重新执行完整扫描以获取最新数据。
        </Text>
      </BlockStack>
    </Banner>
  ) : null;
  return (<Page title={pageTitle} subtitle={pageSubtitle}>
    <BlockStack gap="500">
      {additionalScriptsWarning}
      {paginationLimitWarning}
      {partialRefreshWarning}
      {upgradeStatus && upgradeStatus.autoUpgradeInfo && upgradeStatus.autoUpgradeInfo.autoUpgradeMessage && (
        <Banner 
          title={upgradeStatus.autoUpgradeInfo.isInAutoUpgradeWindow ? "⚡ Plus 商家自动升级窗口已开始" : "⚠️ Plus 商家自动升级风险窗口"}
          tone={upgradeStatus.autoUpgradeInfo.isInAutoUpgradeWindow ? "critical" : "warning"}
        >
          <BlockStack gap="200">
            <Text as="p">{upgradeStatus.autoUpgradeInfo.autoUpgradeMessage}</Text>
              <Text as="p" variant="bodySm" tone="subdued">
              <strong>Shopify 官方升级路径：</strong>使用 blocks + web pixels 替代 legacy customizations。Plus 商家：{getDateDisplayLabel(DEPRECATION_DATES.plusAdditionalScriptsReadOnly, "exact")}（日期来自 Shopify 官方公告，请以 Admin 提示为准）截止，{getDateDisplayLabel(DEPRECATION_DATES.plusAutoUpgradeStart, "month")}（日期来自 Shopify 官方公告，请以 Admin 提示为准）自动升级会丢失 legacy 自定义。非 Plus 商家：{getDateDisplayLabel(DEPRECATION_DATES.nonPlusAdditionalScriptsReadOnly, "exact")}（日期来自 Shopify 官方公告，请以 Admin 提示为准）截止。
            </Text>
          </BlockStack>
        </Banner>
      )}
      {upgradeStatus && upgradeStatus.title && upgradeStatus.message && (() => {
        const lastUpdatedDate = parseDateSafely(upgradeStatus.lastUpdated);
        return (
          <Banner title={upgradeStatus.title} tone={getUpgradeBannerTone(upgradeStatus.urgency)}>
            <BlockStack gap="200">
              <Text as="p">{upgradeStatus.message}</Text>
              {(upgradeStatus.actions?.length ?? 0) > 0 && (
                <BlockStack gap="100">
                  {upgradeStatus.actions.map((action, idx) => (
                    <Text key={idx} as="p" variant="bodySm">
                      • {action}
                    </Text>
                  ))}
                </BlockStack>
              )}
              {!upgradeStatus.hasOfficialSignal && (
                <Text as="p" variant="bodySm" tone="subdued">
                  提示：我们尚未完成一次有效的升级状态检测。请稍后重试、重新授权应用，或等待后台定时任务自动刷新。
                </Text>
              )}
              {lastUpdatedDate && (
                <Text as="p" variant="bodySm" tone="subdued">
                  状态更新时间: {lastUpdatedDate.toLocaleString("zh-CN")}
                </Text>
              )}
            </BlockStack>
          </Banner>
        );
      })()}
      {planId && planLabel && (
        <Banner
          title={`当前套餐：${planLabel}`}
          tone={isGrowthOrAbove ? "info" : "warning"}
          action={{
            content: "查看套餐/升级",
            url: "/app/settings?tab=subscription",
          }}
        >
          <BlockStack gap="200">
            {planTagline && (
              <Text as="p" variant="bodySm">{planTagline}</Text>
            )}
            {!isGrowthOrAbove && (
              <List type="bullet">
                <List.Item><strong>启用像素迁移（Test 环境）</strong> → 进入付费试用/订阅（Starter $29/月）</List.Item>
                <List.Item>像素迁移功能包括：标准事件映射 + 参数完整率检查 + 可下载 payload 证据（GA4/Meta/TikTok v1 支持）</List.Item>
                <List.Item><strong>生成验收报告（CSV）</strong> → 付费（Growth $79/月 或 Agency $199/月）</List.Item>
                <List.Item>这是"升级项目交付"的核心能力：让商家"敢点发布/敢切 Live"</List.Item>
              </List>
            )}
            {isGrowthOrAbove && !isProOrAbove && (
              <List type="bullet">
                <List.Item>当前可用：Web Pixel 标准事件映射（v1 最小可用迁移）</List.Item>
                <List.Item>升级到 Pro 以解锁事件对账与高级告警能力</List.Item>
              </List>
            )}
            {isProOrAbove && !isAgency && (
              <List type="bullet">
                <List.Item>已解锁多渠道像素 + 事件对账</List.Item>
                <List.Item>多店铺、白标、团队协作即将在 v1.1 推出，可升级至 Agency 以在发布后使用</List.Item>
              </List>
            )}
            {isAgency && (
              <List type="bullet">
                <List.Item>多店铺、白标、团队协作即将在 v1.1 推出；当前已解锁无限像素、验收报告导出与 SLA</List.Item>
                <List.Item>如需迁移托管，可在支持渠道提交工单</List.Item>
              </List>
            )}
          </BlockStack>
        </Banner>
      )}
      <PageIntroCard
        title={introConfig.title}
        description={introConfig.description}
        items={introConfig.items}
        primaryAction={introConfig.primaryAction}
        secondaryAction={introConfig.secondaryAction}
      />
        <Tabs tabs={visibleTabs} selected={selectedTab} onSelect={setSelectedTab}>
          {}
          {shouldShowMigrationButtons && (
            <AuditPaywallCard planId={planIdSafe} />
          )}
          {selectedTab === 0 && (
            <Suspense fallback={<Card><BlockStack gap="400"><CardSkeleton lines={4} showTitle /></BlockStack></Card>}>
              <ScanAutoTab
                latestScan={latestScan}
                isScanning={isScanning}
                handleScan={handleScan}
                onExportCSV={handleExportCSV}
                upgradeStatus={upgradeStatus}
                identifiedPlatforms={identifiedPlatforms}
                scriptTags={scriptTags}
                deprecationStatus={deprecationStatus}
                planId={planId || "free"}
                planIdSafe={planIdSafe}
                riskItems={riskItems}
                migrationActions={migrationActions}
                auditAssets={auditAssets}
                migrationProgress={migrationProgress}
                migrationTimeline={migrationTimeline}
                dependencyGraph={dependencyGraph}
                shop={shop}
                scanHistory={scanHistory}
                monthlyOrders={monthlyOrders}
                onMonthlyOrdersChange={setMonthlyOrders}
                onShowScriptTagGuidance={handleShowScriptTagGuidance}
                onDeleteWebPixel={handleDeleteWebPixel}
                onUpgradePixelSettings={handleUpgradePixelSettings}
                isDeleting={isDeleting}
                pendingDelete={pendingDelete}
                isUpgrading={isUpgrading}
                submit={submit}
                isCopying={isCopying}
                isExporting={isExporting}
                onCopyChecklist={handleCopyChecklist}
                onExportChecklist={handleExportChecklist}
              />
            </Suspense>
          )}
              <Box paddingBlockStart="400">
                <InlineStack align="space-between">
                  {latestScan && (
                    <InlineStack gap="200">
                      <Button
                        icon={ExportIcon}
                        onClick={async () => {
                          try {
                            const response = await fetch(`/api/scan-report/csv?reportId=${encodeURIComponent(latestScan.id)}`);
                            if (!response.ok) {
                              let msg = "导出失败";
                              try {
                                const errorData = await response.json();
                                msg = errorData.error || msg;
                              } catch {
                                // no-op: use default msg if JSON parse fails
                              }
                              showError(msg);
                              return;
                            }
                            const blob = await response.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = `scan-report-${latestScan.id}.csv`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                            showSuccess("扫描报告 CSV 导出成功");
                          } catch (error) {
                            showError("导出失败：" + (error instanceof Error ? error.message : "未知错误"));
                          }
                        }}
                      >
                        导出扫描报告 CSV
                      </Button>
                    </InlineStack>
                  )}
                  <InlineStack gap="200">
                    <Button variant="primary" onClick={handleScan} loading={isScanning} icon={SearchIcon}>
                      {isScanning ? "扫描中..." : "开始扫描"}
                    </Button>
                  </InlineStack>
                </InlineStack>
              </Box>
              {isScanning && (
                <Card>
                  <BlockStack gap="400">
                    <CardSkeleton lines={4} showTitle={true} />
                    <Box paddingBlockStart="200">
                      <ProgressBar progress={75} tone="primary"/>
                    </Box>
                  </BlockStack>
                </Card>
              )}
              {!latestScan && !isScanning && (
                <EnhancedEmptyState
                  icon="🔍"
                  title="还没有扫描报告"
                  description="点击开始扫描，我们会自动检测 ScriptTags 和已安装的像素配置，并给出风险等级与迁移建议。预计耗时约 10 秒，不会修改任何设置。"
                  helpText="关于 Additional Scripts：Shopify API 无法自动读取 checkout.liquid 中的 Additional Scripts。请切换到「手动分析」标签页，粘贴脚本内容进行分析。"
                  primaryAction={{
                    content: "开始扫描",
                    onAction: handleScan,
                  }}
                  secondaryAction={{
                    content: "了解更多",
                    url: "https://help.shopify.com/en/manual/pixels/web-pixels",
                  }}
                />
              )}
        {latestScan && !isScanning && upgradeStatus && upgradeStatus.title && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Shopify 升级风险窗口
                </Text>
                <Badge tone={upgradeStatus.urgency === "critical" ? "critical" : upgradeStatus.urgency === "high" ? "warning" : "info"}>
                  {upgradeStatus.urgency === "critical" ? "紧急" : upgradeStatus.urgency === "high" ? "高优先级" : upgradeStatus.urgency === "medium" ? "中优先级" : "低优先级"}
                </Badge>
              </InlineStack>
              <Divider />
              <Banner tone={upgradeStatus.urgency === "critical" ? "critical" : upgradeStatus.urgency === "high" ? "warning" : "info"} title={upgradeStatus.title}>
                <BlockStack gap="200">
                  <Text as="p">{upgradeStatus.message}</Text>
                  {upgradeStatus.autoUpgradeInfo && upgradeStatus.autoUpgradeInfo.autoUpgradeMessage && (
                    <Banner tone={upgradeStatus.autoUpgradeInfo.isInAutoUpgradeWindow ? "critical" : "warning"} title={upgradeStatus.autoUpgradeInfo.isInAutoUpgradeWindow ? "⚡ 自动升级窗口已开始" : "⚠️ 自动升级风险窗口"}>
                      <Text as="p">{upgradeStatus.autoUpgradeInfo.autoUpgradeMessage}</Text>
                    </Banner>
                  )}
                  {upgradeStatus.actions && upgradeStatus.actions.length > 0 && (
                    <BlockStack gap="100">
                      <Text as="p" fontWeight="semibold">建议操作：</Text>
                      <List>
                        {upgradeStatus.actions.map((action, idx) => (
                          <List.Item key={idx}>{action}</List.Item>
                        ))}
                      </List>
                    </BlockStack>
                  )}
                </BlockStack>
              </Banner>
            </BlockStack>
          </Card>
        )}
        {latestScan && !isScanning && upgradeStatus && upgradeStatus.title && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Shopify 升级风险窗口
                </Text>
                <Badge tone={upgradeStatus.urgency === "critical" ? "critical" : upgradeStatus.urgency === "high" ? "warning" : "info"}>
                  {upgradeStatus.urgency === "critical" ? "紧急" : upgradeStatus.urgency === "high" ? "高优先级" : upgradeStatus.urgency === "medium" ? "中优先级" : "低优先级"}
                </Badge>
              </InlineStack>
              <Divider />
              <Banner tone={upgradeStatus.urgency === "critical" ? "critical" : upgradeStatus.urgency === "high" ? "warning" : "info"} title={upgradeStatus.title}>
                <BlockStack gap="200">
                  <Text as="p">{upgradeStatus.message}</Text>
                  {upgradeStatus.autoUpgradeInfo && upgradeStatus.autoUpgradeInfo.autoUpgradeMessage && (
                    <Banner tone={upgradeStatus.autoUpgradeInfo.isInAutoUpgradeWindow ? "critical" : "warning"} title={upgradeStatus.autoUpgradeInfo.isInAutoUpgradeWindow ? "自动升级窗口已开始" : "自动升级风险窗口"}>
                      <Text as="p">{upgradeStatus.autoUpgradeInfo.autoUpgradeMessage}</Text>
                    </Banner>
                  )}
                  {upgradeStatus.actions && upgradeStatus.actions.length > 0 && (
                    <BlockStack gap="100">
                      <Text as="p" fontWeight="semibold">建议操作：</Text>
                      <List>
                        {upgradeStatus.actions.map((action, idx) => (
                          <List.Item key={idx}>{action}</List.Item>
                        ))}
                      </List>
                    </BlockStack>
                  )}
                </BlockStack>
              </Banner>
            </BlockStack>
          </Card>
        )}
        {latestScan && !isScanning && (
          <ScanSummaryCards
            latestScan={latestScan}
            identifiedPlatforms={identifiedPlatforms}
            scriptTags={scriptTags}
            deprecationStatus={deprecationStatus}
            planIdSafe={planIdSafe}
          />
        )}
        {latestScan && !isScanning && latestScan.riskScore > 0 && (
          <MigrationImpactAnalysis
            latestScan={latestScan}
            identifiedPlatforms={identifiedPlatforms}
            scriptTags={scriptTags}
            monthlyOrders={monthlyOrders}
            onMonthlyOrdersChange={setMonthlyOrders}
          />
        )}
        {latestScan && riskItems.length > 0 && !isScanning && (<Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  风险详情
                </Text>
                <Badge tone="info">{`${riskItems.length} 项`}</Badge>
              </InlineStack>
              <Banner tone="info">
                <Text as="p" variant="bodySm">
                  风险识别基于脚本 URL 和已知平台指纹推断，并非实际脚本内容分析。如需更精确的检测，请在「脚本内容分析」中粘贴实际脚本代码。
                </Text>
              </Banner>
              {(() => {
                const isFreePlan = planId === "free";
                const FREE_AUDIT_LIMIT = 3;
                const highRiskItems = riskItems.filter(item => item.severity === "high");
                const displayedItems = isFreePlan
                  ? highRiskItems.slice(0, FREE_AUDIT_LIMIT)
                  : riskItems;
                const hiddenCount = isFreePlan
                  ? Math.max(0, riskItems.length - FREE_AUDIT_LIMIT)
                  : 0;
                const estimatedTimeMinutes = riskItems.reduce((sum, item) => {
                  const timeMap = { high: 30, medium: 15, low: 5 };
                  return sum + (timeMap[item.severity] || 10);
                }, 0);
                return (
                  <>
                    <BlockStack gap="300">
                      {displayedItems.map((item, index) => (<Box key={index} background="bg-surface-secondary" padding="400" borderRadius="200">
                    <BlockStack gap="300">
                      <InlineStack align="space-between">
                        <InlineStack gap="200">
                          <Icon source={AlertCircleIcon} tone={item.severity === "high"
                        ? "critical"
                        : item.severity === "medium"
                            ? "warning"
                            : "info"}/>
                          <Text as="span" fontWeight="semibold">
                            {item.name}
                          </Text>
                        </InlineStack>
                        {getSeverityBadge(item.severity)}
                      </InlineStack>
                      <Text as="p" tone="subdued">
                        {item.description}
                      </Text>
                      {item.details && (<Text as="p" variant="bodySm">
                          {item.details}
                        </Text>)}
                      <InlineStack align="space-between" blockAlign="center">
                        <InlineStack gap="200">
                          {item.platform && (<Badge>{getPlatformName(item.platform)}</Badge>)}
                          {item.impact && (<Text as="span" variant="bodySm" tone="critical">
                              影响: {item.impact}
                            </Text>)}
                        </InlineStack>
                        <Button url={`/app/migrate${item.platform ? `?platform=${item.platform}` : ""}`} size="slim" icon={ArrowRightIcon}>
                          一键迁移
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Box>))}
                    </BlockStack>
                    {isFreePlan && hiddenCount > 0 && (
                      <Banner tone="warning">
                        <BlockStack gap="200">
                          <Text as="p" variant="bodySm">
                            <strong>免费版限制：</strong>仅显示前 {FREE_AUDIT_LIMIT} 条高风险项，还有 {hiddenCount} 项未显示。
                          </Text>
                          <InlineStack gap="200">
                            <Button
                              url="/app/billing"
                              variant="primary"
                              size="slim"
                            >
                              升级解锁完整报告
                            </Button>
                            <Button
                              url="/app/migrate"
                              size="slim"
                            >
                              启用 Purchase-only 修复（10 分钟）
                            </Button>
                          </InlineStack>
                        </BlockStack>
                      </Banner>
                    )}
                    <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="span" fontWeight="semibold">
                            预计修复时间
                          </Text>
                          <Badge tone={estimatedTimeMinutes > 60 ? "warning" : "info"}>
                            {estimatedTimeMinutes > 60
                              ? `${Math.floor(estimatedTimeMinutes / 60)} 小时 ${estimatedTimeMinutes % 60} 分钟`
                              : `${estimatedTimeMinutes} 分钟`}
                          </Badge>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          基于当前风险项数量和严重程度估算
                        </Text>
                        {isFreePlan && (
                          <Banner tone="info">
                            <Text as="p" variant="bodySm">
                              <strong>升级到 Migration 版</strong>可启用 Full-funnel 修复（30 分钟，Growth 套餐），获得完整迁移清单和验收报告。
                            </Text>
                          </Banner>
                        )}
                      </BlockStack>
                    </Box>
                  </>
                );
              })()}
            </BlockStack>
          </Card>)}
        {latestScan && migrationActions && migrationActions.length > 0 && !isScanning && (<Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  迁移操作
                </Text>
                <Badge tone="attention">{`${migrationActions.length} 项待处理`}</Badge>
              </InlineStack>
              <BlockStack gap="300">
                {migrationActions.map((action, index) => (
                  <Box key={`${action.type}-${action.platform || 'unknown'}-${action.scriptTagId || action.webPixelGid || index}`} background="bg-surface-secondary" padding="400" borderRadius="200">
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="start">
                        <BlockStack gap="100">
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="span" fontWeight="semibold">
                              {action.title}
                            </Text>
                            <Badge tone={
                              action.priority === "high" ? "critical" :
                              action.priority === "medium" ? "warning" : "info"
                            }>
                              {action.priority === "high" ? "高优先级" :
                               action.priority === "medium" ? "中优先级" : "低优先级"}
                            </Badge>
                          </InlineStack>
                          {action.platform && (
                            <Badge>{getPlatformName(action.platform)}</Badge>
                          )}
                        </BlockStack>
                        {action.deadline && (
                          <Badge tone="warning">{`截止: ${action.deadline}`}</Badge>
                        )}
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {action.description}
                      </Text>
                      <InlineStack gap="200" align="end">
                        {action.type === "migrate_script_tag" && action.scriptTagId && (
                          <Button
                            size="slim"
                            icon={InfoIcon}
                            onClick={() => handleShowScriptTagGuidance(
                              action.scriptTagId!,
                              action.platform
                            )}
                          >
                            查看清理指南
                          </Button>
                        )}
                        {action.type === "remove_duplicate" && action.webPixelGid && (
                          <Button
                            tone="critical"
                            size="slim"
                            loading={isDeleting && pendingDelete?.gid === action.webPixelGid}
                            onClick={() => handleDeleteWebPixel(action.webPixelGid!, action.platform)}
                          >
                            删除重复像素
                          </Button>
                        )}
                        {action.type === "configure_pixel" && action.description?.includes("升级") && (
                          <Button
                            size="slim"
                            icon={RefreshIcon}
                            loading={isUpgrading}
                            onClick={handleUpgradePixelSettings}
                          >
                            升级配置
                          </Button>
                        )}
                        {action.type === "configure_pixel" && !action.description?.includes("升级") && (
                          <Button
                            size="slim"
                            url="/app/migrate"
                            icon={ArrowRightIcon}
                          >
                            配置 Pixel
                          </Button>
                        )}
                      </InlineStack>
                    </BlockStack>
                  </Box>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>)}
        {latestScan && auditAssets && Array.isArray(auditAssets) && auditAssets.length > 0 && !isScanning && (
          <AuditAssetsByRisk
            assets={auditAssets.filter((a): a is NonNullable<typeof a> => a !== null).map((asset) => ({
              ...asset,
              createdAt: new Date(asset.createdAt),
              updatedAt: new Date(asset.updatedAt),
              migratedAt: asset.migratedAt ? new Date(asset.migratedAt) : null,
            }))}
            currentPlan={planId === "pro" ? "growth" : planId === "free" || planId === "starter" || planId === "growth" || planId === "agency" ? planId : "free"}
            freeTierLimit={3}
            onAssetClick={(assetId) => {
              window.location.href = `/app/migrate?asset=${assetId}`;
            }}
          />
        )}
        {migrationProgress && migrationTimeline && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  📊 迁移进度
                </Text>
                <Badge tone={migrationProgress.completionRate === 100 ? "success" : "attention"}>
                  {`${Math.round(migrationProgress.completionRate)}% 完成`}
                </Badge>
              </InlineStack>
              <BlockStack gap="300">
                <ProgressBar
                  progress={migrationProgress.completionRate}
                  tone={migrationProgress.completionRate === 100 ? "success" : "primary"}
                  size="medium"
                />
                <InlineStack gap="400" align="space-between" wrap>
                  <BlockStack gap="100">
                    <Text as="span" variant="bodySm" tone="subdued">
                      总计: {migrationProgress.total} 项
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      已完成: {migrationProgress.completed} | 进行中: {migrationProgress.inProgress} | 待处理: {migrationProgress.pending}
                    </Text>
                  </BlockStack>
                  {migrationTimeline.totalEstimatedTime > 0 && (
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={ClockIcon} tone="subdued" />
                      <Text as="span" variant="bodySm" tone="subdued" fontWeight="semibold">
                        预计剩余时间: {Math.round(migrationTimeline.totalEstimatedTime / 60)} 小时 {migrationTimeline.totalEstimatedTime % 60} 分钟
                      </Text>
                    </InlineStack>
                  )}
                </InlineStack>
              </BlockStack>
              {migrationTimeline.assets.length > 0 && (
                <>
                  <Divider />
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">
                      下一步建议
                    </Text>
                      {migrationTimeline.assets
                      .filter((item) => item.canStart && item.asset.migrationStatus === "pending")
                      .slice(0, 3)
                      .map((item) => (
                        <Box key={item.asset.id} background="bg-surface-secondary" padding="300" borderRadius="200">
                          <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="100">
                              <InlineStack gap="200" blockAlign="center">
                                <Text as="span" fontWeight="semibold">
                                  {item.asset.displayName || item.asset.platform || "未知资产"}
                                </Text>
                                <Badge tone={(item.asset.priority || item.priority.priority) >= 8 ? "critical" : (item.asset.priority || item.priority.priority) >= 5 ? undefined : "info"}>
                                  {`优先级 ${item.asset.priority || item.priority.priority}/10`}
                                </Badge>
                                {(item.asset.priority || item.priority.priority) >= 8 && (
                                  <Badge tone="attention">高优先级</Badge>
                                )}
                                {(item.asset.priority || item.priority.priority) >= 5 && (item.asset.priority || item.priority.priority) < 8 && (
                                  <Badge tone="warning">中优先级</Badge>
                                )}
                              </InlineStack>
                              <InlineStack gap="200" blockAlign="center">
                                <Text as="span" variant="bodySm" tone="subdued">
                                  {item.priority.reason || "无说明"}
                                </Text>
                                {item.asset.estimatedTimeMinutes && (
                                  <InlineStack gap="100" blockAlign="center">
                                    <Icon source={ClockIcon} />
                                    <Badge>
                                      {`预计 ${item.asset.estimatedTimeMinutes < 60
                                        ? `${item.asset.estimatedTimeMinutes} 分钟`
                                        : `${Math.floor(item.asset.estimatedTimeMinutes / 60)} 小时 ${item.asset.estimatedTimeMinutes % 60} 分钟`}`}
                                    </Badge>
                                  </InlineStack>
                                )}
                                {!item.asset.estimatedTimeMinutes && item.priority.estimatedTime && (
                                  <InlineStack gap="100" blockAlign="center">
                                    <Icon source={ClockIcon} />
                                    <Badge>
                                      {`预计 ${item.priority.estimatedTime < 60
                                        ? `${item.priority.estimatedTime} 分钟`
                                        : `${Math.floor(item.priority.estimatedTime / 60)} 小时 ${item.priority.estimatedTime % 60} 分钟`}`}
                                    </Badge>
                                  </InlineStack>
                                )}
                              </InlineStack>
                              {item.blockingDependencies.length > 0 && (
                                <Banner tone="warning">
                                  <Text as="p" variant="bodySm">
                                    等待 {item.blockingDependencies.length} 个依赖项完成
                                  </Text>
                                </Banner>
                              )}
                            </BlockStack>
                            <InlineStack gap="200">
                              <Button
                                size="slim"
                                url={`/app/migrate?asset=${item.asset.id}`}
                                disabled={!item.canStart}
                              >
                                开始迁移
                              </Button>
                              <Button
                                size="slim"
                                variant="plain"
                                onClick={() => {
                                  const formData = new FormData();
                                  formData.append("_action", "mark_asset_complete");
                                  formData.append("assetId", item.asset.id);
                                  submit(formData, { method: "post" });
                                }}
                              >
                                标记完成
                              </Button>
                            </InlineStack>
                          </InlineStack>
                        </Box>
                      ))}
                    {migrationTimeline.assets.filter((item) => item.canStart && item.asset.migrationStatus === "pending").length === 0 && (
                      <Banner tone="success">
                        <Text as="p" variant="bodySm">
                          所有可立即开始的迁移任务已完成！请检查是否有依赖项需要先完成。
                        </Text>
                      </Banner>
                    )}
                  </BlockStack>
                  {dependencyGraph && (
                    <>
                      <Divider />
                      <MigrationDependencyGraph dependencyGraph={dependencyGraph} />
                    </>
                  )}
                </>
              )}
            </BlockStack>
          </Card>
        )}
        {latestScan && !isScanning && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  🧭 迁移向导
                </Text>
                <Badge tone="info">P1-3 迁移闭环</Badge>
              </InlineStack>
              <Text as="p" tone="subdued">
                根据扫描结果，以下是完成迁移所需的步骤。点击各项可直接跳转到对应位置。
              </Text>
              <Divider />
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  📦 Web Pixel 设置
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Web Pixel 是 Shopify 推荐的客户端追踪方式，替代传统 ScriptTag。
                </Text>
                <InlineStack gap="300" wrap>
                  <Button
                    url={shop?.domain ? getShopifyAdminUrl(shop.domain, "/settings/notifications") : "#"}
                    disabled={!shop?.domain}
                    external
                    icon={ShareIcon}
                  >
                    管理 Pixels（Shopify 后台）
                  </Button>
                  <Button
                    url="/app/migrate"
                    icon={ArrowRightIcon}
                  >
                    在应用内配置 Pixel
                  </Button>
                </InlineStack>
              </BlockStack>
              <Divider />
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  🛒 Checkout Editor（参考）
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  如果您已启用新的 Thank you / Order status 体验，请使用 Shopify 官方编辑器完成页面侧自定义（本应用不提供页面模块库）。
                </Text>
                <InlineStack gap="300" wrap>
                  <Button
                    url={shop?.domain ? getShopifyAdminUrl(shop.domain, "/themes/current/editor") : "#"}
                    disabled={!shop?.domain}
                    external
                    icon={ShareIcon}
                  >
                    打开 Checkout Editor
                  </Button>
                  <Button
                    url="https://shopify.dev/docs/apps/online-store/checkout-extensibility"
                    external
                    icon={InfoIcon}
                  >
                    查看官方文档
                  </Button>
                </InlineStack>
              </BlockStack>
              <Divider />
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  📋 迁移清单
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  生成可导出的迁移步骤清单，方便团队协作或记录进度。
                </Text>
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" fontWeight="semibold">待迁移项目：</Text>
                    <List type="number">
                      {migrationActions && migrationActions.length > 0 ? (
                        migrationActions.slice(0, MAX_VISIBLE_ACTIONS).map((action) => (
                          <List.Item key={`${action.type}-${action.platform || 'unknown'}-${action.scriptTagId || action.webPixelGid || 'no-id'}`}>
                            {action.title}
                            {action.platform && ` (${getPlatformName(action.platform)})`}
                            {action.priority === "high" && " ⚠️"}
                          </List.Item>
                        ))
                      ) : (
                        <List.Item>暂无待处理项目 ✅</List.Item>
                      )}
                      {migrationActions && migrationActions.length > MAX_VISIBLE_ACTIONS && (
                        <List.Item>...还有 {migrationActions.length - MAX_VISIBLE_ACTIONS} 项</List.Item>
                      )}
                    </List>
                    <InlineStack gap="200" align="end">
                      <Button
                        icon={ClipboardIcon}
                        loading={isCopying}
                        onClick={async () => {
                          if (isCopying) return;
                          setIsCopying(true);
                          try {
                            const checklist = handleGenerateChecklistText("markdown");
                            if (navigator.clipboard && navigator.clipboard.writeText) {
                              await navigator.clipboard.writeText(checklist);
                              showSuccess("清单已复制到剪贴板");
                            } else {
                              showError("浏览器不支持复制功能");
                            }
                          } catch (error) {
                            const { debugError } = await import("../utils/debug-log.client");
                            debugError("复制失败:", error);
                            showError("复制失败，请手动复制");
                          } finally {
                            setIsCopying(false);
                          }
                        }}
                      >
                        复制清单
                      </Button>
                      <Button
                        icon={ExportIcon}
                        loading={isExporting}
                        onClick={() => {
                          if (isExporting) return;
                          setIsExporting(true);
                          if (exportBlobUrlRef.current) {
                            URL.revokeObjectURL(exportBlobUrlRef.current);
                            exportBlobUrlRef.current = null;
                          }
                          try {
                            const checklist = handleGenerateChecklistText("plain");
                            const blob = new Blob([checklist], { type: "text/plain" });
                            const url = URL.createObjectURL(blob);
                            exportBlobUrlRef.current = url;
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = `migration-checklist-${new Date().toISOString().split("T")[0]}.txt`;
                            try {
                              document.body.appendChild(a);
                              a.click();
                              exportTimeoutRef.current = setTimeout(() => {
                                try {
                                  if (a.parentNode) {
                                    document.body.removeChild(a);
                                  }
                                } catch (removeError) {
                                  import("../utils/debug-log.client").then(({ debugWarn }) => {
                                    debugWarn("Failed to remove download link:", removeError);
                                  });
                                }
                                if (exportBlobUrlRef.current) {
                                  URL.revokeObjectURL(exportBlobUrlRef.current);
                                  exportBlobUrlRef.current = null;
                                }
                                exportTimeoutRef.current = null;
                              }, TIMEOUTS.EXPORT_CLEANUP);
                            } catch (domError) {
                              import("../utils/debug-log.client").then(({ debugError }) => {
                                debugError("Failed to trigger download:", domError);
                              });
                              if (exportBlobUrlRef.current) {
                                URL.revokeObjectURL(exportBlobUrlRef.current);
                                exportBlobUrlRef.current = null;
                              }
                              showError("导出失败：无法创建下载链接");
                              setIsExporting(false);
                              return;
                            }
                            showSuccess("清单导出成功");
                            setIsExporting(false);
                          } catch (error) {
                            import("../utils/debug-log.client").then(({ debugError }) => {
                              debugError("导出失败:", error);
                            });
                            if (exportBlobUrlRef.current) {
                              URL.revokeObjectURL(exportBlobUrlRef.current);
                              exportBlobUrlRef.current = null;
                            }
                            showError("导出失败，请重试");
                            setIsExporting(false);
                          }
                        }}
                      >
                        导出文本
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Box>
              </BlockStack>
              <Divider />
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  🔄 替代方案一览
                </Text>
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="300">
                    <InlineStack gap="400" wrap>
                      <Box minWidth="200px">
                        <BlockStack gap="100">
                          <Badge tone="success">官方替代</Badge>
                          <Text as="p" variant="bodySm">
                            • Shopify Pixels（客户端）
                            <br />• Customer Events API
                          </Text>
                        </BlockStack>
                      </Box>
                      <Box minWidth="200px">
                        <BlockStack gap="100">
                          <Badge tone="info">Web Pixel 替代</Badge>
                          <Text as="p" variant="bodySm">
                            • ScriptTag → Web Pixel
                            <br />• checkout.liquid → Web Pixel
                          </Text>
                        </BlockStack>
                      </Box>
                      <Box minWidth="200px">
                        <BlockStack gap="100">
                          <Badge tone="warning">页面侧自定义</Badge>
                          <Text as="p" variant="bodySm">
                            • Additional Scripts：需人工梳理并在新体验下重做
                            <br />• Thank you/Order status 自定义逻辑：以 Shopify 官方能力为准
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            <strong>说明：</strong>当前版本不提供 Survey/Help/Reorder 等页面模块库，页面侧功能请按 Shopify 官方能力与审核要求实施。
                          </Text>
                        </BlockStack>
                      </Box>
                    </InlineStack>
                  </BlockStack>
                </Box>
              </BlockStack>
            </BlockStack>
          </Card>
        )}
          {selectedTab === 1 && (
            <Suspense fallback={<Card><BlockStack gap="400"><CardSkeleton lines={4} showTitle /></BlockStack></Card>}>
              <ScanManualSupplementTab
                shop={shop}
                deprecationStatus={deprecationStatus}
                scriptContent={scriptContent}
                setScriptContent={setScriptContent}
                analysisResult={analysisResult}
                analysisError={analysisError}
                isAnalyzing={isAnalyzing}
                analysisProgress={analysisProgress}
                handleAnalyzeScript={wrappedHandleAnalyzeScript}
                onShowGuidance={(title) => {
                    setGuidanceContent({ title });
                    setGuidanceModalOpen(true);
                }}
                onOpenGuidedSupplement={() => setGuidedSupplementOpen(true)}
                onOpenManualInputWizard={() => setManualInputWizardOpen(true)}
                onAssetsCreated={(count) => {
                    showSuccess(`成功创建 ${count} 个迁移资产`);
                    window.location.reload();
                }}
                ScriptCodeEditor={ScriptCodeEditor}
                analysisSaved={analysisSaved}
                isSavingAnalysis={isSavingAnalysis}
                isProcessingPaste={isProcessingPaste}
                pasteProcessed={pasteProcessed}
                onSaveAnalysis={handleSaveAnalysis}
                onProcessManualPaste={handleProcessManualPaste}
                saveAnalysisFetcherData={saveAnalysisFetcher.data}
                processPasteFetcherData={processPasteFetcher.data}
              />
            </Suspense>
          )}
          {selectedTab === 2 && (
            <Suspense fallback={<Card><BlockStack gap="400"><CardSkeleton lines={4} showTitle /></BlockStack></Card>}>
              <MigrationChecklistTab
                showTabs={showTabs}
                planIdSafe={planIdSafe}
                latestScan={latestScan}
                migrationChecklist={migrationChecklist}
                dependencyGraph={dependencyGraph}
                handleScan={handleScan}
                submit={submit}
              />
            </Suspense>
          )}
        </Tabs>
        <Modal
          open={guidanceModalOpen}
          onClose={closeGuidanceModal}
          title={guidanceContent?.title || "ScriptTag 清理指南"}
          primaryAction={{
            content: "我知道了",
            onAction: closeGuidanceModal,
          }}
          secondaryActions={[
            {
              content: "前往迁移工具",
              url: `/app/migrate${guidanceContent?.platform ? `?platform=${guidanceContent.platform}` : ""}`,
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              {guidanceContent?.title?.includes("升级向导") ? (
                <>
                  <Text as="p" variant="bodyMd">
                    您可以从 Shopify Admin 的升级向导中获取脚本清单，然后手动补充到扫描报告中。
                  </Text>
                  <List type="number">
                    <List.Item>
                      <Text as="span" fontWeight="semibold">访问升级向导</Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        在 Shopify Admin 中，前往「设置」→「结账和订单处理」→「Thank you / Order status 页面升级」
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" fontWeight="semibold">查看脚本清单</Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        升级向导会显示当前使用的 Additional Scripts 和 ScriptTags 列表
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" fontWeight="semibold">复制脚本内容</Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        对于每个脚本，复制其完整内容（包括 URL 或内联代码）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" fontWeight="semibold">粘贴到本页面</Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        返回本页面，在「脚本内容分析」标签页中粘贴脚本内容，点击「分析脚本」进行识别
                      </Text>
                    </List.Item>
                  </List>
                  <Banner tone="info">
                    <Text as="p" variant="bodySm">
                      💡 提示：如果升级向导中显示的脚本较多，建议分批粘贴和分析，避免一次性处理过多内容。
                    </Text>
                  </Banner>
                  <Button
                    url="https://help.shopify.com/en/manual/pixels/customer-events"
                    external
                    variant="primary"
                  >
                    打开 Shopify 升级向导帮助文档
                  </Button>
                </>
              ) : (
                <>
                  <Banner tone="info">
                    <Text as="p" variant="bodySm">
                      由于 Shopify 权限限制，应用无法直接删除 ScriptTag。
                      请按照以下步骤手动清理，或等待原创建应用自动处理。
                    </Text>
                  </Banner>
              <BlockStack gap="200">
                <Text as="p" fontWeight="semibold">推荐清理步骤：</Text>
                <List type="number">
                  <List.Item>
                    <Text as="span">
                      <strong>确认 Web Pixel 已启用</strong>：在「迁移」页面确认 Tracking Guardian Pixel 已安装并正常运行
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span">
                      <strong>配置像素凭证</strong>：在「迁移」页面配置相应平台的像素 ID（GA4/Meta/TikTok）
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span">
                      <strong>验证追踪正常</strong>：完成一次测试订单，在「监控」页面确认事件已收到
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span">
                      <strong>手动删除 ScriptTag</strong>：前往 Shopify 后台 → 设置 → 应用和销售渠道，找到创建该 ScriptTag 的应用并卸载
                    </Text>
                  </List.Item>
                </List>
              </BlockStack>
              <Divider />
              <BlockStack gap="200">
                <Text as="p" fontWeight="semibold">找不到创建应用？</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  如果 ScriptTag 是由已卸载的应用创建的残留数据，您可以：
                </Text>
                <List type="bullet">
                  <List.Item>联系 Shopify 支持，提供 ScriptTag ID: {guidanceContent?.scriptTagId}</List.Item>
                  <List.Item>使用 Shopify GraphQL API 手动删除（需开发者权限）</List.Item>
                  <List.Item>等待 ScriptTag 自动过期（Plus 商家将于 {getDateDisplayLabel(DEPRECATION_DATES.plusScriptTagExecutionOff, "exact")}（日期来自 Shopify 官方公告，请以 Admin 提示为准）停止执行，非 Plus 商家将于 {getDateDisplayLabel(DEPRECATION_DATES.nonPlusScriptTagExecutionOff, "exact")}（日期来自 Shopify 官方公告，请以 Admin 提示为准）停止执行）</List.Item>
                </List>
              </BlockStack>
              {guidanceContent?.platform && (
                <>
                  <Divider />
                  <Banner tone="success">
                    <Text as="p" variant="bodySm">
                      💡 安装 Tracking Guardian 的 Web Pixel 后，旧的 {guidanceContent.platform} ScriptTag 可以安全删除，
                      因为 Web Pixel 标准事件映射将接管所有转化追踪功能（v1 最小可用迁移）。
                    </Text>
                  </Banner>
                </>
              )}
                </>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>
        <Modal
          open={deleteModalOpen}
          onClose={closeDeleteModal}
          title="确认删除"
          primaryAction={{
            content: "确认删除",
            destructive: true,
            onAction: confirmDelete,
            loading: isDeleting,
            disabled: isDeleting,
          }}
          secondaryActions={[
            {
              content: "取消",
              onAction: closeDeleteModal,
              disabled: isDeleting,
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              <Text as="p">
                您确定要删除 <strong>{pendingDelete?.title}</strong> 吗？
              </Text>
              {deleteError && (
                <Banner tone="critical">
                  <Text as="p" variant="bodySm">
                    {deleteError}
                  </Text>
                </Banner>
              )}
              <Banner tone="warning">
                <Text as="p" variant="bodySm">
                  此操作不可撤销。删除后，相关追踪功能将立即停止。
                  请确保您已通过其他方式配置了替代追踪方案。
                </Text>
              </Banner>
            </BlockStack>
          </Modal.Section>
        </Modal>
        <ManualInputWizard
          open={manualInputWizardOpen}
          onClose={() => setManualInputWizardOpen(false)}
          onComplete={handleManualInputComplete}
        />
        <GuidedSupplement
          open={guidedSupplementOpen}
          onClose={() => setGuidedSupplementOpen(false)}
          onComplete={(count) => {
            showSuccess(`成功创建 ${count} 个迁移资产`);
            window.location.reload();
          }}
          shopId={shop?.id || ""}
        />
      </BlockStack>
    </Page>);
}

export default ScanPage;
