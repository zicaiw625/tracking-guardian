import type { loader } from "./app.scan/loader.server";
import type { action } from "./app.scan/action.server";

export { loader } from "./app.scan/loader.server";
export { action } from "./app.scan/action.server";
import { useLoaderData, useSubmit, useNavigation, useFetcher, useActionData, useSearchParams, useNavigate } from "@remix-run/react";
import { useState, useCallback, useMemo, useEffect, useRef, lazy, Suspense } from "react";
import { Page, Card, BlockStack, Tabs } from "@shopify/polaris";
import { CardSkeleton, useToastContext } from "~/components/ui";
import { type ManualInputData } from "~/components/scan/ManualInputWizard";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { AuditPaywallCard } from "~/components/paywall/AuditPaywallCard";
import { ScanPageBanners } from "./app.scan/_components/ScanPageBanners";
import { ScanPageModals } from "./app.scan/_components/ScanPageModals";

const ScriptCodeEditor = lazy(() => import("~/components/scan/ScriptCodeEditor").then(module => ({ default: module.ScriptCodeEditor })));
const MigrationChecklistTab = lazy(() => import("./app.scan/_components/MigrationChecklistTab").then(m => ({ default: m.MigrationChecklistTab })));
const ScanAutoTab = lazy(() => import("./app.scan/_components/ScanAutoTab").then(m => ({ default: m.ScanAutoTab })));
const ScanManualSupplementTab = lazy(() => import("./app.scan/_components/ScanManualSupplementTab").then(m => ({ default: m.ScanManualSupplementTab })));
import { isPlanAtLeast } from "../utils/plans";
import {
    validateScriptTagsArray,
    validateRiskItemsArray,
    validateStringArray,
} from "../utils/scan-data-validation";
import { generateChecklistText } from "../utils/scan-format";
import { useScriptAnalysis } from "./app.scan/_components/useScriptAnalysis";
import { TIMEOUTS } from "../utils/scan-constants";
import { isFetcherResult } from "../utils/scan-validation";
import type { ScriptAnalysisResult } from "../services/scanner.server";
import { useTranslation } from "react-i18next";



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
    pageTitle,
    pageSubtitle,
    showMigrationButtons = false,
}: ScanPageProps) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const tabParam = searchParams.get("tab");
    const tabFromUrl = tabParam === "1" ? 1 : tabParam === "2" ? 2 : 0;
    const effectiveInitialTab = tabParam !== null && tabParam !== "" ? tabFromUrl : initialTab;
    const { shop, latestScan, scanHistory, deprecationStatus, upgradeStatus, migrationActions, planId, planLabel, planTagline, migrationTimeline, migrationProgress, dependencyGraph, auditAssets, migrationChecklist, scriptAnalysisMaxContentLength, scriptAnalysisChunkSize, scannerMaxScriptTags, scannerMaxWebPixels, webPixelsCount } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();
    const navigation = useNavigation();
    const deleteFetcher = useFetcher();
    const upgradeFetcher = useFetcher();
    const saveAnalysisFetcher = useFetcher();
    const { showSuccess, showError } = useToastContext();
    const [selectedTab, setSelectedTab] = useState(effectiveInitialTab);
    const [analysisSaved, setAnalysisSaved] = useState(false);
    const scriptAnalysis = useScriptAnalysis(scriptAnalysisMaxContentLength, scriptAnalysisChunkSize);
    const { scriptContent, setScriptContent, analysisResult, setAnalysisResult, analysisError, isAnalyzing, analysisProgress, handleAnalyzeScript } = scriptAnalysis;
    const [replacementChecklistItems, setReplacementChecklistItems] = useState<Array<{ id: string; contentSummary: string; result: ScriptAnalysisResult }>>([]);
    const [guidanceModalOpen, setGuidanceModalOpen] = useState(false);
    const [guidanceContent, setGuidanceContent] = useState<{ title: string; platform?: string; scriptTagId?: number; type?: "upgrade_guide" | "script_tag_guidance" | "import_wizard" } | null>(null);
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
                title: t("scan.intro.manual.title"),
                description: t("scan.intro.manual.description"),
                items: [
                    t("scan.intro.manual.items.0"),
                    t("scan.intro.manual.items.1"),
                    t("scan.intro.manual.items.2"),
                ],
                primaryAction: { content: t("scan.intro.manual.action.primary"), url: "/app/scan?tab=1" },
                secondaryAction: { content: t("scan.intro.manual.action.secondary"), url: "/app/scan?tab=2" },
            };
        }
        if (selectedTab === 2) {
            return {
                title: t("scan.intro.checklist.title"),
                description: t("scan.intro.checklist.description"),
                items: [
                    t("scan.intro.checklist.items.0"),
                    t("scan.intro.checklist.items.1"),
                    t("scan.intro.checklist.items.2"),
                ],
                primaryAction: { content: t("scan.intro.checklist.action.primary"), url: "/app/scan?tab=2" },
                secondaryAction: { content: t("scan.intro.checklist.action.secondary"), url: "/app/scan" },
            };
        }
        return {
            title: t("scan.intro.auto.title"),
            description: t("scan.intro.auto.description"),
            items: [
                t("scan.intro.auto.items.0"),
                t("scan.intro.auto.items.1"),
                t("scan.intro.auto.items.2"),
            ],
            // Auto scan tab has its own primary action in the content area (empty state or top bar)
            secondaryAction: { content: t("scan.intro.auto.action.secondary"), url: "/app/scan?tab=1" },
        };
    }, [selectedTab, t]);
    useEffect(() => {
        setSelectedTab(effectiveInitialTab);
    }, [effectiveInitialTab]);
    const planIdSafe = planId || "free";
    const isGrowthOrAbove = isPlanAtLeast(planIdSafe, "growth");
    const isProOrAbove = isPlanAtLeast(planIdSafe, "pro");
    const isAgency = isPlanAtLeast(planIdSafe, "agency");
    const showPartialRefresh = actionData &&
      typeof actionData === "object" &&
      actionData !== null &&
      "partialRefresh" in actionData &&
      (actionData as { partialRefresh?: boolean }).partialRefresh === true;
    const identifiedPlatforms = useMemo(() => {
        return validateStringArray(latestScan?.identifiedPlatforms);
    }, [latestScan?.identifiedPlatforms]);
    const scriptTags = useMemo(() => {
        return validateScriptTagsArray(latestScan?.scriptTags);
    }, [latestScan?.scriptTags]);
    const isDeleting = deleteFetcher.state === "submitting";
    const isUpgrading = upgradeFetcher.state === "submitting";
    const handleShowScriptTagGuidance = useCallback((scriptTagId: number, platform?: string) => {
        setGuidanceContent({
            title: t("scan.modals.cleanScriptTag.title", { id: scriptTagId }),
            platform,
            scriptTagId,
            type: "script_tag_guidance",
        });
        setGuidanceModalOpen(true);
    }, [t]);
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
            setDeleteError(t("scan.errors.invalidPixelId"));
            return;
        }
        if (!pendingDelete.gid.startsWith("gid://shopify/WebPixel/")) {
            setDeleteError(t("scan.errors.invalidPixelFormat"));
            return;
        }
        const formData = new FormData();
        formData.append("webPixelGid", pendingDelete.gid);
        setDeleteError(null);
        deleteFetcher.submit(formData, {
            method: "post",
            action: "/app/actions/delete-web-pixel",
        });
    }, [pendingDelete, deleteFetcher, isDeleting, t]);
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
        // Ensure riskScore is an integer
        const payload = {
            ...analysisResult,
            riskScore: Math.round(analysisResult.riskScore || 0)
        };
        formData.append("analysisData", JSON.stringify(payload));
        saveAnalysisFetcher.submit(formData, { method: "post" });
    }, [analysisResult, saveAnalysisFetcher, isSavingAnalysis]);
    const handleProcessManualPaste = useCallback(() => {
        if (!analysisResult || saveAnalysisFetcher.state !== "idle") {
            return;
        }
        handleSaveAnalysis();
    }, [analysisResult, saveAnalysisFetcher.state, handleSaveAnalysis]);
    const addToReplacementChecklist = useCallback(() => {
        if (!analysisResult) return;
        const summary = scriptContent.slice(0, 80).replace(/\s+/g, " ").trim() || t("scan.manualInput.noSummary");
        setReplacementChecklistItems((prev) => [
            ...prev,
            { id: crypto.randomUUID(), contentSummary: summary, result: analysisResult },
        ]);
        setScriptContent("");
        setAnalysisResult(null);
    }, [analysisResult, scriptContent, setScriptContent, setAnalysisResult, t]);
    const removeFromReplacementChecklist = useCallback((id: string) => {
        setReplacementChecklistItems((prev) => prev.filter((x) => x.id !== id));
    }, []);
    const exportReplacementChecklistCSV = useCallback(() => {
        const TRACKING_PLATFORMS = ["google", "meta", "tiktok", "facebook", "ga4", "pixel"];
        const getReplacementSuggestion = (r: ScriptAnalysisResult): string => {
            const hasTracking = r.identifiedPlatforms.some((p) =>
                TRACKING_PLATFORMS.some((t) => p.toLowerCase().includes(t))
            );
            const hasDomRisk = r.risks.some(
                (risk) =>
                    /window|document|dom/i.test(risk.id) || /window|document|dom/i.test(risk.name || "")
            );
            if (hasTracking) return t("scan.manualInput.webPixelMigration");
            if (hasDomRisk) return t("scan.manualInput.checkoutUiExtension");
            return t("scan.manualInput.manualReview");
        };
        const escapeCSV = (v: string | number): string => {
            const s = String(v).trim();
            if (/^[=+\-@]/.test(s)) return `'${s}`;
            if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
            return s;
        };
        const headers = [
            t("scan.csvHeaders.serialNumber"),
            t("scan.csvHeaders.scriptSummary"),
            t("scan.csvHeaders.identifiedPlatform"),
            t("scan.csvHeaders.suggestedAlternative"),
            t("scan.csvHeaders.riskScore"),
            t("scan.csvHeaders.majorRisk"),
            t("scan.csvHeaders.suggestedAction")
        ];
        const rows = replacementChecklistItems.map((item, i) => {
            const repl = getReplacementSuggestion(item.result);
            const platforms = item.result.identifiedPlatforms.join("; ") || "-";
            const topRisk = item.result.risks[0]?.name || "-";
            const recs = item.result.recommendations.slice(0, 2).join("; ") || "-";
            return [i + 1, item.contentSummary, platforms, repl, item.result.riskScore, topRisk, recs].map(escapeCSV).join(",");
        });
        const csv = [headers.map(escapeCSV).join(","), ...rows].join("\n");
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const date = new Date().toISOString().split("T")[0];
        a.download = `additional-scripts-replacement-checklist-${date}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }, [replacementChecklistItems, t]);
    const handleManualInputComplete = useCallback(async (data: ManualInputData) => {
        if (!shop) {
            showError(t("scan.errors.shopNotFound"));
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
                    displayName: t("scan.manualInput.displayName", { name: platform }),
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
                    tracking: "web_pixel",
                };
                assets.push({
                    sourceType: data.fromUpgradeWizard ? "merchant_confirmed" : "manual_paste" as const,
                    category: categoryMap[feature] || "other",
                    displayName: t("scan.manualInput.displayName", { name: feature }),
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
                showSuccess(t("scan.success.assetsCreated", { count: assets.length }));
            } else {
                showError(t("scan.errors.selectPlatform"));
            }
        } catch (error) {
            const { debugError } = await import("../utils/debug-log.client");
            debugError("Failed to process manual input", error);
            showError(t("scan.errors.processFailed"));
        }
    }, [shop, showSuccess, showError, submit, t]);
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
    const isProcessingPaste = isSavingAnalysis;
    useEffect(() => {
        const result = isFetcherResult(saveAnalysisFetcher.data) ? saveAnalysisFetcher.data : undefined;
        if (!result || saveAnalysisFetcher.state !== "idle" || !isMountedRef.current) return;
        if (result.success) {
            if (!analysisSavedRef.current) {
                analysisSavedRef.current = true;
            }
            setAnalysisSaved(true);
            setPasteProcessed(true);
            showSuccess(t("scan.success.analysisSaved"));
            reloadData();
        } else if (result.error) {
            analysisSavedRef.current = false;
            setAnalysisSaved(false);
            showError(t("scan.errors.saveFailed") + result.error);
        }
    }, [saveAnalysisFetcher.data, saveAnalysisFetcher.state, showSuccess, showError, t, reloadData]);
    useEffect(() => {
        if (analysisResult) {
            analysisSavedRef.current = false;
            setAnalysisSaved(false);
        }
    }, [analysisResult]);
    useEffect(() => {
        const deleteResult = isFetcherResult(deleteFetcher.data) ? deleteFetcher.data : undefined;
        if (!deleteResult || deleteFetcher.state !== "idle" || !isMountedRef.current) return;
        if (deleteResult.success) {
            showSuccess(deleteResult.message || t("scan.success.deleted"));
            setDeleteModalOpen(false);
            setPendingDelete(null);
            setDeleteError(null);
            reloadData();
        } else {
            let errorMessage = deleteResult.error || t("scan.errors.deleteFailed");
            if (deleteResult.details && typeof deleteResult.details === "object") {
                const details = deleteResult.details as { message?: string };
                if (details.message) {
                    errorMessage = details.message;
                }
            }
            setDeleteError(errorMessage);
            showError(errorMessage);
        }
    }, [deleteFetcher.data, deleteFetcher.state, showSuccess, showError, reloadData, t]);
    useEffect(() => {
        const upgradeResult = isFetcherResult(upgradeFetcher.data) ? upgradeFetcher.data : undefined;
        if (!upgradeResult || upgradeFetcher.state !== "idle" || !isMountedRef.current) return;
        if (upgradeResult.success) {
            showSuccess(upgradeResult.message || t("scan.success.upgraded"));
            reloadData();
        } else {
            let errorMessage = upgradeResult.error || t("scan.errors.upgradeFailed");
            if (upgradeResult.details && typeof upgradeResult.details === "object") {
                const details = upgradeResult.details as { message?: string };
                if (details.message) {
                    errorMessage = details.message;
                }
            }
            showError(errorMessage);
        }
    }, [upgradeFetcher.data, upgradeFetcher.state, showSuccess, showError, reloadData, t]);
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
    { id: "auto-scan", content: t("scan.tabs.auto") },
    { id: "manual-supplement", content: t("scan.tabs.manual") },
    { id: "migration-checklist", content: t("scan.tabs.checklist") },
  ];
  const visibleTabs = showTabs ? tabs : [];
  const shouldShowMigrationButtons = showMigrationButtons && (!showTabs || selectedTab === 2);
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
    const handleGenerateChecklistText = useCallback((format: "markdown" | "plain"): string => {
        return generateChecklistText(migrationActions, shop?.domain, format, t);
    }, [migrationActions, shop?.domain, t]);
    const handleExportCSV = useCallback(async () => {
        if (!latestScan) return;
        try {
            const response = await fetch(`/api/scan-report/csv?reportId=${encodeURIComponent(latestScan.id)}`);
            if (!response.ok) {
                let msg = t("scan.errors.exportFailed");
                try {
                    const errorData = await response.json();
                    msg = errorData.error || msg;
                } catch {
                    // JSON parse failed; use default error message
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
            showSuccess(t("scan.success.exportCSV"));
        } catch (error) {
            showError(t("scan.errors.exportFailed") + ": " + (error instanceof Error ? error.message : t("common.unknownError")));
        }
    }, [latestScan, showSuccess, showError, t]);
    const handleCopyChecklist = useCallback(async () => {
        if (isCopying) return;
        setIsCopying(true);
        try {
            const checklist = handleGenerateChecklistText("markdown");
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(checklist);
                showSuccess(t("scan.success.copied"));
            } else {
                showError(t("scan.errors.browserNotSupported"));
            }
        } catch (error) {
            const { debugError } = await import("../utils/debug-log.client");
            debugError("Copy failed:", error);
            showError(t("scan.errors.copyFailed"));
        } finally {
            setIsCopying(false);
        }
    }, [isCopying, handleGenerateChecklistText, showSuccess, showError, t]);
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
            const date = new Date().toISOString().split("T")[0];
            a.download = `migration-checklist-${date}.txt`;
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
                showError(t("scan.errors.createDownloadLinkFailed"));
                setIsExporting(false);
                return;
            }
            showSuccess(t("scan.success.exportChecklist"));
            setIsExporting(false);
        } catch (error) {
            import("../utils/debug-log.client").then(({ debugError }) => {
              debugError("Export failed:", error);
            });
            if (exportBlobUrlRef.current) {
                URL.revokeObjectURL(exportBlobUrlRef.current);
                exportBlobUrlRef.current = null;
            }
            showError(t("scan.errors.exportRetry"));
            setIsExporting(false);
        }
    }, [isExporting, handleGenerateChecklistText, showSuccess, showError, t]);
    const riskItems = useMemo(() => {
        return validateRiskItemsArray(latestScan?.riskItems);
    }, [latestScan?.riskItems]);
  return (<Page title={pageTitle || t("scan.pageTitle")} subtitle={pageSubtitle || t("scan.pageSubtitle")}>
    <BlockStack gap="500">
      <ScanPageBanners
        deprecationStatus={deprecationStatus}
        onShowUpgradeGuide={() => {
          setGuidanceContent({ title: t("scan.modals.guide.title"), platform: undefined, type: "upgrade_guide" });
          setGuidanceModalOpen(true);
        }}
        scannerMaxScriptTags={scannerMaxScriptTags}
        scannerMaxWebPixels={scannerMaxWebPixels}
        currentScriptTagCount={scriptTags.length}
        currentWebPixelCount={webPixelsCount}
        partialRefresh={!!showPartialRefresh}
        upgradeStatus={upgradeStatus}
        planId={planId}
        planLabel={planLabel}
        planTagline={planTagline}
        isGrowthOrAbove={isGrowthOrAbove}
        isProOrAbove={isProOrAbove}
        isAgency={isAgency}
      />
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
                shop={shop as any}
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
                onNavigate={navigate}
              />
            </Suspense>
          )}
          {selectedTab === 1 && (
            <Suspense fallback={<Card><BlockStack gap="400"><CardSkeleton lines={4} showTitle /></BlockStack></Card>}>
              <ScanManualSupplementTab
                shop={shop as any}
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
                    showSuccess(t("scan.success.assetsCreated", { count }));
                    reloadData();
                }}
                ScriptCodeEditor={ScriptCodeEditor}
                analysisSaved={analysisSaved}
                isSavingAnalysis={isSavingAnalysis}
                isProcessingPaste={isProcessingPaste}
                pasteProcessed={pasteProcessed}
                onSaveAnalysis={handleSaveAnalysis}
                onProcessManualPaste={handleProcessManualPaste}
                saveAnalysisFetcherData={saveAnalysisFetcher.data}
                processPasteFetcherData={saveAnalysisFetcher.data}
                replacementChecklistItems={replacementChecklistItems}
                onAddToReplacementChecklist={addToReplacementChecklist}
                onRemoveFromReplacementChecklist={removeFromReplacementChecklist}
                onExportReplacementChecklistCSV={exportReplacementChecklistCSV}
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
                onNavigate={navigate}
              />
            </Suspense>
          )}
        </Tabs>
        <ScanPageModals
          guidanceModalOpen={guidanceModalOpen}
          guidanceContent={guidanceContent}
          closeGuidanceModal={closeGuidanceModal}
          deleteModalOpen={deleteModalOpen}
          pendingDelete={pendingDelete}
          deleteError={deleteError}
          isDeleting={isDeleting}
          closeDeleteModal={closeDeleteModal}
          confirmDelete={confirmDelete}
          manualInputWizardOpen={manualInputWizardOpen}
          setManualInputWizardOpen={setManualInputWizardOpen}
          handleManualInputComplete={handleManualInputComplete}
          guidedSupplementOpen={guidedSupplementOpen}
          setGuidedSupplementOpen={setGuidedSupplementOpen}
          onGuidedSupplementComplete={(count) => {
            showSuccess(t("scan.success.assetsCreated", { count }));
            reloadData();
          }}
          shopId={shop?.id || ""}
          showSuccess={showSuccess}
        />
      </BlockStack>
    </Page>);
}

export default ScanPage;
