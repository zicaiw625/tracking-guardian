import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useFetcher, useActionData } from "@remix-run/react";
import { useState, useCallback, useMemo, useEffect } from "react";
import { Page, Layout, Card, Text, BlockStack, InlineStack, Badge, Button, Banner, Box, Divider, ProgressBar, Icon, DataTable, Link, Tabs, TextField, Modal, List, RangeSlider, } from "@shopify/polaris";
import { AlertCircleIcon, CheckCircleIcon, SearchIcon, ArrowRightIcon, ClipboardIcon, RefreshIcon, InfoIcon, ExportIcon, ShareIcon, SettingsIcon, } from "~/components/icons";
import { CardSkeleton, EnhancedEmptyState, useToastContext } from "~/components/ui";
import { AnalysisResultSummary } from "~/components/scan";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { scanShopTracking, getScanHistory, type ScriptAnalysisResult } from "../services/scanner.server";
import { analyzeScriptContent } from "../services/scanner/content-analysis";
import { refreshTypOspStatus } from "../services/checkout-profile.server";
import { generateMigrationActions } from "../services/scanner/migration-actions";
import { getExistingWebPixels } from "../services/migration.server";
import { createAuditAsset } from "../services/audit-asset.server";
import { getScriptTagDeprecationStatus, getAdditionalScriptsDeprecationStatus, getMigrationUrgencyStatus, getUpgradeStatusMessage, formatDeadlineForUI, type ShopTier, type ShopUpgradeStatus, } from "../utils/deprecation-dates";
import { SCANNER_CONFIG } from "../utils/config";
import type { ScriptTag, RiskItem } from "../types";
import type { MigrationAction, EnhancedScanResult } from "../services/scanner/types";
import { logger } from "../utils/logger.server";
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session, admin } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: {
            id: true,
            shopDomain: true,
            shopTier: true,
            typOspPagesEnabled: true,
            typOspUpdatedAt: true,
            typOspLastCheckedAt: true,
            typOspStatusReason: true,
        },
    });
    if (!shop) {
        return json({
            shop: null,
            latestScan: null,
            scanHistory: [],
            migrationActions: [] as MigrationAction[],
            deprecationStatus: null,
            upgradeStatus: null,
        });
    }
    const latestScanRaw = await prisma.scanReport.findFirst({
        where: { shopId: shop.id },
        orderBy: { createdAt: "desc" },
    });

    let migrationActions: MigrationAction[] = [];
    if (latestScanRaw) {
        try {
            // 类型安全的数据验证
            const rawData = latestScanRaw;
            
            // 验证 scriptTags 数组及其元素
            const scriptTags = Array.isArray(rawData.scriptTags) 
                ? rawData.scriptTags.filter((tag: unknown): tag is ScriptTag => {
                    if (typeof tag !== "object" || tag === null) return false;
                    const t = tag as Record<string, unknown>;
                    return (
                        typeof t.id === "number" &&
                        (typeof t.gid === "string" || t.gid === null || t.gid === undefined) &&
                        (typeof t.src === "string" || t.src === null || t.src === undefined) &&
                        typeof t.display_scope === "string"
                    );
                })
                : [];
            
            // 验证 identifiedPlatforms 数组
            const identifiedPlatforms = Array.isArray(rawData.identifiedPlatforms)
                ? rawData.identifiedPlatforms.filter((p: unknown): p is string => typeof p === "string")
                : [];
            
            // 验证 riskItems 数组及其元素
            const riskItems = Array.isArray(rawData.riskItems)
                ? rawData.riskItems.filter((item: unknown): item is RiskItem => {
                    if (typeof item !== "object" || item === null) return false;
                    const r = item as Record<string, unknown>;
                    return (
                        typeof r.id === "string" &&
                        typeof r.name === "string" &&
                        typeof r.description === "string" &&
                        (r.severity === "high" || r.severity === "medium" || r.severity === "low")
                    );
                })
                : [];
            
            // 验证 riskScore
            const riskScore = typeof rawData.riskScore === "number" && rawData.riskScore >= 0 && rawData.riskScore <= 100
                ? rawData.riskScore
                : 0;
            
            // 验证 additionalScriptsPatterns 数组
            const additionalScriptsPatterns = Array.isArray(rawData.additionalScriptsPatterns)
                ? rawData.additionalScriptsPatterns.filter((p: unknown): p is { platform: string; content: string } => {
                    if (typeof p !== "object" || p === null) return false;
                    const pattern = p as Record<string, unknown>;
                    return (
                        typeof pattern.platform === "string" &&
                        typeof pattern.content === "string"
                    );
                })
                : [];
            
            const scanData = {
                scriptTags,
                identifiedPlatforms,
                riskItems,
                riskScore,
                additionalScriptsPatterns,
            };

            const webPixels = await getExistingWebPixels(admin);
            const enhancedResult: EnhancedScanResult = {
                scriptTags: scanData.scriptTags,
                checkoutConfig: null,
                identifiedPlatforms: scanData.identifiedPlatforms,
                riskItems: scanData.riskItems,
                riskScore: scanData.riskScore,
                webPixels: webPixels.map(p => ({ id: p.id, settings: p.settings })),
                duplicatePixels: [],
                migrationActions: [],
                additionalScriptsPatterns: scanData.additionalScriptsPatterns,
            };
            const shopTier = (shop.shopTier as string) || "unknown";
            migrationActions = generateMigrationActions(enhancedResult, shopTier);
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : "Unknown error";
            logger.error("Failed to generate migration actions from scan data:", errorMessage, { shopId: shop.id });
            migrationActions = [];
        }
    }

    const latestScan = latestScanRaw;
    const scanHistory = await getScanHistory(shop.id, 5);
    const shopTier: ShopTier = (shop.shopTier as ShopTier) || "unknown";
    const scriptTags = (latestScan?.scriptTags as ScriptTag[] | null) || [];
    const hasScriptTags = scriptTags.length > 0;
    const hasOrderStatusScriptTags = scriptTags.some(tag => tag.display_scope === "order_status");
    const scriptTagStatus = getScriptTagDeprecationStatus();
    const additionalScriptsStatus = getAdditionalScriptsDeprecationStatus(shopTier);
    const migrationUrgency = getMigrationUrgencyStatus(shopTier, hasScriptTags, hasOrderStatusScriptTags);
    const sixHoursMs = 6 * 60 * 60 * 1000;
    const lastTypOspCheck = shop.typOspLastCheckedAt || shop.typOspUpdatedAt;
    const isTypOspStale = !lastTypOspCheck ||
        (Date.now() - lastTypOspCheck.getTime()) > sixHoursMs ||
        shop.typOspPagesEnabled === null;
    let typOspPagesEnabled = shop.typOspPagesEnabled;
    let typOspUpdatedAt = lastTypOspCheck;
    let typOspUnknownReason: string | undefined = shop.typOspStatusReason ?? undefined;
    let typOspUnknownError: string | undefined;
    if (admin && isTypOspStale) {
        try {
            const typOspResult = await refreshTypOspStatus(admin, shop.id);
            typOspPagesEnabled = typOspResult.typOspPagesEnabled;
            typOspUpdatedAt = typOspResult.checkedAt;
            if (typOspResult.status === "unknown") {
                typOspUnknownReason = typOspResult.unknownReason;
                typOspUnknownError = typOspResult.error;
            }
        }
        catch (error) {
            typOspUnknownReason = "API_ERROR";
            typOspUnknownError = error instanceof Error ? error.message : "Unknown error";
        }
    }
    const shopUpgradeStatus: ShopUpgradeStatus = {
        tier: shopTier,
        typOspPagesEnabled,
        typOspUpdatedAt,
        typOspUnknownReason,
        typOspUnknownError,
    };
    const upgradeStatusMessage = getUpgradeStatusMessage(shopUpgradeStatus, hasScriptTags);
    return json({
        shop: { id: shop.id, domain: shopDomain },
        latestScan,
        scanHistory,
        migrationActions,
        deprecationStatus: {
            shopTier,
            scriptTag: {
                ...formatDeadlineForUI(scriptTagStatus),
                isExpired: scriptTagStatus.isExpired,
            },
            additionalScripts: {
                ...formatDeadlineForUI(additionalScriptsStatus),
                isExpired: additionalScriptsStatus.isExpired,
            },
            migrationUrgency,
        },
        upgradeStatus: {
            ...upgradeStatusMessage,
            lastUpdated: typOspUpdatedAt?.toISOString() || null,
            hasOfficialSignal: typOspUpdatedAt !== null,
        },
    });
};
export const action = async ({ request }: ActionFunctionArgs) => {
    const { session, admin } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const shop = await prisma.shop.findUnique({
        where: { shopDomain },
    });
    if (!shop) {
        return json({ error: "Shop not found" }, { status: 404 });
    }
    const formData = await request.formData();
    const actionType = formData.get("_action");

    // 处理保存手动分析结果到 AuditAsset
    if (actionType === "save_analysis") {
        try {
            const analysisDataStr = formData.get("analysisData") as string;
            if (!analysisDataStr) {
                return json({ error: "缺少分析数据" }, { status: 400 });
            }
            
            // 验证和解析分析数据
            let parsedData: unknown;
            try {
                parsedData = JSON.parse(analysisDataStr);
            } catch (parseError) {
                logger.warn("Failed to parse analysis data JSON", { shopId: shop.id, error: parseError });
                return json({ error: "无法解析分析数据：无效的 JSON 格式" }, { status: 400 });
            }
            
            // 验证数据结构
            if (!parsedData || typeof parsedData !== "object") {
                return json({ error: "无效的分析数据格式：必须是对象" }, { status: 400 });
            }
            
            const data = parsedData as Record<string, unknown>;
            
            // 验证必需字段
            if (!Array.isArray(data.identifiedPlatforms)) {
                return json({ error: "无效的分析数据格式：identifiedPlatforms 必须是数组" }, { status: 400 });
            }
            
            if (typeof data.riskScore !== "number" || data.riskScore < 0 || data.riskScore > 100) {
                return json({ error: "无效的分析数据格式：riskScore 必须是 0-100 之间的数字" }, { status: 400 });
            }
            
            if (!Array.isArray(data.platformDetails)) {
                return json({ error: "无效的分析数据格式：platformDetails 必须是数组" }, { status: 400 });
            }
            
            if (!Array.isArray(data.risks)) {
                return json({ error: "无效的分析数据格式：risks 必须是数组" }, { status: 400 });
            }
            
            // 验证 identifiedPlatforms 中的元素都是字符串
            if (!data.identifiedPlatforms.every((p: unknown) => typeof p === "string")) {
                return json({ error: "无效的分析数据格式：identifiedPlatforms 中的元素必须是字符串" }, { status: 400 });
            }
            
            // 限制数组长度，防止恶意数据
            const MAX_PLATFORMS = 50;
            const MAX_PLATFORM_DETAILS = 200;
            const MAX_RISKS = 100;
            
            if (data.identifiedPlatforms.length > MAX_PLATFORMS) {
                return json({ error: `identifiedPlatforms 数组过长（最多 ${MAX_PLATFORMS} 个）` }, { status: 400 });
            }
            
            if (data.platformDetails.length > MAX_PLATFORM_DETAILS) {
                return json({ error: `platformDetails 数组过长（最多 ${MAX_PLATFORM_DETAILS} 个）` }, { status: 400 });
            }
            
            if (data.risks.length > MAX_RISKS) {
                return json({ error: `risks 数组过长（最多 ${MAX_RISKS} 个）` }, { status: 400 });
            }
            
            const analysisData = data as ScriptAnalysisResult;

            const createdAssets = [];
            // 为每个检测到的平台创建 AuditAsset
            for (const platform of analysisData.identifiedPlatforms) {
                // 验证平台名称
                if (typeof platform !== "string" || platform.length > 100) {
                    logger.warn(`Skipping invalid platform name: ${platform}`, { shopId: shop.id });
                    continue;
                }
                const asset = await createAuditAsset(shop.id, {
                    sourceType: "manual_paste",
                    category: "pixel",
                    platform,
                    displayName: `手动粘贴: ${platform}`,
                    riskLevel: "high",
                    suggestedMigration: "web_pixel",
                    details: {
                        source: "manual_paste",
                        analysisRiskScore: analysisData.riskScore,
                        detectedPatterns: analysisData.platformDetails
                            .filter(d => d.type === platform)
                            .map(d => d.matchedPattern),
                    },
                });
                if (asset) createdAssets.push(asset);
            }

            // 如果没有检测到平台但有风险，创建通用记录
            if (analysisData.identifiedPlatforms.length === 0 && analysisData.riskScore > 0) {
                const asset = await createAuditAsset(shop.id, {
                    sourceType: "manual_paste",
                    category: "other",
                    displayName: "未识别的脚本",
                    riskLevel: analysisData.riskScore > 60 ? "high" : "medium",
                    suggestedMigration: "none",
                    details: {
                        source: "manual_paste",
                        analysisRiskScore: analysisData.riskScore,
                        risks: analysisData.risks,
                    },
                });
                if (asset) createdAssets.push(asset);
            }

            return json({
                success: true,
                actionType: "save_analysis",
                savedCount: createdAssets.length,
                message: `已保存 ${createdAssets.length} 个审计资产记录`,
            });
        } catch (error) {
            logger.error("Save analysis error", error);
            return json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 500 });
        }
    }

    if (actionType && actionType !== "scan") {
        return json({ error: "不支持的操作类型" }, { status: 400 });
    }
    try {
        const scanResult = await scanShopTracking(admin, shop.id);
        return json({ 
            success: true, 
            actionType: "scan", 
            result: scanResult,
            partialRefresh: scanResult._partialRefresh || false,
        });
    }
    catch (error) {
        logger.error("Scan error", error);
        return json({ error: error instanceof Error ? error.message : "Scan failed" }, { status: 500 });
    }
};
export default function ScanPage() {
    const { shop, latestScan, scanHistory, deprecationStatus, upgradeStatus, migrationActions } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();
    const navigation = useNavigation();
    const deleteFetcher = useFetcher();
    const upgradeFetcher = useFetcher();
    const saveAnalysisFetcher = useFetcher();
    const { showSuccess, showError } = useToastContext();
    const [selectedTab, setSelectedTab] = useState(0);
    const [analysisSaved, setAnalysisSaved] = useState(false);
    const [scriptContent, setScriptContent] = useState("");
    const [analysisResult, setAnalysisResult] = useState<ScriptAnalysisResult | null>(null);
    const [analysisError, setAnalysisError] = useState<string | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [guidanceModalOpen, setGuidanceModalOpen] = useState(false);
    const [guidanceContent, setGuidanceContent] = useState<{ title: string; platform?: string; scriptTagId?: number } | null>(null);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<{ type: "webPixel"; id: string; gid: string; title: string } | null>(null);
    const [monthlyOrders, setMonthlyOrders] = useState(500);
    const isScanning = navigation.state === "submitting";

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
        </BlockStack>
      </Banner>
    );

    const identifiedPlatforms = (latestScan?.identifiedPlatforms as string[] | null) || [];

    const roiEstimate = useMemo(() => {
        const platforms = identifiedPlatforms.length || 1;
        const scriptTagCount = ((latestScan?.scriptTags as ScriptTag[] | null) || []).length;

        const eventsLostPerMonth = monthlyOrders * platforms;

        const hasRisk = scriptTagCount > 0;

        return {
            eventsLostPerMonth,
            hasRisk,
            platforms,
            scriptTagCount,
        };
    }, [monthlyOrders, identifiedPlatforms, latestScan]);
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
        setDeleteModalOpen(true);
    }, []);

    const confirmDelete = useCallback(() => {
        if (!pendingDelete) return;

        const formData = new FormData();
        formData.append("webPixelGid", pendingDelete.gid);
        deleteFetcher.submit(formData, {
            method: "post",
            action: "/app/actions/delete-web-pixel",
        });
        setDeleteModalOpen(false);
        setPendingDelete(null);
    }, [pendingDelete, deleteFetcher]);

    const closeDeleteModal = useCallback(() => {
        setDeleteModalOpen(false);
        setPendingDelete(null);
    }, []);

    const handleUpgradePixelSettings = useCallback(() => {
        const formData = new FormData();

        upgradeFetcher.submit(formData, {
            method: "post",
            action: "/app/actions/upgrade-web-pixel",
        });
    }, [upgradeFetcher]);

    const handleScan = () => {
        const formData = new FormData();
        formData.append("_action", "scan");
        submit(formData, { method: "post" });
    };
    const handleAnalyzeScript = useCallback(() => {
        // 输入验证
        const MAX_CONTENT_LENGTH = 500000; // 500KB 限制
        const trimmedContent = scriptContent.trim();
        
        if (!trimmedContent) {
            setAnalysisError("请输入脚本内容");
            setIsAnalyzing(false);
            return;
        }
        
        if (trimmedContent.length > MAX_CONTENT_LENGTH) {
            setAnalysisError(`脚本内容过长（最多 ${MAX_CONTENT_LENGTH} 个字符）。请分段分析或联系支持。`);
            setIsAnalyzing(false);
            return;
        }
        
        setIsAnalyzing(true);
        setAnalysisSaved(false); // 重置保存状态
        setAnalysisError(null);
        
        try {
            const result = analyzeScriptContent(trimmedContent);
            setAnalysisResult(result);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "分析失败，请稍后重试";
            setAnalysisError(errorMessage);
            logger.error("Script analysis error", { error: errorMessage });
        } finally {
            setIsAnalyzing(false);
        }
    }, [scriptContent]);

    const handleSaveAnalysis = useCallback(() => {
        if (!analysisResult) return;
        const formData = new FormData();
        formData.append("_action", "save_analysis");
        formData.append("analysisData", JSON.stringify(analysisResult));
        saveAnalysisFetcher.submit(formData, { method: "post" });
    }, [analysisResult, saveAnalysisFetcher]);

    // 处理保存结果
    const saveAnalysisResult = saveAnalysisFetcher.data as { success?: boolean; message?: string; error?: string } | undefined;
    const isSavingAnalysis = saveAnalysisFetcher.state === "submitting";

    // 当保存成功时更新状态并显示Toast
    useEffect(() => {
        if (saveAnalysisResult) {
            if (saveAnalysisResult.success) {
                if (!analysisSaved) {
                    setAnalysisSaved(true);
                    showSuccess("分析结果已保存！");
                }
            } else if (saveAnalysisResult.error) {
                showError("保存失败：" + saveAnalysisResult.error);
            }
        }
    }, [saveAnalysisResult, analysisSaved, showSuccess, showError]);

    // 处理删除和升级操作的Toast
    useEffect(() => {
        const deleteResult = deleteFetcher.data as { success?: boolean; message?: string; error?: string } | undefined;
        if (deleteResult) {
            if (deleteResult.success) {
                showSuccess(deleteResult.message || "删除成功！");
            } else {
                showError(deleteResult.error || "删除失败");
            }
        }
    }, [deleteFetcher.data, showSuccess, showError]);

    useEffect(() => {
        const upgradeResult = upgradeFetcher.data as { success?: boolean; message?: string; error?: string } | undefined;
        if (upgradeResult) {
            if (upgradeResult.success) {
                showSuccess(upgradeResult.message || "升级成功！");
            } else {
                showError(upgradeResult.error || "升级失败");
            }
        }
    }, [upgradeFetcher.data, showSuccess, showError]);
  const tabs = [
    { id: "auto-scan", content: "自动扫描" },
    { id: "manual-analyze", content: "手动分析" },
  ];
  const paginationLimitWarning = (
    <Banner tone="info" title="扫描分页说明">
      <BlockStack gap="200">
        <Text as="p">
          Shopify API 结果是分页的。本扫描会自动迭代页面，但为了性能会在以下阈值停止并提示：
        </Text>
        <List type="bullet">
          <List.Item>ScriptTags 最多处理 {SCANNER_CONFIG.MAX_SCRIPT_TAGS.toLocaleString()} 条记录</List.Item>
          <List.Item>Web Pixel 最多处理 {SCANNER_CONFIG.MAX_WEB_PIXELS.toLocaleString()} 条记录</List.Item>
        </List>
        <Text as="p" tone="subdued">
          如果商店超过以上数量，请在「手动分析」中粘贴剩余脚本，或联系支持获取完整导出（当前上限可调整，请联系我们）。
        </Text>
      </BlockStack>
    </Banner>
  );
    const getSeverityBadge = (severity: string) => {
        switch (severity) {
            case "high":
                return <Badge tone="critical">高风险</Badge>;
            case "medium":
                return <Badge tone="warning">中风险</Badge>;
            case "low":
                return <Badge tone="info">低风险</Badge>;
            default:
                return <Badge>未知</Badge>;
        }
    };
    const getPlatformName = (platform: string) => {

        const names: Record<string, string> = {
            google: "GA4 (Measurement Protocol)",
            meta: "Meta (Facebook) Pixel",
            tiktok: "TikTok Pixel",
            bing: "Microsoft Ads (Bing) ⚠️",
            clarity: "Microsoft Clarity ⚠️",
            pinterest: "Pinterest Tag",
            snapchat: "Snapchat Pixel",
            twitter: "Twitter/X Pixel",
        };
        return names[platform] || platform;
    };
    const riskItems = (latestScan?.riskItems as RiskItem[] | null) || [];

  const getUpgradeBannerTone = (urgency: string): "critical" | "warning" | "info" | "success" => {
        switch (urgency) {
            case "critical": return "critical";
            case "high": return "warning";
            case "medium": return "warning";
            case "resolved": return "success";
            default: return "info";
        }
    };
  // 检查是否有部分刷新的警告
  const partialRefreshWarning = actionData && (actionData as { partialRefresh?: boolean }).partialRefresh ? (
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

  return (<Page title="追踪脚本扫描" subtitle="扫描店铺中的追踪脚本，识别迁移风险">
    <BlockStack gap="500">
      {additionalScriptsWarning}
      {paginationLimitWarning}
      {partialRefreshWarning}
      {upgradeStatus && (<Banner title={upgradeStatus.title} tone={getUpgradeBannerTone(upgradeStatus.urgency)}>
        <BlockStack gap="200">
          <Text as="p">{upgradeStatus.message}</Text>
              {upgradeStatus.actions.length > 0 && (<BlockStack gap="100">
                  {upgradeStatus.actions.map((action, idx) => (<Text key={idx} as="p" variant="bodySm">
                      • {action}
                    </Text>))}
                </BlockStack>)}
              {!upgradeStatus.hasOfficialSignal && (<Text as="p" variant="bodySm" tone="subdued">
                  提示：我们尚未完成一次有效的升级状态检测。请稍后重试、重新授权应用，或等待后台定时任务自动刷新。
                </Text>)}
              {upgradeStatus.lastUpdated && !isNaN(new Date(upgradeStatus.lastUpdated).getTime()) && (<Text as="p" variant="bodySm" tone="subdued">
                  状态更新时间: {new Date(upgradeStatus.lastUpdated).toLocaleString("zh-CN")}
                </Text>)}
            </BlockStack>
          </Banner>)}

        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
          {selectedTab === 0 && (<BlockStack gap="500">
              <Box paddingBlockStart="400">
                <InlineStack align="space-between">
                  {}
                  {latestScan && (
                    <InlineStack gap="200">
                      <Button
                        icon={ExportIcon}
                        onClick={() => window.open("/api/exports?type=scan&format=json&include_meta=true", "_blank")}
                      >
                        导出报告
                      </Button>
                      <Button
                        icon={ShareIcon}
                        onClick={() => {
                          const shareData = {
                            title: "追踪脚本扫描报告",
                            text: `店铺追踪扫描报告\n风险评分: ${latestScan.riskScore}/100\n检测平台: ${identifiedPlatforms.join(", ") || "无"}\n扫描时间: ${new Date(latestScan.createdAt).toLocaleString("zh-CN")}`,
                          };
                          if (navigator.share) {
                            navigator.share(shareData);
                          } else {
                            navigator.clipboard.writeText(shareData.text);
                            showSuccess("报告摘要已复制到剪贴板");
                          }
                        }}
                      >
                        分享摘要
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
                    url: "https://help.shopify.com/en/manual/checkout-settings/customize-checkout-configurations/upgrade-thank-you-order-status",
                  }}
                />
              )}

        {latestScan && !isScanning && (<Layout>
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    风险评分
                  </Text>
                  <Box background={latestScan.riskScore > 60
                    ? "bg-fill-critical"
                    : latestScan.riskScore > 30
                        ? "bg-fill-warning"
                        : "bg-fill-success"} padding="600" borderRadius="200">
                    <BlockStack gap="200" align="center">
                      <Text as="p" variant="heading3xl" fontWeight="bold">
                        {latestScan.riskScore}
                      </Text>
                      <Text as="p" variant="bodySm">
                        / 100
                      </Text>
                    </BlockStack>
                  </Box>
                  <Text as="p" variant="bodySm" tone="subdued">
                    扫描时间:{" "}
                    {new Date(latestScan.createdAt).toLocaleString("zh-CN")}
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    检测到的平台
                  </Text>
                  {identifiedPlatforms.length > 0 ? (<BlockStack gap="200">
                      {identifiedPlatforms.map((platform) => (<InlineStack key={platform} gap="200" align="start">
                          <Icon source={CheckCircleIcon} tone="success"/>
                          <Text as="span">{getPlatformName(platform)}</Text>
                        </InlineStack>))}
                    </BlockStack>) : (<Text as="p" tone="subdued">
                      未检测到追踪平台
                    </Text>)}
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      ScriptTags
                    </Text>
                    {deprecationStatus?.scriptTag && (<Badge tone={deprecationStatus.scriptTag.isExpired ? "critical" : "warning"}>
                        {deprecationStatus.scriptTag.badge.text}
                      </Badge>)}
                  </InlineStack>
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span">已安装数量</Text>
                      <Text as="span" fontWeight="semibold">
                        {((latestScan.scriptTags as ScriptTag[] | null) || []).length}
                      </Text>
                    </InlineStack>
                    {((latestScan.scriptTags as ScriptTag[] | null) || []).length > 0 && deprecationStatus?.scriptTag && (<Banner tone={deprecationStatus.scriptTag.isExpired ? "critical" : "warning"}>
                        <p>{deprecationStatus.scriptTag.description}</p>
                      </Banner>)}
                  </BlockStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>)}

        {}
        {latestScan && !isScanning && latestScan.riskScore > 0 && (<Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  📊 迁移影响分析（仅供参考）
                </Text>
                <Badge tone="info">示例估算</Badge>
              </InlineStack>

              <Banner tone="warning">
                <Text as="p" variant="bodySm">
                  <strong>⚠️ 免责声明：</strong>以下为简化示意，仅帮助理解迁移的必要性。
                  实际业务影响因店铺业务模式、流量来源、客户群体、广告账户设置等多种因素而异，
                  本工具无法预测具体数值影响，不构成任何效果保证或承诺。
                </Text>
              </Banner>

              {}
              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <BlockStack gap="300">
                  <Text as="p" fontWeight="semibold">
                    🧮 输入您的月订单量，查看具体影响
                  </Text>
                  <RangeSlider
                    label="月订单量"
                    value={monthlyOrders}
                    onChange={(value) => setMonthlyOrders(value as number)}
                    output
                    min={100}
                    max={10000}
                    step={100}
                    suffix={<Text as="span" variant="bodySm">{monthlyOrders} 单/月</Text>}
                  />
                </BlockStack>
              </Box>

              {}
              <Box background="bg-fill-critical-secondary" padding="400" borderRadius="200">
                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={AlertCircleIcon} tone="critical" />
                    <Text as="h3" variant="headingMd" tone="critical">
                      不迁移会丢失什么？（示意说明）
                    </Text>
                  </InlineStack>

                  {}
                  <InlineStack gap="400" align="space-between" wrap>
                    <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">可能受影响的事件</Text>
                        <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                          {roiEstimate.eventsLostPerMonth.toLocaleString()}
                        </Text>
                        <Text as="p" variant="bodySm" tone="critical">
                          {roiEstimate.platforms} 平台 × {monthlyOrders} 订单
                        </Text>
                      </BlockStack>
                    </Box>
                    <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">受影响 ScriptTag</Text>
                        <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                          {roiEstimate.scriptTagCount}
                        </Text>
                        <Text as="p" variant="bodySm" tone="critical">
                          将在截止日停止执行
                        </Text>
                      </BlockStack>
                    </Box>
                    <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">实际影响</Text>
                        <Text as="p" variant="headingLg" fontWeight="bold" tone="caution">
                          因店铺而异
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          取决于流量来源和客户群体
                        </Text>
                      </BlockStack>
                    </Box>
                  </InlineStack>

                  <BlockStack gap="200">
                    {identifiedPlatforms.length > 0 ? (
                      identifiedPlatforms.map((platform) => (
                        <Box key={platform} background="bg-surface" padding="300" borderRadius="100">
                          <InlineStack align="space-between" blockAlign="center">
                            <InlineStack gap="200">
                              <Badge tone="critical">将失效</Badge>
                              <Text as="span" fontWeight="semibold">{getPlatformName(platform)}</Text>
                            </InlineStack>
                            <Text as="span" variant="bodySm" tone="critical">
                              参考值（仅供估算）
                            </Text>
                          </InlineStack>
                        </Box>
                      ))
                    ) : (
                      <Text as="p" variant="bodySm">
                        当前 ScriptTag 中的追踪代码将在截止日期后全部失效
                      </Text>
                    )}
                  </BlockStack>

                  <Banner tone="warning">
                    <Text as="p" variant="bodySm">
                      <strong>⚠️ 重要提醒：</strong>
                      ScriptTag 在截止日期后将停止执行，导致其中的追踪代码失效。
                      实际对您业务的影响取决于流量来源、客户群体、广告策略等多种因素，
                      本工具无法预测具体金额影响。建议您结合自身业务情况评估迁移优先级。
                    </Text>
                  </Banner>
                </BlockStack>
              </Box>

              <Divider />

              {}
              <Box background="bg-fill-success-secondary" padding="400" borderRadius="200">
                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={CheckCircleIcon} tone="success" />
                    <Text as="h3" variant="headingMd" tone="success">
                      迁移后能恢复什么？（您的预期收益）
                    </Text>
                  </InlineStack>

                  {}
                  <InlineStack gap="400" align="space-between" wrap>
                    <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">每月恢复事件</Text>
                        <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                          {roiEstimate.eventsLostPerMonth.toLocaleString()}
                        </Text>
                        <Text as="p" variant="bodySm" tone="success">
                          转化追踪功能恢复
                        </Text>
                      </BlockStack>
                    </Box>
                    <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">潜在收益（示例）</Text>
                        <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                          确保追踪
                        </Text>
                        <Text as="p" variant="bodySm" tone="success">
                          避免数据中断
                        </Text>
                      </BlockStack>
                    </Box>
                    <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">服务端追踪</Text>
                        <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                          更可靠
                        </Text>
                        <Text as="p" variant="bodySm" tone="success">
                          CAPI 双重保障
                        </Text>
                      </BlockStack>
                    </Box>
                  </InlineStack>

                  <BlockStack gap="200">
                    {identifiedPlatforms.length > 0 ? (
                      identifiedPlatforms.map((platform) => (
                        <Box key={platform} background="bg-surface" padding="300" borderRadius="100">
                          <InlineStack align="space-between" blockAlign="center">
                            <InlineStack gap="200">
                              <Badge tone="success">✓ 恢复</Badge>
                              <Text as="span" fontWeight="semibold">{getPlatformName(platform)}</Text>
                            </InlineStack>
                            <Text as="span" variant="bodySm" tone="success">
                              每月 {monthlyOrders.toLocaleString()} 个转化事件 → 广告平台
                            </Text>
                          </InlineStack>
                        </Box>
                      ))
                    ) : (
                      <Text as="p" variant="bodySm">
                        所有追踪功能将通过 Web Pixel + 服务端 CAPI 恢复
                      </Text>
                    )}
                  </BlockStack>

                  <Banner tone="success">
                    <Text as="p" variant="bodySm">
                      <strong>✅ 迁移的核心价值：</strong>
                      迁移是一次性工作，完成后可确保转化追踪在 ScriptTag 废弃后继续正常工作。
                      服务端 CAPI 不受浏览器隐私设置和广告拦截器影响，是 Shopify 和各广告平台推荐的追踪方式。
                      实际追踪效果因店铺情况而异。
                    </Text>
                  </Banner>
                </BlockStack>
              </Box>

              <Divider />

              {}
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  迁移前后对比
                </Text>
                <InlineStack gap="400" align="space-between" wrap={false}>
                  <Box background="bg-surface-critical" padding="300" borderRadius="200" minWidth="200px">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">当前（不迁移）</Text>
                      <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                        {latestScan.riskScore > 60 ? "高风险" : latestScan.riskScore > 30 ? "中风险" : "低风险"}
                      </Text>
                      <Text as="p" variant="bodySm" tone="critical">
                        {((latestScan.scriptTags as ScriptTag[] | null) || []).length} 个 ScriptTag 将失效
                      </Text>
                    </BlockStack>
                  </Box>

                  <Box padding="300">
                    <Icon source={ArrowRightIcon} tone="subdued" />
                  </Box>

                  <Box background="bg-surface-success" padding="300" borderRadius="200" minWidth="200px">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">迁移后</Text>
                      <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                        功能恢复
                      </Text>
                      <Text as="p" variant="bodySm" tone="success">
                        Web Pixel + CAPI 双保险
                      </Text>
                    </BlockStack>
                  </Box>

                  <Box padding="300">
                    <Icon source={ArrowRightIcon} tone="subdued" />
                  </Box>

                  <Box background="bg-surface-success" padding="300" borderRadius="200" minWidth="200px">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">额外收益</Text>
                      <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                        更稳定
                      </Text>
                      <Text as="p" variant="bodySm" tone="success">
                        不受隐私限制影响
                      </Text>
                    </BlockStack>
                  </Box>
                </InlineStack>

                <Banner tone="info" title="服务端 CAPI 的技术优势">
                  <Text as="p" variant="bodySm">
                    ✅ 不受 iOS 14.5+ App Tracking Transparency 限制
                    <br />
                    ✅ 不受浏览器广告拦截器影响
                    <br />
                    ✅ 不受第三方 Cookie 弃用影响
                    <br />
                    ✅ Shopify Webhook 直接传递订单数据
                    <br />
                    <Text as="span" tone="subdued">
                      注：实际归因效果因广告账户设置、流量来源等因素而异
                    </Text>
                  </Text>
                </Banner>
              </BlockStack>

              <InlineStack align="end" gap="200">
                <Button url="/app/diagnostics">
                  查看追踪诊断
                </Button>
                <Button url="/app/migrate" variant="primary">
                  立即开始迁移
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>)}

        {latestScan && riskItems.length > 0 && !isScanning && (<Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                风险详情
              </Text>
              <BlockStack gap="300">
                {riskItems.map((item, index) => (<Box key={index} background="bg-surface-secondary" padding="400" borderRadius="200">
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
            </BlockStack>
          </Card>)}

        {}
        {latestScan && migrationActions && migrationActions.length > 0 && !isScanning && (<Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  迁移操作
                </Text>
                <Badge tone="attention">{`${migrationActions.length} 项待处理`}</Badge>
              </InlineStack>

              {/* Toast 通知已处理 deleteFetcher 和 upgradeFetcher 的结果 */}

              <BlockStack gap="300">
                {migrationActions.map((action, index) => (
                  <Box key={index} background="bg-surface-secondary" padding="400" borderRadius="200">
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
                        {}
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
                        {action.type === "enable_capi" && (
                          <Button
                            size="slim"
                            url="/app/settings"
                            icon={ArrowRightIcon}
                          >
                            配置 CAPI
                          </Button>
                        )}
                      </InlineStack>
                    </BlockStack>
                  </Box>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>)}

        {}
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

              {}
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  📦 Web Pixel 设置
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Web Pixel 是 Shopify 推荐的客户端追踪方式，替代传统 ScriptTag。
                </Text>
                <InlineStack gap="300" wrap>
                  <Button
                    url="https://admin.shopify.com/store/settings/customer_events"
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

              {}
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  🛒 Checkout Editor（Plus 专属）
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  如果您是 Shopify Plus 商家，可以使用 Checkout UI Extension 替代 Additional Scripts。
                </Text>
                <InlineStack gap="300" wrap>
                  <Button
                    url="https://admin.shopify.com/store/settings/checkout/editor"
                    external
                    icon={ShareIcon}
                  >
                    打开 Checkout Editor
                  </Button>
                  <Button
                    url="https://shopify.dev/docs/apps/checkout/thank-you-order-status"
                    external
                    icon={InfoIcon}
                  >
                    查看官方文档
                  </Button>
                </InlineStack>
              </BlockStack>

              <Divider />

              {}
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
                        migrationActions.slice(0, 5).map((action, i) => (
                          <List.Item key={i}>
                            {action.title}
                            {action.platform && ` (${getPlatformName(action.platform)})`}
                            {action.priority === "high" && " ⚠️"}
                          </List.Item>
                        ))
                      ) : (
                        <List.Item>暂无待处理项目 ✅</List.Item>
                      )}
                      {migrationActions && migrationActions.length > 5 && (
                        <List.Item>...还有 {migrationActions.length - 5} 项</List.Item>
                      )}
                    </List>

                    <InlineStack gap="200" align="end">
                      <Button
                        icon={ClipboardIcon}
                        onClick={() => {
                          const checklist = [
                            "# 迁移清单",
                            `店铺: ${shop?.domain || "未知"}`,
                            `生成时间: ${new Date().toLocaleString("zh-CN")}`,
                            "",
                            "## 待处理项目",
                            ...(migrationActions?.map((a, i) =>
                              `${i + 1}. [${a.priority === "high" ? "高" : a.priority === "medium" ? "中" : "低"}] ${a.title}${a.platform ? ` (${a.platform})` : ""}`
                            ) || ["无"]),
                            "",
                            "## 快速链接",
                            "- Pixels 管理: https://admin.shopify.com/store/settings/customer_events",
                            "- Checkout Editor: https://admin.shopify.com/store/settings/checkout/editor",
                            "- 应用迁移工具: /app/migrate",
                          ].join("\n");
                          navigator.clipboard.writeText(checklist);
                        }}
                      >
                        复制清单
                      </Button>
                      <Button
                        icon={ExportIcon}
                        onClick={() => {
                          const checklist = [
                            "迁移清单",
                            `店铺: ${shop?.domain || "未知"}`,
                            `生成时间: ${new Date().toLocaleString("zh-CN")}`,
                            "",
                            "待处理项目:",
                            ...(migrationActions?.map((a, i) =>
                              `${i + 1}. [${a.priority === "high" ? "高优先级" : a.priority === "medium" ? "中优先级" : "低优先级"}] ${a.title}${a.platform ? ` (${a.platform})` : ""}`
                            ) || ["无"]),
                          ].join("\n");
                          const blob = new Blob([checklist], { type: "text/plain" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `migration-checklist-${new Date().toISOString().split("T")[0]}.txt`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        导出清单
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Box>
              </BlockStack>

              <Divider />

              {}
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
                            <br />• checkout.liquid → Pixel + Extension
                          </Text>
                        </BlockStack>
                      </Box>
                      <Box minWidth="200px">
                        <BlockStack gap="100">
                          <Badge tone="warning">UI Extension 替代</Badge>
                          <Text as="p" variant="bodySm">
                            • Additional Scripts → Checkout UI
                            <br />• Order Status 脚本 → TYP Extension
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

        {scanHistory.length > 1 && (<Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                扫描历史
              </Text>
              <DataTable columnContentTypes={["text", "numeric", "text", "text"]} headings={["扫描时间", "风险分", "检测平台", "状态"]} rows={scanHistory.filter((scan): scan is NonNullable<typeof scan> => scan !== null).map((scan) => [
                    new Date(scan.createdAt).toLocaleString("zh-CN"),
                    String(scan.riskScore),
                    ((scan.identifiedPlatforms as string[]) || []).join(", ") || "-",
                    scan.status === "completed" ? "完成" : scan.status,
                ])}/>
            </BlockStack>
          </Card>)}

              {latestScan && latestScan.riskScore > 0 && (<Banner title="建议进行迁移" tone="warning" action={{ content: "前往迁移工具", url: "/app/migrate" }}>
                  <p>
                    检测到您的店铺存在需要迁移的追踪脚本。
                    建议使用我们的迁移工具将追踪代码更新为 Shopify Web Pixel 格式。
                  </p>
                </Banner>)}
            </BlockStack>)}

          {selectedTab === 1 && (<BlockStack gap="500">
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

                    <Banner tone="critical" title="Plus：2025-08-28 / 非 Plus：2026-08-26 将失效">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm">
                          这是 Thank you / Order status 页面迁移的硬性截止时间。提前粘贴 Additional Scripts 代码并完成迁移，可避免追踪中断。
                        </Text>
                        {deprecationStatus && (
                          <Text as="p" variant="bodySm" tone="subdued">
                            当前剩余：{deprecationStatus.additionalScripts.badge.text} — {deprecationStatus.additionalScripts.description}
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
                        <Text as="p" fontWeight="semibold">如何获取 Additional Scripts：</Text>
                        <Text as="p" variant="bodySm">
                          1. 前往 Shopify 后台 → 设置 → 结账
                          <br />2. 找到「订单状态页面」或「Additional Scripts」区域
                          <br />3. 复制其中的所有代码
                          <br />4. 粘贴到下方文本框中
                        </Text>
                      </BlockStack>
                    </Banner>

                    <TextField label="粘贴脚本内容" value={scriptContent} onChange={setScriptContent} multiline={8} autoComplete="off" placeholder={`<!-- 示例 -->
<script>
  gtag('event', 'purchase', {...});
  fbq('track', 'Purchase', {...});
</script>`} helpText="支持检测 Google、Meta、TikTok、Bing 等平台的追踪代码"/>

                    <InlineStack align="end">
                      <Button variant="primary" onClick={handleAnalyzeScript} loading={isAnalyzing} disabled={!scriptContent.trim()} icon={ClipboardIcon}>
                        分析脚本
                      </Button>
                    </InlineStack>
                    {analysisError && (
                      <Banner tone="critical">
                        <Text as="p" variant="bodySm">{analysisError}</Text>
                      </Banner>
                    )}
                  </BlockStack>
                </Card>
              </Box>

              {analysisResult && <AnalysisResultSummary analysisResult={analysisResult} />}

              {analysisResult && analysisResult.risks.length > 0 && (<Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">
                      风险详情
                    </Text>
                    <BlockStack gap="300">
                      {analysisResult.risks.map((risk, index) => (<Box key={index} background="bg-surface-secondary" padding="400" borderRadius="200">
                          <BlockStack gap="200">
                            <InlineStack align="space-between">
                              <InlineStack gap="200">
                                <Icon source={AlertCircleIcon} tone={risk.severity === "high"
                        ? "critical"
                        : risk.severity === "medium"
                            ? "warning"
                            : "info"}/>
                                <Text as="span" fontWeight="semibold">
                                  {risk.name}
                                </Text>
                              </InlineStack>
                              {getSeverityBadge(risk.severity)}
                            </InlineStack>
                            <Text as="p" tone="subdued">
                              {risk.description}
                            </Text>
                            {risk.details && (<Text as="p" variant="bodySm">
                                {risk.details}
                              </Text>)}
                          </BlockStack>
                        </Box>))}
                    </BlockStack>
                  </BlockStack>
                </Card>)}

              {analysisResult && analysisResult.recommendations.length > 0 && (<Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text as="h2" variant="headingMd">
                        迁移建议清单
                      </Text>
                      <Badge tone="info">人工分析结果</Badge>
                    </InlineStack>
                    <BlockStack gap="300">
                      {analysisResult.recommendations.map((rec, index) => {

                        const lines = rec.split('\n');
                        const titleLine = lines[0] || "";
                        const titleMatch = titleLine.match(/\*\*(.*?)\*\*/);
                        const title = titleMatch ? titleMatch[1] : titleLine.replace(/^[^\w\u4e00-\u9fa5]+/, '');
                        const details = lines.slice(1).map(l => l.trim()).filter(l => l.length > 0);

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
                </Card>)}

              {/* 保存分析结果到 AuditAsset */}
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

                    {saveAnalysisResult?.error && (
                      <Banner tone="critical">
                        <Text as="p">{saveAnalysisResult.error}</Text>
                      </Banner>
                    )}

                    {saveAnalysisResult?.success && (
                      <Banner tone="success">
                        <Text as="p">{saveAnalysisResult.message}</Text>
                      </Banner>
                    )}

                    <InlineStack gap="200" align="end">
                      <Button
                        onClick={handleSaveAnalysis}
                        loading={isSavingAnalysis}
                        disabled={analysisSaved || analysisResult.identifiedPlatforms.length === 0 && analysisResult.riskScore === 0}
                        icon={CheckCircleIcon}
                      >
                        {analysisSaved ? "已保存" : "保存到审计记录"}
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              )}
            </BlockStack>)}
        </Tabs>

        {}
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
                      <strong>配置 CAPI 凭证</strong>：在「设置」页面配置相应平台的服务端追踪凭证
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
                  <List.Item>等待 ScriptTag 自动过期（Plus 商家将于 2025-08-28 停止执行，非 Plus 商家将于 2026-08-26 停止执行）</List.Item>
                </List>
              </BlockStack>

              {guidanceContent?.platform && (
                <>
                  <Divider />
                  <Banner tone="success">
                    <Text as="p" variant="bodySm">
                      💡 安装 Tracking Guardian 的 Web Pixel 后，旧的 {guidanceContent.platform} ScriptTag 可以安全删除，
                      因为服务端 CAPI 将接管所有转化追踪功能。
                    </Text>
                  </Banner>
                </>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>

        {}
        <Modal
          open={deleteModalOpen}
          onClose={closeDeleteModal}
          title="确认删除"
          primaryAction={{
            content: "确认删除",
            destructive: true,
            onAction: confirmDelete,
            loading: isDeleting,
          }}
          secondaryActions={[
            {
              content: "取消",
              onAction: closeDeleteModal,
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              <Text as="p">
                您确定要删除 <strong>{pendingDelete?.title}</strong> 吗？
              </Text>
              <Banner tone="warning">
                <Text as="p" variant="bodySm">
                  此操作不可撤销。删除后，相关追踪功能将立即停止。
                  请确保您已通过其他方式配置了替代追踪方案。
                </Text>
              </Banner>
            </BlockStack>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>);
}
