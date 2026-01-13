import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useFetcher, useActionData } from "@remix-run/react";
import { useState, useCallback, useMemo, useEffect, useRef, lazy, Suspense } from "react";
import { Page, Layout, Card, Text, BlockStack, InlineStack, Badge, Button, Banner, Box, Divider, ProgressBar, Icon, DataTable, Link, Tabs, TextField, Modal, List, RangeSlider, } from "@shopify/polaris";
import { AlertCircleIcon, CheckCircleIcon, SearchIcon, ArrowRightIcon, ClipboardIcon, RefreshIcon, InfoIcon, ExportIcon, ShareIcon, SettingsIcon, ClockIcon, } from "~/components/icons";
import { CardSkeleton, EnhancedEmptyState, useToastContext } from "~/components/ui";
import { AnalysisResultSummary } from "~/components/scan";
import { MigrationDependencyGraph } from "~/components/scan/MigrationDependencyGraph";
import { AuditAssetsByRisk } from "~/components/scan/AuditAssetsByRisk";
import { analyzeDependencies } from "~/services/dependency-analysis.server";
import { ManualInputWizard, type ManualInputData } from "~/components/scan/ManualInputWizard";
import { MigrationChecklistEnhanced } from "~/components/scan/MigrationChecklistEnhanced";
import { generateMigrationChecklist } from "~/services/migration-checklist.server";
import { ManualPastePanel } from "~/components/scan/ManualPastePanel";
import { GuidedSupplement } from "~/components/scan/GuidedSupplement";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { AuditPaywallCard } from "~/components/paywall/AuditPaywallCard";

const ScriptCodeEditor = lazy(() => import("~/components/scan/ScriptCodeEditor").then(module => ({ default: module.ScriptCodeEditor })));
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { scanShopTracking, getScanHistory, type ScriptAnalysisResult } from "../services/scanner.server";
import { analyzeScriptContent } from "../services/scanner/content-analysis";
import { calculateRiskScore } from "../services/scanner/risk-assessment";
import { refreshTypOspStatus } from "../services/checkout-profile.server";
import { generateMigrationActions } from "../services/scanner/migration-actions";
import { getExistingWebPixels } from "../services/migration.server";
import { createAuditAsset, batchCreateAuditAssets, getAuditAssets, type AuditAssetInput } from "../services/audit-asset.server";
import { processManualPasteAssets, analyzeManualPaste } from "../services/audit-asset-analysis.server";
import { getScriptTagDeprecationStatus, getAdditionalScriptsDeprecationStatus, getMigrationUrgencyStatus, getUpgradeStatusMessage, formatDeadlineForUI, getDateDisplayLabel, DEPRECATION_DATES, type ShopTier, type ShopUpgradeStatus, } from "../utils/deprecation-dates";
import { getPlanDefinition, normalizePlan, isPlanAtLeast } from "../utils/plans";
import { generateMigrationTimeline, getMigrationProgress } from "../services/migration-priority.server";
import { SCANNER_CONFIG, SCRIPT_ANALYSIS_CONFIG } from "../utils/config";
import type { ScriptTag, RiskItem } from "../types";
import type { MigrationAction, EnhancedScanResult } from "../services/scanner/types";
import { logger } from "../utils/logger.server";
import {
    validateScriptTagsArray,
    validateRiskItemsArray,
    validateStringArray,
    validateRiskScore,
    safeParseDate,
    safeFormatDate,
} from "../utils/scan-data-validation";
import { containsSensitiveInfo, sanitizeSensitiveInfo } from "../utils/security";
import { safeFireAndForget } from "../utils/helpers";

const TIMEOUTS = {
    IDLE_CALLBACK: 100,
    SET_TIMEOUT_FALLBACK: 10,
    EXPORT_CLEANUP: 100,
} as const;

const SAVE_ANALYSIS_LIMITS = {
    MAX_INPUT_SIZE: 1024 * 1024,
    MAX_PLATFORMS: 50,
    MAX_PLATFORM_DETAILS: 200,
    MAX_RISKS: 100,
    MAX_RECOMMENDATIONS: 100,
    MAX_RECOMMENDATION_LENGTH: 500,
    MAX_PLATFORM_NAME_LENGTH: 100,
    MAX_PATTERN_LENGTH: 50,
    MAX_DETECTED_PATTERNS: 20,
    MAX_RISKS_IN_DETAILS: 50,
    MIN_PLATFORM_NAME_LENGTH: 1,
    MIN_RISK_SCORE: 0,
    MAX_RISK_SCORE: 100,
} as const;

const PLATFORM_NAME_REGEX = /^[a-z0-9_]+$/;

type FetcherResult = {
    success?: boolean;
    message?: string;
    error?: string;
    details?: {
        message?: string;
        [key: string]: unknown;
    };
};

function isFetcherResult(data: unknown): data is FetcherResult {
    return (
        typeof data === "object" &&
        data !== null &&
        ("success" in data || "error" in data || "message" in data)
    );
}

function parseDateSafely(dateValue: unknown): Date | null {
    if (!dateValue) return null;
    try {
        const parsed = new Date(dateValue as string);
        return !isNaN(parsed.getTime()) ? parsed : null;
    } catch {
        return null;
    }
}

type IdleCallbackHandle = ReturnType<typeof requestIdleCallback>;

function cancelIdleCallbackOrTimeout(handle: number | IdleCallbackHandle | null): void {
    if (handle === null) return;
    if (typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        if (typeof handle === 'number') {
            clearTimeout(handle);
        } else {
            cancelIdleCallback(handle);
        }
    } else {
        clearTimeout(handle as number);
    }
}

function checkSensitiveInfoInData(obj: unknown, depth: number = 0): boolean {
    if (depth > 10) return false;
    if (typeof obj === "string") {
        return containsSensitiveInfo(obj);
    }
    if (Array.isArray(obj)) {
        return obj.some(item => checkSensitiveInfoInData(item, depth + 1));
    }
    if (obj && typeof obj === "object") {
        return Object.values(obj).some(value => checkSensitiveInfoInData(value, depth + 1));
    }
    return false;
}

function isValidShopTier(tier: unknown): tier is ShopTier {
    return typeof tier === "string" &&
           (tier === "plus" || tier === "non_plus" || tier === "unknown");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session, admin } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: {
            id: true,
            shopDomain: true,
            shopTier: true,
            plan: true,
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
            planId: "free" as const,
            planLabel: "免费版",
            planTagline: "扫描报告 + 基础建议",
            migrationTimeline: null,
            migrationProgress: null,
            dependencyGraph: null,
            auditAssets: [],
            migrationChecklist: null,
        });
    }
    const latestScanRaw = await prisma.scanReport.findFirst({
        where: { shopId: shop.id },
        orderBy: { createdAt: "desc" },
    });
    if (latestScanRaw?.status === "completed") {
                const planId = normalizePlan(shop.plan ?? "free");
        const isAgency = isPlanAtLeast(planId, "agency");
        const riskScore = latestScanRaw.riskScore ?? 0;
        const riskItems = validateRiskItemsArray(latestScanRaw.riskItems);
        const assetCount = riskItems.length;
        const { trackEvent } = await import("~/services/analytics.server");
        const { safeFireAndForget } = await import("~/utils/helpers");
        safeFireAndForget(
            trackEvent({
                shopId: shop.id,
                shopDomain: shop.shopDomain,
                event: "app_audit_completed",
                eventId: `app_audit_completed_${latestScanRaw.id}`,
                metadata: {
                    scanReportId: latestScanRaw.id,
                                        plan: shop.plan ?? "free",
                    role: isAgency ? "agency" : "merchant",
                    risk_score: riskScore,
                    asset_count: assetCount,
                                    },
            })
        );
    }
    const shopTier: ShopTier = (shop.shopTier !== null && shop.shopTier !== undefined && isValidShopTier(shop.shopTier))
        ? shop.shopTier
        : "unknown";
    let migrationActions: MigrationAction[] = [];
    if (latestScanRaw) {
        try {
            const rawData = latestScanRaw;
            const scriptTags = validateScriptTagsArray(rawData.scriptTags);
            const identifiedPlatforms = validateStringArray(rawData.identifiedPlatforms);
            const riskItems = validateRiskItemsArray(rawData.riskItems);
            const riskScore = validateRiskScore(rawData.riskScore);
            let webPixels: Array<{ id: string; settings: string | null }> = [];
            try {
                const pixels = await getExistingWebPixels(admin);
                if (Array.isArray(pixels)) {
                    webPixels = pixels
                        .filter((p): p is { id: string; settings: string | null } => {
                            if (p === null || p === undefined) {
                                return false;
                            }
                            if (typeof p !== "object" || Array.isArray(p)) {
                                return false;
                            }
                            if (!("id" in p)) {
                                return false;
                            }
                            const id = p.id;
                            if (typeof id !== "string" || id.trim() === "") {
                                return false;
                            }
                            return true;
                        })
                        .map(p => ({
                            id: p.id,
                            settings: (p.settings !== undefined && typeof p.settings === "string")
                                ? p.settings
                                : null
                        }));
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : "Unknown error";
                logger.warn("Failed to fetch web pixels during scan data processing", {
                    shopId: shop.id,
                    error: errorMessage
                });
                webPixels = [];
            }
            const enhancedResult: EnhancedScanResult = {
                scriptTags: Array.isArray(scriptTags) ? scriptTags : [],
                checkoutConfig: null,
                identifiedPlatforms: Array.isArray(identifiedPlatforms) ? identifiedPlatforms : [],
                riskItems: Array.isArray(riskItems) ? riskItems : [],
                riskScore: typeof riskScore === "number" && !isNaN(riskScore) ? riskScore : 0,
                webPixels,
                duplicatePixels: [],
                migrationActions: [],
                additionalScriptsPatterns: [],
                _additionalScriptsNote: "Additional Scripts 需要通过手动粘贴识别，Shopify API 无法自动读取 checkout.liquid 中的 Additional Scripts 内容",
            };
            migrationActions = generateMigrationActions(enhancedResult, shopTier);
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : "Unknown error";
            const errorType = e instanceof Error ? e.constructor.name : "Unknown";
            if (errorType === "TypeError" || errorMessage.includes("Cannot read")) {
                logger.error("Data format error in scan data processing", {
                    shopId: shop.id,
                    error: errorMessage,
                    errorType,
                    hasLatestScan: !!latestScanRaw,
                });
            } else {
                logger.error("Failed to generate migration actions from scan data", {
                    shopId: shop.id,
                    error: errorMessage,
                    errorType,
                });
            }
            migrationActions = [];
        }
    }
    const latestScan = latestScanRaw;
    let scanHistory: Awaited<ReturnType<typeof getScanHistory>> = [];
    try {
        scanHistory = await getScanHistory(shop.id, 5);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error("Failed to fetch scan history", {
            shopId: shop.id,
            error: errorMessage,
        });
        scanHistory = [];
    }
    const scriptTags: ScriptTag[] = latestScan
        ? validateScriptTagsArray(latestScan.scriptTags)
        : [];
    const hasScriptTags = scriptTags.length > 0;
    const hasOrderStatusScriptTags = scriptTags.some(tag => tag.display_scope === "order_status");
    const scriptTagStatus = getScriptTagDeprecationStatus();
    const additionalScriptsStatus = getAdditionalScriptsDeprecationStatus(shopTier);
    const migrationUrgency = getMigrationUrgencyStatus(shopTier, hasScriptTags, hasOrderStatusScriptTags);
    const sixHoursMs = 6 * 60 * 60 * 1000;
    const lastTypOspCheck = shop.typOspLastCheckedAt || shop.typOspUpdatedAt;
    const isTypOspStale = !lastTypOspCheck ||
        (lastTypOspCheck && (Date.now() - lastTypOspCheck.getTime()) > sixHoursMs) ||
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
    const planId = normalizePlan(shop.plan);
    const planDef = getPlanDefinition(planId);
    const [migrationTimeline, migrationProgress, dependencyGraph, auditAssets, migrationChecklist] = await Promise.all([
        generateMigrationTimeline(shop.id).catch((error) => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            logger.error("Failed to generate migration timeline", error instanceof Error ? error : new Error(String(error)), {
                shopId: shop.id,
                errorMessage,
                errorStack,
            });
            return null;
        }),
        getMigrationProgress(shop.id).catch((error) => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            logger.error("Failed to get migration progress", error instanceof Error ? error : new Error(String(error)), {
                shopId: shop.id,
                errorMessage,
                errorStack,
            });
            return null;
        }),
        analyzeDependencies(shop.id).catch((error) => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            logger.error("Failed to analyze dependencies", error instanceof Error ? error : new Error(String(error)), {
                shopId: shop.id,
                errorMessage,
                errorStack,
            });
            return null;
        }),
        getAuditAssets(shop.id, {
            migrationStatus: "pending",
        }).catch((error) => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            logger.error("Failed to fetch audit assets", error instanceof Error ? error : new Error(String(error)), {
                shopId: shop.id,
                errorMessage,
                errorStack,
            });
            return [];
        }),
        generateMigrationChecklist(shop.id).catch((error) => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            logger.error("Failed to generate migration checklist", error instanceof Error ? error : new Error(String(error)), {
                shopId: shop.id,
                errorMessage,
                errorStack,
            });
            return null;
        }),
    ]);
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
        planId,
        planLabel: planDef.name,
        planTagline: planDef.tagline,
        migrationTimeline,
        migrationProgress,
        dependencyGraph,
        auditAssets,
        migrationChecklist,
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
    if (actionType === "save_analysis") {
        try {
            const analysisDataStr = formData.get("analysisData") as string;
            if (!analysisDataStr) {
                return json({ error: "缺少分析数据" }, { status: 400 });
            }
            if (analysisDataStr.length > SAVE_ANALYSIS_LIMITS.MAX_INPUT_SIZE) {
                logger.warn("Analysis data too large", {
                    shopId: shop.id,
                    contentLength: analysisDataStr.length,
                    maxSize: SAVE_ANALYSIS_LIMITS.MAX_INPUT_SIZE
                });
                return json({
                    error: `分析数据过大（最大 ${SAVE_ANALYSIS_LIMITS.MAX_INPUT_SIZE / 1024}KB）`
                }, { status: 400 });
            }
            let parsedData: unknown;
            try {
                parsedData = JSON.parse(analysisDataStr);
            } catch (parseError) {
                logger.warn("Failed to parse analysis data JSON", {
                    shopId: shop.id,
                    error: parseError instanceof Error ? parseError.message : String(parseError),
                    actionType: "save_analysis"
                });
                return json({ error: "无法解析分析数据：无效的 JSON 格式" }, { status: 400 });
            }
            if (!parsedData || typeof parsedData !== "object") {
                return json({ error: "无效的分析数据格式：必须是对象" }, { status: 400 });
            }
            const data = parsedData as Record<string, unknown>;
            if (checkSensitiveInfoInData(parsedData)) {
                logger.warn("Analysis data contains potential sensitive information", {
                    shopId: shop.id,
                    contentLength: analysisDataStr.length,
                    actionType: "save_analysis"
                });
                return json({
                    error: "检测到可能包含敏感信息的内容（如 API keys、tokens、客户信息等）。请先脱敏后再保存。"
                }, { status: 400 });
            }
            if (!Array.isArray(data.identifiedPlatforms)) {
                return json({ error: "无效的分析数据格式：identifiedPlatforms 必须是数组" }, { status: 400 });
            }
            if (!Array.isArray(data.platformDetails)) {
                return json({ error: "无效的分析数据格式：platformDetails 必须是数组" }, { status: 400 });
            }
            if (!Array.isArray(data.risks)) {
                return json({ error: "无效的分析数据格式：risks 必须是数组" }, { status: 400 });
            }
            if (!Array.isArray(data.recommendations)) {
                return json({ error: "无效的分析数据格式：recommendations 必须是数组" }, { status: 400 });
            }
            if (data.identifiedPlatforms.length > SAVE_ANALYSIS_LIMITS.MAX_PLATFORMS) {
                return json({
                    error: `identifiedPlatforms 数组过长（最多 ${SAVE_ANALYSIS_LIMITS.MAX_PLATFORMS} 个）`
                }, { status: 400 });
            }
            if (data.platformDetails.length > SAVE_ANALYSIS_LIMITS.MAX_PLATFORM_DETAILS) {
                return json({
                    error: `platformDetails 数组过长（最多 ${SAVE_ANALYSIS_LIMITS.MAX_PLATFORM_DETAILS} 个）`
                }, { status: 400 });
            }
            if (data.risks.length > SAVE_ANALYSIS_LIMITS.MAX_RISKS) {
                return json({
                    error: `risks 数组过长（最多 ${SAVE_ANALYSIS_LIMITS.MAX_RISKS} 个）`
                }, { status: 400 });
            }
            if (data.recommendations.length > SAVE_ANALYSIS_LIMITS.MAX_RECOMMENDATIONS) {
                return json({
                    error: `recommendations 数组过长（最多 ${SAVE_ANALYSIS_LIMITS.MAX_RECOMMENDATIONS} 个）`
                }, { status: 400 });
            }
            if (
                typeof data.riskScore !== "number" ||
                !Number.isFinite(data.riskScore) ||
                !Number.isInteger(data.riskScore) ||
                data.riskScore < SAVE_ANALYSIS_LIMITS.MIN_RISK_SCORE ||
                data.riskScore > SAVE_ANALYSIS_LIMITS.MAX_RISK_SCORE
            ) {
                return json({
                    error: "无效的分析数据格式：riskScore 必须是 0-100 之间的整数"
                }, { status: 400 });
            }
            if (!data.identifiedPlatforms.every((p: unknown) => {
                return (
                    typeof p === "string" &&
                    p.length >= SAVE_ANALYSIS_LIMITS.MIN_PLATFORM_NAME_LENGTH &&
                    p.length <= SAVE_ANALYSIS_LIMITS.MAX_PLATFORM_NAME_LENGTH &&
                    PLATFORM_NAME_REGEX.test(p)
                );
            })) {
                return json({
                    error: `无效的分析数据格式：identifiedPlatforms 中的元素必须是有效的平台名称（小写字母、数字、下划线，${SAVE_ANALYSIS_LIMITS.MIN_PLATFORM_NAME_LENGTH}-${SAVE_ANALYSIS_LIMITS.MAX_PLATFORM_NAME_LENGTH}字符）`
                }, { status: 400 });
            }
            if (!data.platformDetails.every((p: unknown) => {
                if (typeof p !== "object" || p === null || Array.isArray(p)) return false;
                const detail = p as Record<string, unknown>;
                return (
                    typeof detail.platform === "string" &&
                    typeof detail.type === "string" &&
                    typeof detail.confidence === "string" &&
                    (detail.confidence === "high" || detail.confidence === "medium" || detail.confidence === "low") &&
                    typeof detail.matchedPattern === "string"
                );
            })) {
                return json({ error: "无效的分析数据格式：platformDetails 中的元素结构不正确" }, { status: 400 });
            }
            if (!data.risks.every((r: unknown) => {
                if (typeof r !== "object" || r === null || Array.isArray(r)) return false;
                const risk = r as Record<string, unknown>;
                return (
                    typeof risk.id === "string" &&
                    typeof risk.name === "string" &&
                    typeof risk.description === "string" &&
                    typeof risk.severity === "string" &&
                    (risk.severity === "high" || risk.severity === "medium" || risk.severity === "low")
                );
            })) {
                return json({ error: "无效的分析数据格式：risks 中的元素结构不正确" }, { status: 400 });
            }
            if (!data.recommendations.every((r: unknown) => {
                return (
                    typeof r === "string" &&
                    r.length > 0 &&
                    r.length <= SAVE_ANALYSIS_LIMITS.MAX_RECOMMENDATION_LENGTH
                );
            })) {
                return json({
                    error: `无效的分析数据格式：recommendations 中的元素必须是长度 1-${SAVE_ANALYSIS_LIMITS.MAX_RECOMMENDATION_LENGTH} 的字符串`
                }, { status: 400 });
            }
            const platformDetailsRaw = data.platformDetails;
            const sanitizedPlatformDetails = Array.isArray(platformDetailsRaw)
                ? platformDetailsRaw
                    .filter((detail): detail is {
                        platform: string;
                        type: string;
                        confidence: "high" | "medium" | "low";
                        matchedPattern: string;
                    } => {
                        if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
                            return false;
                        }
                        return (
                            typeof detail.platform === "string" &&
                            typeof detail.type === "string" &&
                            typeof detail.matchedPattern === "string" &&
                            (detail.confidence === "high" || detail.confidence === "medium" || detail.confidence === "low")
                        );
                    })
                    .map(detail => {
                        let pattern = detail.matchedPattern;
                        pattern = sanitizeSensitiveInfo(pattern);
                        if (containsSensitiveInfo(pattern)) {
                            pattern = "[REDACTED_PATTERN]";
                        }
                        if (pattern.length > SAVE_ANALYSIS_LIMITS.MAX_PATTERN_LENGTH) {
                            pattern = pattern.substring(0, SAVE_ANALYSIS_LIMITS.MAX_PATTERN_LENGTH) + "...";
                        }
                        return { ...detail, matchedPattern: pattern };
                    })
                : [];
            const identifiedPlatforms = Array.isArray(data.identifiedPlatforms)
                ? data.identifiedPlatforms.filter((p): p is string => typeof p === "string")
                : [];
            const risks = Array.isArray(data.risks)
                ? data.risks.filter((r): r is RiskItem => {
                    if (!r || typeof r !== "object" || Array.isArray(r)) {
                        return false;
                    }
                    return (
                        typeof r.id === "string" &&
                        typeof r.severity === "string" &&
                        typeof r.title === "string" &&
                        typeof r.description === "string"
                    );
                })
                : [];
            const riskScore = typeof data.riskScore === "number" && !isNaN(data.riskScore)
                ? Math.max(0, Math.min(100, data.riskScore))
                : 0;
            const recommendations = Array.isArray(data.recommendations)
                ? data.recommendations.filter((r): r is string => typeof r === "string")
                : [];
            const analysisData: ScriptAnalysisResult = {
                identifiedPlatforms,
                platformDetails: sanitizedPlatformDetails,
                risks,
                riskScore,
                recommendations,
            };
            const createdAssets = [];
            const failedAssets: string[] = [];
            for (const platform of analysisData.identifiedPlatforms) {
                const detectedPatterns = analysisData.platformDetails
                    .filter(d => d.platform === platform)
                    .slice(0, SAVE_ANALYSIS_LIMITS.MAX_DETECTED_PATTERNS)
                    .map(d => d.matchedPattern);
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
                        detectedPatterns,
                    },
                });
                if (asset) {
                    createdAssets.push(asset);
                } else {
                    failedAssets.push(platform);
                    logger.warn("Failed to create AuditAsset for platform", {
                        shopId: shop.id,
                        platform,
                        actionType: "save_analysis"
                    });
                }
            }
            if (analysisData.identifiedPlatforms.length === 0 && analysisData.riskScore > 0) {
                const risksForDetails = analysisData.risks.slice(0, SAVE_ANALYSIS_LIMITS.MAX_RISKS_IN_DETAILS);
                const asset = await createAuditAsset(shop.id, {
                    sourceType: "manual_paste",
                    category: "other",
                    displayName: "未识别的脚本",
                    riskLevel: analysisData.riskScore > 60 ? "high" : "medium",
                    suggestedMigration: "none",
                    details: {
                        source: "manual_paste",
                        analysisRiskScore: analysisData.riskScore,
                        risks: risksForDetails,
                    },
                });
                if (asset) {
                    createdAssets.push(asset);
                } else {
                    failedAssets.push("未识别的脚本");
                    logger.warn("Failed to create AuditAsset for unidentified script", {
                        shopId: shop.id,
                        actionType: "save_analysis"
                    });
                }
            }
            if (failedAssets.length > 0) {
                logger.warn("Some assets failed to create", {
                    shopId: shop.id,
                    failedCount: failedAssets.length,
                    failedPlatforms: failedAssets,
                    actionType: "save_analysis"
                });
            }
            return json({
                success: true,
                actionType: "save_analysis",
                savedCount: createdAssets.length,
                message: createdAssets.length > 0
                    ? `已保存 ${createdAssets.length} 个审计资产记录${failedAssets.length > 0 ? `，${failedAssets.length} 个失败` : ''}`
                    : "保存失败，请检查日志",
                ...(failedAssets.length > 0 && { warning: `${failedAssets.length} 个资产保存失败` })
            });
        } catch (error) {
            const randomBytes = new Uint8Array(4);
            globalThis.crypto.getRandomValues(randomBytes);
            const errorId = Array.from(randomBytes, byte => byte.toString(16).padStart(2, '0')).join('');
            logger.error("Save analysis error", {
                errorId,
                shopId: shop.id,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                actionType: "save_analysis"
            });
            return json({
                error: "保存失败，请稍后重试",
                errorId
            }, { status: 500 });
        }
    }
    if (actionType === "analyze_manual_paste" || actionType === "realtime_analyze_manual_paste") {
        try {
            const content = formData.get("content") as string;
            if (!content || !content.trim()) {
                return json({ error: "缺少脚本内容" }, { status: 400 });
            }
            const MAX_CONTENT_LENGTH = 1024 * 1024;
            if (content.length > MAX_CONTENT_LENGTH) {
                return json({
                    error: `脚本内容过长（最大 ${MAX_CONTENT_LENGTH / 1024}KB）`
                }, { status: 400 });
            }
            if (containsSensitiveInfo(content)) {
                return json({
                    error: "检测到可能包含敏感信息的内容（如 API keys、tokens、客户信息等）。请先脱敏后再分析。"
                }, { status: 400 });
            }
            if (actionType === "realtime_analyze_manual_paste") {
                const quickAnalysis = analyzeScriptContent(content);
                return json({
                    success: true,
                    actionType: "realtime_analyze_manual_paste",
                    realtimeAnalysis: {
                        identifiedPlatforms: quickAnalysis.identifiedPlatforms,
                        platformDetails: quickAnalysis.platformDetails,
                        risks: quickAnalysis.risks.slice(0, 5),
                        riskScore: quickAnalysis.riskScore,
                        recommendations: [],
                    },
                });
            }
            const analysis = analyzeManualPaste(content, shop.id);
            return json({
                success: true,
                actionType: "analyze_manual_paste",
                analysis,
            });
        } catch (error) {
            logger.error("Analyze manual paste error", {
                shopId: shop.id,
                error: error instanceof Error ? error.message : String(error),
            });
            return json({ error: "分析失败，请稍后重试" }, { status: 500 });
        }
    }
    if (actionType === "process_manual_paste") {
        try {
            const content = formData.get("content") as string;
            if (!content || !content.trim()) {
                return json({ error: "缺少脚本内容" }, { status: 400 });
            }
            const MAX_CONTENT_LENGTH = 1024 * 1024;
            if (content.length > MAX_CONTENT_LENGTH) {
                return json({
                    error: `脚本内容过长（最大 ${MAX_CONTENT_LENGTH / 1024}KB）`
                }, { status: 400 });
            }
            if (containsSensitiveInfo(content)) {
                return json({
                    error: "检测到可能包含敏感信息的内容（如 API keys、tokens、客户信息等）。请先脱敏后再处理。"
                }, { status: 400 });
            }
            const latestScan = await prisma.scanReport.findFirst({
                where: { shopId: shop.id },
                orderBy: { createdAt: "desc" },
                select: { id: true },
            });
            const result = await processManualPasteAssets(
                shop.id,
                content,
                latestScan?.id
            );
            return json({
                success: true,
                actionType: "process_manual_paste",
                processed: {
                    created: result.created,
                    updated: result.updated,
                    failed: result.failed,
                    duplicates: result.duplicates || 0,
                },
                message: `已处理 ${result.created} 个资产${result.updated > 0 ? `，更新 ${result.updated} 个` : ''}${result.failed > 0 ? `，${result.failed} 个失败` : ''}`,
            });
        } catch (error) {
            logger.error("Process manual paste error", {
                shopId: shop.id,
                error: error instanceof Error ? error.message : String(error),
            });
            return json({ error: "处理失败，请稍后重试" }, { status: 500 });
        }
    }
    if (actionType === "create_from_wizard") {
        try {
            const assetsStr = formData.get("assets") as string;
            if (!assetsStr) {
                return json({ error: "缺少资产数据" }, { status: 400 });
            }
            let assets: AuditAssetInput[];
            try {
                const parsed = JSON.parse(assetsStr);
                if (!Array.isArray(parsed) || parsed.length === 0) {
                    return json({ error: "资产数据必须是非空数组" }, { status: 400 });
                }
                assets = parsed as AuditAssetInput[];
            } catch {
                return json({ error: "无效的资产数据格式" }, { status: 400 });
            }
            const result = await batchCreateAuditAssets(shop.id, assets);
            return json({
                success: true,
                actionType: "create_from_wizard",
                message: `已创建 ${result.created} 个审计资产记录${result.updated > 0 ? `，更新 ${result.updated} 个` : ''}${result.failed > 0 ? `，${result.failed} 个失败` : ''}`,
                created: result.created,
                updated: result.updated,
                failed: result.failed,
            });
        } catch (error) {
            logger.error("Create from wizard error", {
                shopId: shop.id,
                error: error instanceof Error ? error.message : String(error),
            });
            return json({ error: "创建失败，请稍后重试" }, { status: 500 });
        }
    }
    if (actionType === "mark_asset_complete") {
        try {
            const assetId = formData.get("assetId") as string;
            if (!assetId) {
                return json({ error: "缺少资产 ID" }, { status: 400 });
            }
            const asset = await prisma.auditAsset.findUnique({
                where: { id: assetId },
                select: { shopId: true, migrationStatus: true },
            });
            if (!asset) {
                return json({ error: "资产不存在" }, { status: 404 });
            }
            if (asset.shopId !== shop.id) {
                return json({ error: "无权访问此资产" }, { status: 403 });
            }
            await prisma.auditAsset.update({
                where: { id: assetId },
                data: {
                    migrationStatus: "completed",
                    migratedAt: new Date(),
                },
            });
            return json({
                success: true,
                actionType: "mark_asset_complete",
                message: "已标记为已完成",
            });
        } catch (error) {
            logger.error("Mark asset complete error", {
                shopId: shop.id,
                error: error instanceof Error ? error.message : String(error),
            });
            return json({ error: "标记失败，请稍后重试" }, { status: 500 });
        }
    }
    if (actionType === "export_checklist_csv") {
        try {
            const checklist = await generateMigrationChecklist(shop.id);
            const formatEstimatedTime = (minutes: number) => {
                if (minutes < 60) {
                    return `${minutes} 分钟`;
                }
                const hours = Math.floor(minutes / 60);
                const mins = minutes % 60;
                return mins > 0 ? `${hours} 小时 ${mins} 分钟` : `${hours} 小时`;
            };
            const migrationTypeLabels: Record<string, string> = {
                web_pixel: "Web Pixel",
                ui_extension: "UI Extension Block",
                server_side: "Server-side CAPI",
                none: "External redirect / not supported",
            };
            const csvLines: string[] = [];
            csvLines.push("迁移清单");
            csvLines.push(`店铺: ${shopDomain}`);
            csvLines.push(`生成时间: ${new Date().toLocaleString("zh-CN")}`);
            csvLines.push(`待迁移项: ${checklist.totalItems}`);
            csvLines.push(`高风险项: ${checklist.highPriorityItems}`);
            csvLines.push(`中风险项: ${checklist.mediumPriorityItems}`);
            csvLines.push(`低风险项: ${checklist.lowPriorityItems}`);
            csvLines.push(`预计总时间: ${Math.floor(checklist.estimatedTotalTime / 60)} 小时 ${checklist.estimatedTotalTime % 60} 分钟`);
            csvLines.push("");
            csvLines.push("资产名称/指纹,风险等级+原因,推荐迁移路径,预估工时+需要的信息");
            checklist.items.forEach((item) => {
                const fingerprint = item.fingerprint ? `(${item.fingerprint.substring(0, 8)}...)` : "";
                const assetName = `${item.title} ${fingerprint}`.trim();
                const riskDisplay = `${item.riskLevel} - ${item.riskReason}`;
                const migrationPath = migrationTypeLabels[item.suggestedMigration] || item.suggestedMigration;
                const timeAndInfo = `${formatEstimatedTime(item.estimatedTime)} | ${item.requiredInfo}`;
                const row = [
                    assetName,
                    riskDisplay,
                    migrationPath,
                    timeAndInfo,
                ];
                csvLines.push(row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","));
            });
            const csvContent = csvLines.join("\n");
            const filename = `migration_checklist_${shopDomain}_${new Date().toISOString().split("T")[0]}.csv`;
            return new Response(csvContent, {
                status: 200,
                headers: {
                    "Content-Type": "text/csv; charset=utf-8",
                    "Content-Disposition": `attachment; filename="${filename}"`,
                },
            });
        } catch (error) {
            logger.error("Export checklist CSV error", {
                shopId: shop.id,
                error: error instanceof Error ? error.message : String(error),
            });
            return json({ error: "导出失败，请稍后重试" }, { status: 500 });
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

function getUpgradeBannerTone(
    urgency: "critical" | "high" | "medium" | "low" | "resolved"
): "critical" | "warning" | "info" | "success" {
    switch (urgency) {
        case "critical": return "critical";
        case "high": return "warning";
        case "medium": return "warning";
        case "resolved": return "success";
        case "low": return "info";
        default: {
            const _exhaustive: never = urgency;
            return "info";
        }
    }
}

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
    pageSubtitle = "迁移清单 + 风险分级 + 替代路径（Web Pixel / Checkout UI Extension / 不可迁移）• 明确提示 checkout.liquid / additional scripts / script tags 在 Thank you/Order status 的弃用与限制 • 可分享链接并导出 PDF/CSV",
    showMigrationButtons = false,
}: ScanPageProps) {
    const { shop, latestScan, scanHistory, deprecationStatus, upgradeStatus, migrationActions, planId, planLabel, planTagline, migrationTimeline, migrationProgress, dependencyGraph, auditAssets, migrationChecklist } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();
    const navigation = useNavigation();
    const deleteFetcher = useFetcher();
    const upgradeFetcher = useFetcher();
    const saveAnalysisFetcher = useFetcher();
    const processPasteFetcher = useFetcher();
    const { showSuccess, showError } = useToastContext();
    const [selectedTab, setSelectedTab] = useState(initialTab);
    const [analysisSaved, setAnalysisSaved] = useState(false);
    const [scriptContent, setScriptContent] = useState("");
    const [analysisResult, setAnalysisResult] = useState<ScriptAnalysisResult | null>(null);
    const [analysisError, setAnalysisError] = useState<string | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisProgress, setAnalysisProgress] = useState<{ current: number; total: number } | null>(null);
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
    const analysisSavedRef = useRef(false);
    const isReloadingRef = useRef(false);
    const isMountedRef = useRef(true);
    const paywallViewTrackedRef = useRef(false);
    const reloadTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const exportTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const idleCallbackHandlesRef = useRef<Array<number | IdleCallbackHandle>>([]);
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
                primaryAction: { content: "进入手动分析", url: "/app/audit/manual" },
                secondaryAction: { content: "查看报告", url: "/app/audit/report" },
            };
        }
        if (selectedTab === 2) {
            return {
                title: "Audit 迁移清单",
                description: "查看风险分级、推荐迁移路径与预估工时，作为迁移交付清单。",
                items: [
                    "清单支持 PDF/CSV 导出",
                    "标注 Web Pixel / UI Extension / Server-side 路径",
                    "优先处理高风险资产",
                ],
                primaryAction: { content: "查看完整报告", url: "/app/audit/report" },
                secondaryAction: { content: "返回扫描", url: "/app/audit/scan" },
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
            primaryAction: { content: "开始扫描", url: "/app/audit/scan" },
            secondaryAction: { content: "手动补充", url: "/app/audit/manual" },
        };
    }, [selectedTab]);
    useEffect(() => {
        setSelectedTab(initialTab);
    }, [initialTab]);
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
    const roiEstimate = {
        eventsLostPerMonth: Math.max(0, monthlyOrders) * Math.max(0, identifiedPlatformsCount),
        platforms: Math.max(0, identifiedPlatformsCount),
        scriptTagCount: Math.max(0, scriptTagsCount),
    };
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
    const handleAnalysisError = useCallback((error: unknown, contentLength: number) => {
        if (error instanceof Error && error.message === "Analysis cancelled") {
            if (isMountedRef.current) {
                setIsAnalyzing(false);
                setAnalysisError(null);
                setAnalysisResult(null);
                setAnalysisProgress(null);
                setAnalysisSaved(false);
                analysisSavedRef.current = false;
            }
            return;
        }
        let errorMessage: string;
        if (error instanceof TypeError) {
            errorMessage = "脚本格式错误，请检查输入内容";
        } else if (error instanceof RangeError) {
            errorMessage = "脚本内容过长，请分段分析";
        } else {
            errorMessage = error instanceof Error ? error.message : "分析失败，请稍后重试";
        }
        if (isMountedRef.current) {
            setAnalysisError(errorMessage);
            setAnalysisResult(null);
            setAnalysisSaved(false);
            analysisSavedRef.current = false;
        }
        if (process.env.NODE_ENV === "development") {
            console.error("Script analysis error", {
                error: errorMessage,
                errorType: error instanceof Error ? error.constructor.name : "Unknown",
                contentLength,
                hasContent: contentLength > 0,
            });
        }
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
    const handleAnalyzeScript = useCallback(async () => {
        if (isAnalyzing) return;
        const MAX_CONTENT_LENGTH = SCRIPT_ANALYSIS_CONFIG.MAX_CONTENT_LENGTH;
        const trimmedContent = scriptContent.trim();
        if (!trimmedContent) {
            setAnalysisError("请输入脚本内容");
            return;
        }
        if (trimmedContent.length > MAX_CONTENT_LENGTH) {
            setAnalysisError(`脚本内容过长（最多 ${MAX_CONTENT_LENGTH} 个字符）。请分段分析或联系支持。`);
            return;
        }
        if (containsSensitiveInfo(trimmedContent)) {
            setAnalysisError("检测到可能包含敏感信息的内容（如 API keys、tokens、客户信息等）。请先脱敏后再分析。");
            return;
        }
        setIsAnalyzing(true);
        setAnalysisSaved(false);
        analysisSavedRef.current = false;
        setAnalysisError(null);
        setAnalysisProgress(null);
        try {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            abortControllerRef.current = new AbortController();
            const signal = abortControllerRef.current.signal;
            const CHUNK_SIZE = SCRIPT_ANALYSIS_CONFIG.CHUNK_SIZE;
            const isLargeContent = trimmedContent.length > CHUNK_SIZE;
            let result: ScriptAnalysisResult;
            if (isLargeContent) {
                result = {
                    identifiedPlatforms: [],
                    platformDetails: [],
                    risks: [],
                    riskScore: 0,
                    recommendations: [],
                };
                const platformDetailsMap = new Map<string, typeof result.platformDetails[0]>();
                const risksMap = new Map<string, typeof result.risks[0]>();
                const recommendationsSet = new Set<string>();
                const platformsSet = new Set<string>();
                const totalChunks = Math.ceil(trimmedContent.length / CHUNK_SIZE);
                for (let i = 0; i < totalChunks; i++) {
                    if (signal.aborted || !isMountedRef.current) {
                        if (isMountedRef.current) {
                            setIsAnalyzing(false);
                            setAnalysisError(null);
                            setAnalysisProgress(null);
                        }
                        return;
                    }
                    if (isMountedRef.current) {
                        setAnalysisProgress({ current: i + 1, total: totalChunks });
                    }
                    await new Promise<void>((resolve) => {
                        const processChunk = () => {
                            if (signal.aborted || !isMountedRef.current) {
                                if (isMountedRef.current) {
                                    setIsAnalyzing(false);
                                    setAnalysisError(null);
                                    setAnalysisProgress(null);
                                }
                                resolve();
                                return;
                            }
                            try {
                                const start = i * CHUNK_SIZE;
                                const end = Math.min(start + CHUNK_SIZE, trimmedContent.length);
                                const chunk = trimmedContent.slice(start, end);
                                let chunkResult: ScriptAnalysisResult;
                                try {
                                    chunkResult = analyzeScriptContent(chunk);
                                } catch (syncError) {
                                    if (process.env.NODE_ENV === "development") {
                                        console.warn(`Chunk ${i} synchronous analysis failed:`, syncError);
                                    }
                                    resolve();
                                    return;
                                }
                                for (const platform of chunkResult.identifiedPlatforms) {
                                    platformsSet.add(platform);
                                }
                                for (const detail of chunkResult.platformDetails) {
                                    const key = `${detail.platform}-${detail.type}-${detail.matchedPattern}`;
                                    if (!platformDetailsMap.has(key)) {
                                        platformDetailsMap.set(key, detail);
                                    }
                                }
                                for (const risk of chunkResult.risks) {
                                    if (!risksMap.has(risk.id)) {
                                        risksMap.set(risk.id, risk);
                                    }
                                }
                                for (const rec of chunkResult.recommendations) {
                                    recommendationsSet.add(rec);
                                }
                                resolve();
                            } catch (error) {
                                if (process.env.NODE_ENV === "development") {
                                    console.warn(`Chunk ${i} analysis failed:`, error);
                                }
                                resolve();
                            }
                        };
                        if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
                            const handle = requestIdleCallback(processChunk, { timeout: TIMEOUTS.IDLE_CALLBACK });
                            idleCallbackHandlesRef.current.push(handle);
                        } else {
                            const handle = setTimeout(processChunk, TIMEOUTS.SET_TIMEOUT_FALLBACK) as unknown as number | IdleCallbackHandle;
                            idleCallbackHandlesRef.current.push(handle);
                        }
                    });
                }
                result.identifiedPlatforms = Array.from(platformsSet);
                result.platformDetails = Array.from(platformDetailsMap.values());
                result.risks = Array.from(risksMap.values());
                result.recommendations = Array.from(recommendationsSet);
                if (result.risks.length > 0) {
                    result.riskScore = calculateRiskScore(result.risks);
                }
                if (isMountedRef.current) {
                    setAnalysisProgress(null);
                }
            } else {
                if (signal.aborted || !isMountedRef.current) {
                    if (isMountedRef.current) {
                        setIsAnalyzing(false);
                        setAnalysisError(null);
                    }
                    return;
                }
                result = await new Promise<ScriptAnalysisResult>((resolve, reject) => {
                    const processContent = () => {
                        if (signal.aborted || !isMountedRef.current) {
                            if (isMountedRef.current) {
                                setIsAnalyzing(false);
                                setAnalysisError(null);
                                setAnalysisProgress(null);
                            }
                            reject(new Error("Analysis cancelled"));
                            return;
                        }
                        try {
                            resolve(analyzeScriptContent(trimmedContent));
                        } catch (error) {
                            reject(error);
                        }
                    };
                    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
                        const handle = requestIdleCallback(processContent, { timeout: TIMEOUTS.IDLE_CALLBACK });
                        idleCallbackHandlesRef.current.push(handle);
                    } else {
                        const handle = setTimeout(processContent, TIMEOUTS.SET_TIMEOUT_FALLBACK) as unknown as number | IdleCallbackHandle;
                        idleCallbackHandlesRef.current.push(handle);
                    }
                });
            }
            if (isMountedRef.current) {
                setAnalysisResult(result);
                if (result.identifiedPlatforms.length > 0 || result.risks.length > 0) {
                    const formData = new FormData();
                    formData.append("_action", "analyze_manual_script");
                    formData.append("scriptContent", trimmedContent);
                    submit(formData, { method: "post" });
                }
            }
        } catch (error) {
            handleAnalysisError(error, trimmedContent.length);
        } finally {
            if (isMountedRef.current) {
                setIsAnalyzing(false);
                setAnalysisProgress(null);
            }
        }
    }, [scriptContent, isAnalyzing, handleAnalysisError, submit]);
    const isSavingAnalysis = saveAnalysisFetcher.state === "submitting";
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
            console.error("Failed to process manual input", error);
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
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
            }
            idleCallbackHandlesRef.current.forEach(handle => {
                cancelIdleCallbackOrTimeout(handle);
            });
            idleCallbackHandlesRef.current = [];
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
    const getStatusText = useCallback((status: string | null | undefined): string => {
        if (!status) return "未知";
        switch (status) {
            case "completed":
                return "完成";
            case "completed_with_errors":
                return "完成（有错误）";
            case "failed":
                return "失败";
            case "scanning":
                return "扫描中";
            case "pending":
                return "等待中";
            default:
                return status;
        }
    }, []);
    const processedScanHistory = useMemo(() => {
        return scanHistory
            .filter((scan): scan is NonNullable<typeof scan> => scan !== null)
            .map((scan) => {
                const riskScore = validateRiskScore(scan.riskScore);
                const platforms = validateStringArray(scan.identifiedPlatforms);
                const createdAt = parseDateSafely(scan.createdAt);
                const status = getStatusText(scan.status);
                return [
                    createdAt ? safeFormatDate(createdAt) : "未知",
                    riskScore,
                    platforms.join(", ") || "-",
                    status,
                ];
            });
    }, [scanHistory, getStatusText]);
    const MAX_VISIBLE_ACTIONS = 5;
    const generateChecklistText = useCallback((format: "markdown" | "plain"): string => {
        const items = migrationActions && migrationActions.length > 0
            ? migrationActions.map((a, i) => {
                const priorityText = format === "markdown"
                    ? (a.priority === "high" ? "高" : a.priority === "medium" ? "中" : "低")
                    : (a.priority === "high" ? "高优先级" : a.priority === "medium" ? "中优先级" : "低优先级");
                const platformText = a.platform ? ` (${getPlatformName(a.platform)})` : "";
                return `${i + 1}. [${priorityText}] ${a.title}${platformText}`;
            })
            : ["无"];
        if (format === "markdown") {
            return [
                "# 迁移清单",
                `店铺: ${shop?.domain || "未知"}`,
                `生成时间: ${new Date().toLocaleString("zh-CN")}`,
                "",
                "## 待处理项目",
                ...items,
                "",
                "## 快速链接",
                `- Pixels 管理: https://admin.shopify.com/store/${shop?.domain || 'shop'}/settings/notifications`,
                `- Checkout Editor: https://admin.shopify.com/store/${shop?.domain || 'shop'}/themes/current/editor`,
                "- 应用迁移工具: /app/migrate",
            ].join("\n");
        } else {
            return [
                "迁移清单",
                `店铺: ${shop?.domain || "未知"}`,
                `生成时间: ${new Date().toLocaleString("zh-CN")}`,
                "",
                "待处理项目:",
                ...items,
            ].join("\n");
        }
    }, [migrationActions, shop?.domain, getPlatformName]);
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
              <strong>Shopify 官方升级路径：</strong>使用 blocks + web pixels 替代 legacy customizations。Plus 商家：{getDateDisplayLabel(DEPRECATION_DATES.plusAdditionalScriptsReadOnly, "exact")} 截止，{getDateDisplayLabel(DEPRECATION_DATES.plusAutoUpgradeStart, "month")} 自动升级会丢失 legacy 自定义。非 Plus 商家：{getDateDisplayLabel(DEPRECATION_DATES.nonPlusAdditionalScriptsReadOnly, "exact")} 截止。
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
                <List.Item><strong>生成验收报告（PDF/CSV）</strong> → 付费（Growth $79/月 或 Agency $199/月）</List.Item>
                <List.Item>这是"升级项目交付"的核心能力：让商家"敢点发布/敢切 Live"</List.Item>
              </List>
            )}
            {isGrowthOrAbove && !isProOrAbove && (
              <List type="bullet">
                <List.Item>当前可用：Web Pixel 标准事件映射（v1 最小可用迁移，v1.1+ 将支持服务端 CAPI）</List.Item>
                <List.Item>升级到 Pro 以解锁事件对账、告警与高级 TY/OS 模块</List.Item>
              </List>
            )}
            {isProOrAbove && !isAgency && (
              <List type="bullet">
                <List.Item>已解锁多渠道像素 + 事件对账 + TY/OS 高级组件</List.Item>
                <List.Item>如需多店铺协作/白标报告，可升级至 Agency</List.Item>
              </List>
            )}
            {isAgency && (
              <List type="bullet">
                <List.Item>已解锁多店铺、协作与白标报告</List.Item>
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
          {selectedTab === 0 && (<BlockStack gap="500">
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
                              } catch {}
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
                      <Button
                        icon={ShareIcon}
                        onClick={async () => {
                          try {
                            const response = await fetch("/api/reports/share", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                reportType: "scan",
                                reportId: latestScan.id,
                              }),
                            });
                            if (response.ok) {
                              const data = await response.json().catch((error) => {
                                showError("解析响应失败");
                                throw error;
                              });
                              const shareUrl = data.shareUrl;
                              const validatedRiskScore = validateRiskScore(latestScan.riskScore);
                              const scanDate = safeParseDate(latestScan.createdAt);
                              const shareText = `店铺追踪扫描报告\n风险评分: ${validatedRiskScore}/100\n检测平台: ${identifiedPlatforms.join(", ") || "无"}\n扫描时间: ${scanDate.toLocaleString("zh-CN")}\n\n查看完整报告: ${shareUrl}`;
                              if (navigator.share) {
                                try {
                                  await navigator.share({
                                    title: "追踪脚本扫描报告",
                                    text: shareText,
                                    url: shareUrl,
                                  });
                                  showSuccess("报告链接已分享");
                                  return;
                                } catch (error) {
                                  if (error instanceof Error && error.name !== 'AbortError') {
                                  }
                                }
                              }
                              if (navigator.clipboard && navigator.clipboard.writeText) {
                                await navigator.clipboard.writeText(shareUrl);
                                showSuccess("报告链接已复制到剪贴板（7天内有效）");
                              } else {
                                showError("浏览器不支持分享或复制功能");
                              }
                            } else {
                              const validatedRiskScore = validateRiskScore(latestScan.riskScore);
                              const scanDate = safeParseDate(latestScan.createdAt);
                              const shareData = {
                                title: "追踪脚本扫描报告",
                                text: `店铺追踪扫描报告\n风险评分: ${validatedRiskScore}/100\n检测平台: ${identifiedPlatforms.join(", ") || "无"}\n扫描时间: ${scanDate.toLocaleString("zh-CN")}`,
                              };
                              if (navigator.share) {
                                try {
                                  await navigator.share(shareData);
                                  showSuccess("报告摘要已分享");
                                  return;
                                } catch (error) {
                                  if (error instanceof Error && error.name !== 'AbortError') {
                                  }
                                }
                              }
                              if (navigator.clipboard && navigator.clipboard.writeText) {
                                await navigator.clipboard.writeText(shareData.text);
                                showSuccess("报告摘要已复制到剪贴板");
                              } else {
                                showError("浏览器不支持分享或复制功能");
                              }
                            }
                          } catch (error) {
                            showError("生成分享链接失败：" + (error instanceof Error ? error.message : "未知错误"));
                          }
                        }}
                      >
                        分享报告链接（免费）
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
                    external: true,
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
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" variant="bodySm" tone="subdued">
                      风险等级
                    </Text>
                    <Badge tone={latestScan.riskScore > 60 ? "critical" : latestScan.riskScore > 30 ? "warning" : "success"}>
                      {latestScan.riskScore > 60 ? "High" : latestScan.riskScore > 30 ? "Med" : "Low"}
                    </Badge>
                  </InlineStack>
                  {(() => {
                    const estimatedTimeMinutes = riskItems.reduce((sum, item) => {
                      const timeMap: Record<string, number> = { high: 30, medium: 15, low: 5 };
                      return sum + (timeMap[item.severity] || 10);
                    }, 0);
                    const estimatedHours = Math.floor(estimatedTimeMinutes / 60);
                    const estimatedMins = estimatedTimeMinutes % 60;
                    return estimatedTimeMinutes > 0 ? (
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="span" variant="bodySm" tone="subdued">
                          预计修复时间
                        </Text>
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          {estimatedHours > 0 ? `${estimatedHours} 小时 ` : ""}{estimatedMins > 0 ? `${estimatedMins} 分钟` : ""}
                        </Text>
                      </InlineStack>
                    ) : null;
                  })()}
                  <Text as="p" variant="bodySm" tone="subdued">
                    扫描时间:{" "}
                    {safeFormatDate(latestScan.createdAt)}
                  </Text>
                  <Divider />
                  <BlockStack gap="200">
                    <Button
                      url={isPlanAtLeast(planIdSafe, "starter") ? "/app/migrate" : "/app/billing"}
                      variant={isPlanAtLeast(planIdSafe, "starter") ? "primary" : "secondary"}
                      fullWidth
                    >
                      {isPlanAtLeast(planIdSafe, "starter")
                        ? "启用Purchase-only修复（10分钟）"
                        : "升级到 Migration 启用修复"}
                    </Button>
                    {!isPlanAtLeast(planIdSafe, "growth") && (
                      <Button
                        url="/app/billing"
                        variant="secondary"
                        fullWidth
                      >
                        启用Full-funnel修复（30分钟，Growth）
                      </Button>
                    )}
                  </BlockStack>
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
                        {scriptTags.length}
                      </Text>
                    </InlineStack>
                    {scriptTags.length > 0 && deprecationStatus?.scriptTag && (<Banner tone={deprecationStatus.scriptTag.isExpired ? "critical" : "warning"}>
                        <p>{deprecationStatus.scriptTag.description}</p>
                      </Banner>)}
                  </BlockStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>)}
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
              <Box background="bg-fill-critical-secondary" padding="400" borderRadius="200">
                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={AlertCircleIcon} tone="critical" />
                    <Text as="h3" variant="headingMd" tone="critical">
                      不迁移会丢失什么？（示意说明）
                    </Text>
                  </InlineStack>
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
              <Box background="bg-fill-success-secondary" padding="400" borderRadius="200">
                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={CheckCircleIcon} tone="success" />
                    <Text as="h3" variant="headingMd" tone="success">
                      迁移后能恢复什么？（您的预期收益）
                    </Text>
                  </InlineStack>
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
                        <Text as="p" variant="bodySm" tone="subdued">Web Pixel</Text>
                        <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                          标准事件
                        </Text>
                        <Text as="p" variant="bodySm" tone="success">
                          合规迁移（v1）
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
                        所有追踪功能将通过 Web Pixel 标准事件映射恢复（v1 最小可用迁移）
                      </Text>
                    )}
                  </BlockStack>
                  <Banner tone="success">
                    <Text as="p" variant="bodySm">
                      <strong>✅ 迁移的核心价值：</strong>
                      迁移是一次性工作，完成后可确保转化追踪在 ScriptTag 废弃后继续正常工作。
                      v1 提供 Web Pixel 标准事件映射（GA4/Meta/TikTok），v1.1+ 将支持服务端 CAPI（不受浏览器隐私设置和广告拦截器影响）。
                      实际追踪效果因店铺情况而异。
                    </Text>
                  </Banner>
                </BlockStack>
              </Box>
              <Divider />
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
                        {scriptTags.length} 个 ScriptTag 将失效
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
                        Web Pixel 标准事件
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
                <Banner tone="info" title="v1 最小可用迁移说明">
                  <Text as="p" variant="bodySm">
                    ✅ v1 支持：Web Pixel 标准事件映射（GA4/Meta/TikTok）
                    <br />
                    ✅ 标准事件映射 + 参数完整率检查 + 可下载 payload 证据
                    <br />
                    ✅ 验收向导 + 事件参数完整率 + 订单金额/币种一致性验证
                    <br />
                    <Text as="span" fontWeight="semibold">⚠️ v1.1+ 规划：</Text> 服务端 CAPI（不受浏览器隐私设置和广告拦截器影响）
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
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  风险详情
                </Text>
                <Badge tone="info">{`${riskItems.length} 项`}</Badge>
              </InlineStack>
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
                        {action.type === "enable_capi" && false && (
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
                    url={`https://admin.shopify.com/store/${shop?.domain || 'shop'}/settings/notifications`}
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
                  🛒 Checkout Editor（Plus 专属）
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  如果您是 Shopify Plus 商家，可以使用 Checkout UI Extension 替代 Additional Scripts。
                </Text>
                <InlineStack gap="300" wrap>
                  <Button
                    url={`https://admin.shopify.com/store/${shop?.domain || 'shop'}/themes/current/editor`}
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
                            const checklist = generateChecklistText("markdown");
                            if (navigator.clipboard && navigator.clipboard.writeText) {
                              await navigator.clipboard.writeText(checklist);
                              showSuccess("清单已复制到剪贴板");
                            } else {
                              showError("浏览器不支持复制功能");
                            }
                          } catch (error) {
                            if (process.env.NODE_ENV === "development") {
                                console.error("复制失败:", error);
                            }
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
                            const checklist = generateChecklistText("plain");
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
                                  if (process.env.NODE_ENV === "development") {
                                      console.warn("Failed to remove download link:", removeError);
                                  }
                                }
                                if (exportBlobUrlRef.current) {
                                  URL.revokeObjectURL(exportBlobUrlRef.current);
                                  exportBlobUrlRef.current = null;
                                }
                                exportTimeoutRef.current = null;
                              }, TIMEOUTS.EXPORT_CLEANUP);
                            } catch (domError) {
                              if (process.env.NODE_ENV === "development") {
                                  console.error("Failed to trigger download:", domError);
                              }
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
                            if (process.env.NODE_ENV === "development") {
                                console.error("导出失败:", error);
                            }
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
                      <Button
                        icon={ExportIcon}
                        loading={isExporting}
                        onClick={async () => {
                          if (isExporting) return;
                          setIsExporting(true);
                          try {
                            const response = await fetch("/api/checklist-pdf");
                            if (!response.ok) {
                              const errorData = await response.json().catch(() => ({ error: "导出失败" }));
                              throw new Error(errorData.error || "导出失败");
                            }
                            const blob = await response.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = `migration-checklist-${new Date().toISOString().split("T")[0]}.pdf`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                            showSuccess("PDF 清单导出成功");
                          } catch (error) {
                            if (process.env.NODE_ENV === "development") {
                                console.error("PDF 导出失败:", error);
                            }
                            showError(error instanceof Error ? error.message : "PDF 导出失败，请重试");
                          } finally {
                            setIsExporting(false);
                          }
                        }}
                      >
                        导出 PDF
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
                            <br />• checkout.liquid → Pixel + Extension
                          </Text>
                        </BlockStack>
                      </Box>
                      <Box minWidth="200px">
                        <BlockStack gap="100">
                          <Badge tone="warning">UI Extension 替代</Badge>
                          <Text as="p" variant="bodySm">
                            • Additional Scripts → Checkout UI Extension
                            <br />• Thank you/Order status 自定义脚本 → UI Extension Blocks（可替代 legacy thank-you/order-status 自定义脚本的模块库：Survey 问卷、Help 帮助中心、Reorder 再购按钮等）
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            <strong>迁移价值：</strong>基于 Checkout UI Extensions，符合 Shopify 官方推荐，替代 Additional Scripts 中的问卷、售后按钮等自定义脚本
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
        {processedScanHistory.length > 0 ? (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                扫描历史
              </Text>
              <DataTable
                columnContentTypes={["text", "numeric", "text", "text"]}
                headings={["扫描时间", "风险分", "检测平台", "状态"]}
                rows={processedScanHistory}
              />
            </BlockStack>
          </Card>
        ) : (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                扫描历史
              </Text>
              <EnhancedEmptyState
                icon="📋"
                title="暂无扫描历史"
                description="执行扫描后，历史记录将显示在这里。"
                primaryAction={{
                  content: "开始扫描",
                  onAction: handleScan,
                }}
              />
            </BlockStack>
          </Card>
        )}
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
                    <Banner tone="critical" title={`Plus：${getDateDisplayLabel(DEPRECATION_DATES.plusScriptTagExecutionOff, "exact")} / 非 Plus：${getDateDisplayLabel(DEPRECATION_DATES.nonPlusScriptTagExecutionOff, "exact")} 将失效`}>
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
                              onClick={() => {
                                setGuidedSupplementOpen(true);
                              }}
                              variant="primary"
                              size="slim"
                            >
                              从升级向导补充
                            </Button>
                            <Button
                              onClick={() => {
                                setManualInputWizardOpen(true);
                              }}
                              size="slim"
                            >
                              引导补充信息
                            </Button>
                            <Button
                              onClick={() => {
                                setGuidanceContent({ title: "从 Shopify 升级向导导入脚本" });
                                setGuidanceModalOpen(true);
                              }}
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
                      onAssetsCreated={(count) => {
                        showSuccess(`成功创建 ${count} 个迁移资产`);
                        window.location.reload();
                      }}
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
                </Card>)}
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
                    {(saveAnalysisFetcher.data as FetcherResult | undefined)?.error && (
                      <Banner tone="critical">
                        <Text as="p">{(saveAnalysisFetcher.data as FetcherResult | undefined)?.error}</Text>
                      </Banner>
                    )}
                    {(saveAnalysisFetcher.data as FetcherResult | undefined)?.success && (
                      <Banner tone="success">
                        <Text as="p">{(saveAnalysisFetcher.data as FetcherResult | undefined)?.message}</Text>
                      </Banner>
                    )}
                    {(processPasteFetcher.data as FetcherResult | undefined)?.error && (
                      <Banner tone="critical">
                        <Text as="p">{(processPasteFetcher.data as FetcherResult | undefined)?.error}</Text>
                      </Banner>
                    )}
                    {(processPasteFetcher.data as FetcherResult | undefined)?.success && (
                      <Banner tone="success">
                        <Text as="p">{(processPasteFetcher.data as FetcherResult | undefined)?.message}</Text>
                      </Banner>
                    )}
                    <InlineStack gap="200" align="end">
                      {scriptContent.trim() && (
                        <Button
                          onClick={handleProcessManualPaste}
                          loading={isProcessingPaste}
                          disabled={pasteProcessed || !scriptContent.trim()}
                          icon={CheckCircleIcon}
                          variant="primary"
                        >
                          {pasteProcessed ? "已处理" : "直接处理粘贴内容"}
                        </Button>
                      )}
                      <Button
                        onClick={handleSaveAnalysis}
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
            </BlockStack>)}
          {selectedTab === 2 && (
            <BlockStack gap="500">
              {}
              {showTabs && (
                <AuditPaywallCard planId={planIdSafe} />
              )}
              <Box paddingBlockStart="400">
                {!latestScan ? (
                  <Card>
                    <BlockStack gap="400">
                      <EnhancedEmptyState
                        icon="📋"
                        title="暂无迁移清单"
                        description="完成自动扫描后，我们将为您生成迁移清单和优先级建议。"
                        primaryAction={{
                          content: "开始扫描",
                          onAction: handleScan,
                        }}
                      />
                    </BlockStack>
                  </Card>
                ) : migrationChecklist && migrationChecklist.items.length > 0 ? (
                  <MigrationChecklistEnhanced
                    items={migrationChecklist.items}
                    dependencyGraph={dependencyGraph}
                    onItemClick={(assetId) => {
                      window.location.href = `/app/migrate?asset=${assetId}`;
                    }}
                    onItemComplete={(assetId) => {
                      const formData = new FormData();
                      formData.append("_action", "mark_asset_complete");
                      formData.append("assetId", assetId);
                      submit(formData, { method: "post" });
                    }}
                  />
                ) : (
                  <Card>
                    <BlockStack gap="400">
                      <EnhancedEmptyState
                        icon="📋"
                        title="暂无迁移清单"
                        description="扫描结果中没有需要迁移的项目。"
                      />
                    </BlockStack>
                  </Card>
                )}
              </Box>
            </BlockStack>
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
                  <List.Item>等待 ScriptTag 自动过期（Plus 商家将于 {getDateDisplayLabel(DEPRECATION_DATES.plusScriptTagExecutionOff, "exact")} 停止执行，非 Plus 商家将于 {getDateDisplayLabel(DEPRECATION_DATES.nonPlusScriptTagExecutionOff, "exact")} 停止执行）</List.Item>
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
