import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useFetcher, useActionData } from "@remix-run/react";
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Page, Layout, Card, Text, BlockStack, InlineStack, Badge, Button, Banner, Box, Divider, ProgressBar, Icon, DataTable, Link, Tabs, TextField, Modal, List, RangeSlider, } from "@shopify/polaris";
import { AlertCircleIcon, CheckCircleIcon, SearchIcon, ArrowRightIcon, ClipboardIcon, RefreshIcon, InfoIcon, ExportIcon, ShareIcon, SettingsIcon, } from "~/components/icons";
import { CardSkeleton, EnhancedEmptyState, useToastContext } from "~/components/ui";
import { AnalysisResultSummary } from "~/components/scan";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { scanShopTracking, getScanHistory, type ScriptAnalysisResult } from "../services/scanner.server";
import { analyzeScriptContent } from "../services/scanner/content-analysis";
import { calculateRiskScore } from "../services/scanner/risk-assessment";
import { refreshTypOspStatus } from "../services/checkout-profile.server";
import { generateMigrationActions } from "../services/scanner/migration-actions";
import { getExistingWebPixels } from "../services/migration.server";
import { createAuditAsset } from "../services/audit-asset.server";
import { getScriptTagDeprecationStatus, getAdditionalScriptsDeprecationStatus, getMigrationUrgencyStatus, getUpgradeStatusMessage, formatDeadlineForUI, type ShopTier, type ShopUpgradeStatus, } from "../utils/deprecation-dates";
import { getPlanDefinition, normalizePlan, isPlanAtLeast } from "../utils/plans";
import { SCANNER_CONFIG, SCRIPT_ANALYSIS_CONFIG } from "../utils/config";
import type { ScriptTag, RiskItem } from "../types";
import type { MigrationAction, EnhancedScanResult } from "../services/scanner/types";
import { logger } from "../utils/logger.server";
import {
    validateScriptTagsArray,
    validateRiskItemsArray,
    validateStringArray,
    validateRiskScore,
    validateAdditionalScriptsPatterns,
    safeParseDate,
    safeFormatDate,
} from "../utils/scan-data-validation";
import { containsSensitiveInfo, sanitizeSensitiveInfo } from "../utils/security";
import crypto from "crypto";

// 常量定义
const TIMEOUTS = {
    IDLE_CALLBACK: 100,
    SET_TIMEOUT_FALLBACK: 10,
    EXPORT_CLEANUP: 100,
} as const;

// save_analysis action 相关常量
const SAVE_ANALYSIS_LIMITS = {
    MAX_INPUT_SIZE: 1024 * 1024, // 1MB
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

// 平台名称格式验证正则表达式（只允许小写字母、数字和下划线）
const PLATFORM_NAME_REGEX = /^[a-z0-9_]+$/;

// 共享类型定义
type FetcherResult = {
    success?: boolean;
    message?: string;
    error?: string;
    details?: {
        message?: string;
        [key: string]: unknown;
    };
};

// 类型守卫：验证 FetcherResult
function isFetcherResult(data: unknown): data is FetcherResult {
    return (
        typeof data === "object" &&
        data !== null &&
        ("success" in data || "error" in data || "message" in data)
    );
}

// 辅助函数：安全地解析日期
function parseDateSafely(dateValue: unknown): Date | null {
    if (!dateValue) return null;
    try {
        const parsed = new Date(dateValue as string);
        return !isNaN(parsed.getTime()) ? parsed : null;
    } catch {
        return null;
    }
}

// 类型定义：IdleCallbackHandle
type IdleCallbackHandle = ReturnType<typeof requestIdleCallback>;

// 辅助函数：安全地取消空闲回调或超时
function cancelIdleCallbackOrTimeout(handle: number | IdleCallbackHandle | null): void {
    if (handle === null) return;
    
    if (typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        // 检查是否是 IdleCallbackHandle
        if (typeof handle === 'number') {
            cancelIdleCallback(handle as IdleCallbackHandle);
        } else {
            cancelIdleCallback(handle);
        }
    } else {
        clearTimeout(handle as number);
    }
}

/**
 * 递归检查对象/数组中的敏感信息
 */
function checkSensitiveInfoInData(obj: unknown, depth: number = 0): boolean {
    // 防止深度过深导致栈溢出
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

// 类型守卫：验证 shopTier 是否为有效的 ShopTier 类型
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
        });
    }
    const latestScanRaw = await prisma.scanReport.findFirst({
        where: { shopId: shop.id },
        orderBy: { createdAt: "desc" },
    });

    // 使用类型守卫安全地获取 shopTier（只验证一次，避免重复）
    const shopTier: ShopTier = isValidShopTier(shop.shopTier) 
        ? shop.shopTier 
        : "unknown";

    let migrationActions: MigrationAction[] = [];
    if (latestScanRaw) {
        try {
            // 使用共享验证函数进行类型安全的数据验证
            const rawData = latestScanRaw;
            
            const scriptTags = validateScriptTagsArray(rawData.scriptTags);
            const identifiedPlatforms = validateStringArray(rawData.identifiedPlatforms);
            const riskItems = validateRiskItemsArray(rawData.riskItems);
            const riskScore = validateRiskScore(rawData.riskScore);
            const additionalScriptsPatterns = validateAdditionalScriptsPatterns(
                (rawData as Record<string, unknown>).additionalScriptsPatterns
            );

            // 获取 Web Pixels，如果失败则使用空数组
            let webPixels: Array<{ id: string; settings: string | null }> = [];
            try {
                webPixels = await getExistingWebPixels(admin);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : "Unknown error";
                logger.warn("Failed to fetch web pixels during scan data processing", { 
                    shopId: shop.id,
                    error: errorMessage 
                });
                // 继续使用空数组，不影响其他数据的处理
            }
            
            // 经过运行时验证的数据可以直接使用，无需类型断言
            const enhancedResult: EnhancedScanResult = {
                scriptTags,
                checkoutConfig: null,
                identifiedPlatforms,
                riskItems,
                riskScore,
                webPixels: webPixels.map(p => ({ id: p.id, settings: p.settings })),
                duplicatePixels: [],
                migrationActions: [],
                additionalScriptsPatterns,
            };
            
            migrationActions = generateMigrationActions(enhancedResult, shopTier);
        } catch (e) {
            // 区分不同类型的错误，提供更详细的日志
            const errorMessage = e instanceof Error ? e.message : "Unknown error";
            const errorType = e instanceof Error ? e.constructor.name : "Unknown";
            
            // 对于数据格式错误，记录更详细的日志
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
    // 获取扫描历史，失败时返回空数组
    let scanHistory: Awaited<ReturnType<typeof getScanHistory>> = [];
    try {
        scanHistory = await getScanHistory(shop.id, 5);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error("Failed to fetch scan history", {
            shopId: shop.id,
            error: errorMessage,
        });
        // 失败时返回空数组，不影响页面其他功能
        scanHistory = [];
    }
    
    // 使用共享验证函数验证 scriptTags（如果 latestScan 存在但未在 try 块中验证）
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
    
    // 处理套餐信息
    const planId = normalizePlan(shop.plan);
    const planDef = getPlanDefinition(planId);
    
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
            // ✅ 修复 #13: 输入大小早期验证
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
            
            // ✅ 修复 #4: 优化验证顺序 - 先解析 JSON
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
            
            // 验证数据结构
            if (!parsedData || typeof parsedData !== "object") {
                return json({ error: "无效的分析数据格式：必须是对象" }, { status: 400 });
            }
            
            const data = parsedData as Record<string, unknown>;
            
            // ✅ 修复 #2: 在 JSON 解析后，递归检测敏感信息
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
            
            // ✅ 修复 #4: 优化验证顺序 - 先检查基本类型
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
            
            // ✅ 修复 #4: 早期长度检查（防止恶意数据）
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
            
            // ✅ 修复 #7: 更严格的 riskScore 验证
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
            
            // ✅ 修复 #1: 统一平台名称验证（在第一次验证时就检查格式）
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
            
            // 验证 platformDetails 数组元素结构
            if (!data.platformDetails.every((p: unknown) => {
                if (typeof p !== "object" || p === null) return false;
                const detail = p as Record<string, unknown>;
                return (
                    typeof detail.platform === "string" &&
                    typeof detail.type === "string" &&
                    (detail.confidence === "high" || detail.confidence === "medium" || detail.confidence === "low") &&
                    typeof detail.matchedPattern === "string"
                );
            })) {
                return json({ error: "无效的分析数据格式：platformDetails 中的元素结构不正确" }, { status: 400 });
            }
            
            // 验证 risks 数组元素结构
            if (!data.risks.every((r: unknown) => {
                if (typeof r !== "object" || r === null) return false;
                const risk = r as Record<string, unknown>;
                return (
                    typeof risk.id === "string" &&
                    typeof risk.name === "string" &&
                    typeof risk.description === "string" &&
                    (risk.severity === "high" || risk.severity === "medium" || risk.severity === "low")
                );
            })) {
                return json({ error: "无效的分析数据格式：risks 中的元素结构不正确" }, { status: 400 });
            }
            
            // ✅ 修复 #6: 验证 recommendations 元素长度
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
            
            // ✅ 修复 #3: 优化敏感信息清理逻辑（单次清理即可，如果仍有敏感信息则替换）
            const sanitizedPlatformDetails = (data.platformDetails as Array<{
                platform: string;
                type: string;
                confidence: "high" | "medium" | "low";
                matchedPattern: string;
            }>).map(detail => {
                let pattern = detail.matchedPattern;
                
                // 先进行单次清理
                pattern = sanitizeSensitiveInfo(pattern);
                
                // 如果仍有敏感信息，直接替换为占位符
                if (containsSensitiveInfo(pattern)) {
                    pattern = "[REDACTED_PATTERN]";
                }
                
                // ✅ 修复 #12: 使用常量限制长度（在清理后限制，避免截断敏感信息）
                if (pattern.length > SAVE_ANALYSIS_LIMITS.MAX_PATTERN_LENGTH) {
                    pattern = pattern.substring(0, SAVE_ANALYSIS_LIMITS.MAX_PATTERN_LENGTH) + "...";
                }
                
                return { ...detail, matchedPattern: pattern };
            });
            
            // 经过完整验证后，安全地转换为 ScriptAnalysisResult
            const analysisData: ScriptAnalysisResult = {
                identifiedPlatforms: data.identifiedPlatforms as string[],
                platformDetails: sanitizedPlatformDetails,
                risks: data.risks as RiskItem[],
                riskScore: data.riskScore as number,
                recommendations: data.recommendations as string[],
            };

            // ✅ 修复 #9: 记录失败的资产创建
            const createdAssets = [];
            const failedAssets: string[] = [];
            
            // ✅ 修复 #1: 平台名称已在前面统一验证，这里不需要再次验证
            for (const platform of analysisData.identifiedPlatforms) {
                // ✅ 修复 #8: 限制 detectedPatterns 数组大小
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

            // ✅ 修复 #8: 限制 risks 数组大小
            // 如果没有检测到平台但有风险，创建通用记录
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
            
            // ✅ 修复 #9: 如果有部分失败，在响应中包含警告信息
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
            // ✅ 修复 #5: 改进错误处理，不直接暴露错误信息给用户
            const errorId = crypto.randomBytes(4).toString('hex');
            logger.error("Save analysis error", { 
                errorId,
                shopId: shop.id,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                actionType: "save_analysis"
            });
            
            return json({ 
                error: "保存失败，请稍后重试",
                errorId // 用于支持团队追踪问题
            }, { status: 500 });
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

// 提取到组件外部，使用严格的类型定义
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
            // 类型守卫：如果传入的值不在预期范围内，返回info作为降级处理
            const _exhaustive: never = urgency;
            return "info";
        }
    }
}

export default function ScanPage() {
    const { shop, latestScan, scanHistory, deprecationStatus, upgradeStatus, migrationActions, planId, planLabel, planTagline } = useLoaderData<typeof loader>();
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
    const [analysisProgress, setAnalysisProgress] = useState<{ current: number; total: number } | null>(null);
    const [guidanceModalOpen, setGuidanceModalOpen] = useState(false);
    const [guidanceContent, setGuidanceContent] = useState<{ title: string; platform?: string; scriptTagId?: number } | null>(null);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<{ type: "webPixel"; id: string; gid: string; title: string } | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [monthlyOrders, setMonthlyOrders] = useState(500);
    const [isCopying, setIsCopying] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const isScanning = navigation.state === "submitting";
    const analysisSavedRef = useRef(false);
    const isReloadingRef = useRef(false);
    const isMountedRef = useRef(true);
    const reloadTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const exportTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const idleCallbackHandlesRef = useRef<Array<number | IdleCallbackHandle>>([]);
    const exportBlobUrlRef = useRef<string | null>(null);

    // 套餐级别判断 - 使用显式检查确保类型安全
    // normalizePlan 确保 planId 总是有效值，但显式检查提升代码可读性
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
        </BlockStack>
      </Banner>
    );

    // 使用共享验证函数进行类型安全的验证和转换
    const identifiedPlatforms = useMemo(() => {
        return validateStringArray(latestScan?.identifiedPlatforms);
    }, [latestScan?.identifiedPlatforms]);
    
    // 使用共享验证函数提取 scriptTags
    const scriptTags = useMemo(() => {
        return validateScriptTagsArray(latestScan?.scriptTags);
    }, [latestScan?.scriptTags]);

    // 优化 useMemo 依赖项，使用稳定的值而非数组引用
    const identifiedPlatformsCount = identifiedPlatforms.length;
    const scriptTagsCount = scriptTags.length;

    // 计算简单，直接计算即可，useMemo 开销可能大于收益
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

    // ✅ 修复 #5: 提取错误处理函数，确保取消操作时正确清理状态
    const handleAnalysisError = useCallback((error: unknown, contentLength: number) => {
        // ✅ 修复 #5: 取消操作时确保清理所有状态
        if (error instanceof Error && error.message === "Analysis cancelled") {
            if (isMountedRef.current) {
                setIsAnalyzing(false);
                setAnalysisError(null);
                setAnalysisResult(null);
                setAnalysisProgress(null);
                setAnalysisSaved(false);
                analysisSavedRef.current = false;
            }
            return; // 取消操作不需要显示错误
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
        
        console.error("Script analysis error", {
            error: errorMessage,
            errorType: error instanceof Error ? error.constructor.name : "Unknown",
            contentLength,
            hasContent: contentLength > 0,
        });
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

        // 验证 GID 格式
        if (!pendingDelete.gid || typeof pendingDelete.gid !== "string") {
            setDeleteError("无效的 WebPixel ID");
            return;
        }

        // 验证 GID 格式是否符合 Shopify 规范
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
        if (isDeleting) return; // 删除进行中时不允许关闭
        setDeleteModalOpen(false);
        setPendingDelete(null);
        setDeleteError(null);
    }, [isDeleting]);

    const handleUpgradePixelSettings = useCallback(() => {
        if (isUpgrading) return; // 防止重复提交

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
        if (isAnalyzing) return; // 防止重复提交

        // 输入验证
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
        
        // ✅ 修复 #1: 在分析前检测敏感信息
        if (containsSensitiveInfo(trimmedContent)) {
            setAnalysisError("检测到可能包含敏感信息的内容（如 API keys、tokens、客户信息等）。请先脱敏后再分析。");
            return;
        }
        
        setIsAnalyzing(true);
        setAnalysisSaved(false); // 重置保存状态
        analysisSavedRef.current = false;
        setAnalysisError(null);
        setAnalysisProgress(null); // 重置进度
        
        try {
            // ✅ 修复 #3: 创建 AbortController 用于取消操作
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            abortControllerRef.current = new AbortController();
            const signal = abortControllerRef.current.signal;
            
            // 对于大内容，使用分批处理避免阻塞UI
            // 使用 requestIdleCallback 或 setTimeout 来分批处理
            const CHUNK_SIZE = SCRIPT_ANALYSIS_CONFIG.CHUNK_SIZE;
            const isLargeContent = trimmedContent.length > CHUNK_SIZE;
            
            let result: ScriptAnalysisResult;
            
            if (isLargeContent) {
                // ✅ 修复 #2: 大内容分批处理，使用 Map 和 Set 去重
                result = {
                    identifiedPlatforms: [],
                    platformDetails: [],
                    risks: [],
                    riskScore: 0,
                    recommendations: [],
                };
                
                // 使用 Map 和 Set 进行去重
                const platformDetailsMap = new Map<string, typeof result.platformDetails[0]>();
                const risksMap = new Map<string, typeof result.risks[0]>();
                const recommendationsSet = new Set<string>();
                const platformsSet = new Set<string>();
                
                // 计算总块数
                const totalChunks = Math.ceil(trimmedContent.length / CHUNK_SIZE);
                
                // 分批处理每个块
                for (let i = 0; i < totalChunks; i++) {
                    // ✅ 修复 #3: 检查是否已取消，并清理状态
                    if (signal.aborted || !isMountedRef.current) {
                        if (isMountedRef.current) {
                            setIsAnalyzing(false);
                            setAnalysisError(null);
                            setAnalysisProgress(null);
                        }
                        return;
                    }
                    
                    // ✅ 修复 #6: 更新进度
                    if (isMountedRef.current) {
                        setAnalysisProgress({ current: i + 1, total: totalChunks });
                    }
                    
                    // ✅ 修复 #1: 使用 requestIdleCallback 进行真正的异步处理，并正确跟踪和清理
                    await new Promise<void>((resolve) => {
                        const processChunk = () => {
                            // 再次检查是否已取消
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
                                // 动态获取块内容，不预先存储所有块
                                const start = i * CHUNK_SIZE;
                                const end = Math.min(start + CHUNK_SIZE, trimmedContent.length);
                                const chunk = trimmedContent.slice(start, end);
                                
                                // 同步调用分析函数
                                let chunkResult: ScriptAnalysisResult;
                                try {
                                    chunkResult = analyzeScriptContent(chunk);
                                } catch (syncError) {
                                    // ✅ 修复 #5: 捕获同步异常
                                    console.warn(`Chunk ${i} synchronous analysis failed:`, syncError);
                                    resolve();
                                    return;
                                }
                                
                                // ✅ 修复 #2: 合并结果并去重（使用完整 matchedPattern 作为键的一部分）
                                // 合并平台列表
                                for (const platform of chunkResult.identifiedPlatforms) {
                                    platformsSet.add(platform);
                                }
                                
                                // 合并平台详情（去重）- 使用完整 matchedPattern 避免边界情况
                                for (const detail of chunkResult.platformDetails) {
                                    // 使用完整 matchedPattern 作为键，避免截断导致的误判
                                    const key = `${detail.platform}-${detail.type}-${detail.matchedPattern}`;
                                    if (!platformDetailsMap.has(key)) {
                                        platformDetailsMap.set(key, detail);
                                    }
                                }
                                
                                // 合并风险（去重）
                                for (const risk of chunkResult.risks) {
                                    if (!risksMap.has(risk.id)) {
                                        risksMap.set(risk.id, risk);
                                    }
                                }
                                
                                // 合并建议（去重）
                                for (const rec of chunkResult.recommendations) {
                                    recommendationsSet.add(rec);
                                }
                                
                                resolve();
                            } catch (error) {
                                // 单个块失败不影响整体
                                console.warn(`Chunk ${i} analysis failed:`, error);
                                resolve();
                            }
                        };
                        
                        // ✅ 修复 #1: 使用 requestIdleCallback 如果可用，否则降级到 setTimeout，并跟踪句柄
                        let handle: number | IdleCallbackHandle;
                        if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
                            handle = requestIdleCallback(processChunk, { timeout: TIMEOUTS.IDLE_CALLBACK });
                            idleCallbackHandlesRef.current.push(handle);
                        } else {
                            handle = setTimeout(processChunk, TIMEOUTS.SET_TIMEOUT_FALLBACK) as unknown as number;
                            idleCallbackHandlesRef.current.push(handle);
                        }
                    });
                }
                
                // ✅ 修复 #2: 将去重后的结果转换为数组
                result.identifiedPlatforms = Array.from(platformsSet);
                result.platformDetails = Array.from(platformDetailsMap.values());
                result.risks = Array.from(risksMap.values());
                result.recommendations = Array.from(recommendationsSet);
                
                // 重新计算风险评分
                if (result.risks.length > 0) {
                    result.riskScore = calculateRiskScore(result.risks);
                }
                
                // 清除进度
                if (isMountedRef.current) {
                    setAnalysisProgress(null);
                }
            } else {
                // 小内容直接处理
                // ✅ 修复 #3: 检查是否已取消，并清理状态
                if (signal.aborted || !isMountedRef.current) {
                    if (isMountedRef.current) {
                        setIsAnalyzing(false);
                        setAnalysisError(null);
                    }
                    return;
                }
                
                result = await new Promise<ScriptAnalysisResult>((resolve, reject) => {
                    const processContent = () => {
                        // 再次检查是否已取消
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
                    
                    // ✅ 修复 #1: 使用 requestIdleCallback 如果可用，否则降级到 setTimeout，并跟踪句柄
                    let handle: number | IdleCallbackHandle;
                    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
                        handle = requestIdleCallback(processContent, { timeout: TIMEOUTS.IDLE_CALLBACK });
                        idleCallbackHandlesRef.current.push(handle);
                    } else {
                        handle = setTimeout(processContent, TIMEOUTS.SET_TIMEOUT_FALLBACK) as unknown as number;
                        idleCallbackHandlesRef.current.push(handle);
                    }
                });
            }
            
            if (isMountedRef.current) {
                setAnalysisResult(result);
            }
        } catch (error) {
            // ✅ 修复 #5: 使用提取的错误处理函数
            handleAnalysisError(error, trimmedContent.length);
        } finally {
            if (isMountedRef.current) {
                setIsAnalyzing(false);
                setAnalysisProgress(null);
            }
        }
    }, [scriptContent, isAnalyzing, handleAnalysisError]); // 明确包含所有使用的状态

    // 处理保存结果
    const isSavingAnalysis = saveAnalysisFetcher.state === "submitting";

    const handleSaveAnalysis = useCallback(() => {
        // ✅ 修复 #4: 更严格的检查，防止竞态条件
        if (!analysisResult) return;
        
        // 使用原子操作检查所有条件
        if (analysisSavedRef.current || isSavingAnalysis || saveAnalysisFetcher.state !== "idle") {
            return;
        }
        
        // ✅ 修复 #4: 立即设置所有标志，防止重复提交
        analysisSavedRef.current = true;
        setAnalysisSaved(true); // 同步更新 state，避免状态不一致

        const formData = new FormData();
        formData.append("_action", "save_analysis");
        formData.append("analysisData", JSON.stringify(analysisResult));
        saveAnalysisFetcher.submit(formData, { method: "post" });
    }, [analysisResult, saveAnalysisFetcher, isSavingAnalysis]);

    // 当保存成功时更新状态并显示Toast
    useEffect(() => {
        // ✅ 修复 #4: 使用类型守卫进行安全的类型检查
        const result = isFetcherResult(saveAnalysisFetcher.data) ? saveAnalysisFetcher.data : undefined;
        if (!result || saveAnalysisFetcher.state !== "idle" || !isMountedRef.current) return;
        
        if (result.success) {
            // 确保状态同步
            if (!analysisSavedRef.current) {
                analysisSavedRef.current = true;
            }
            setAnalysisSaved(true);
            showSuccess("分析结果已保存！");
        } else if (result.error) {
            // 失败时重置
            analysisSavedRef.current = false;
            setAnalysisSaved(false);
            showError("保存失败：" + result.error);
        }
    }, [saveAnalysisFetcher.data, saveAnalysisFetcher.state, showSuccess, showError]);

    // 当分析结果变化时，重置保存状态
    useEffect(() => {
        if (analysisResult) {
            analysisSavedRef.current = false;
            setAnalysisSaved(false);
        }
    }, [analysisResult]);

    // 防抖的数据重新加载函数
    const reloadData = useCallback(() => {
        if (isReloadingRef.current || !isMountedRef.current) return;
        
        // 清理之前的定时器
        if (reloadTimeoutRef.current) {
            clearTimeout(reloadTimeoutRef.current);
            reloadTimeoutRef.current = null;
        }
        
        isReloadingRef.current = true;
        submit(new FormData(), { method: "get" });
        
        // 使用闭包保存的 timeoutId，不依赖 ref
        const timeoutId = setTimeout(() => {
            // 使用闭包保存的 timeoutId，不依赖 ref
            if (isMountedRef.current && reloadTimeoutRef.current === timeoutId) {
                isReloadingRef.current = false;
                reloadTimeoutRef.current = null;
            }
        }, 1000);
        
        reloadTimeoutRef.current = timeoutId;
    }, [submit]);

    // 处理删除操作的结果
    useEffect(() => {
        // ✅ 修复 #4: 使用类型守卫进行安全的类型检查
        const deleteResult = isFetcherResult(deleteFetcher.data) ? deleteFetcher.data : undefined;
        if (!deleteResult || deleteFetcher.state !== "idle" || !isMountedRef.current) return;
        
        if (deleteResult.success) {
            showSuccess(deleteResult.message || "删除成功！");
            setDeleteModalOpen(false);
            setPendingDelete(null);
            setDeleteError(null);
            // 删除成功后重新加载数据以获取最新状态（带防抖保护）
            reloadData();
        } else {
            // 处理详细错误信息
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
        // ✅ 修复 #4: 使用类型守卫进行安全的类型检查
        const upgradeResult = isFetcherResult(upgradeFetcher.data) ? upgradeFetcher.data : undefined;
        if (!upgradeResult || upgradeFetcher.state !== "idle" || !isMountedRef.current) return;
        
        if (upgradeResult.success) {
            showSuccess(upgradeResult.message || "升级成功！");
            // 升级成功后重新加载数据以获取最新状态（带防抖保护）
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

    // 组件挂载时设置标志，卸载时清理
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            // ✅ 修复 #3: 取消正在进行的分析操作
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
            }
            // ✅ 修复 #1: 清理所有 idle callback handles，防止内存泄漏
            idleCallbackHandlesRef.current.forEach(handle => {
                cancelIdleCallbackOrTimeout(handle);
            });
            idleCallbackHandlesRef.current = [];
            // 清理重新加载定时器，防止内存泄漏
            if (reloadTimeoutRef.current) {
                clearTimeout(reloadTimeoutRef.current);
                reloadTimeoutRef.current = null;
            }
            // ✅ 修复 #2: 清理导出定时器和 Blob URL，防止内存泄漏
            if (exportTimeoutRef.current) {
                clearTimeout(exportTimeoutRef.current);
                exportTimeoutRef.current = null;
            }
            if (exportBlobUrlRef.current) {
                URL.revokeObjectURL(exportBlobUrlRef.current);
                exportBlobUrlRef.current = null;
            }
            // 重置所有标志，防止状态不一致
            isReloadingRef.current = false;
            analysisSavedRef.current = false;
        };
    }, []);
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

    // 状态文本映射函数 - 提取到外部避免重复创建
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
                return status; // 未知状态直接显示原始值
        }
    }, []);

    // 处理扫描历史数据，使用 useMemo 优化性能
    const processedScanHistory = useMemo(() => {
        return scanHistory
            .filter((scan): scan is NonNullable<typeof scan> => scan !== null)
            .map((scan) => {
                // 类型安全验证
                const riskScore = validateRiskScore(scan.riskScore);
                const platforms = validateStringArray(scan.identifiedPlatforms);
                
                // ✅ 修复 #7: 使用共享的日期解析函数
                const createdAt = parseDateSafely(scan.createdAt);
                
                const status = getStatusText(scan.status);
                
                return [
                    createdAt ? safeFormatDate(createdAt) : "未知",
                    riskScore, // 直接传入数字类型，与 columnContentTypes 的 "numeric" 匹配
                    platforms.join(", ") || "-",
                    status,
                ];
            });
    }, [scanHistory, getStatusText]);

    // 迁移清单相关常量
    const MAX_VISIBLE_ACTIONS = 5;

    // 生成迁移清单文本的共享函数
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
                "- Pixels 管理: https://admin.shopify.com/store/settings/customer_events",
                "- Checkout Editor: https://admin.shopify.com/store/settings/checkout/editor",
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
    
    // 使用共享验证函数进行类型安全的验证，与 loader 中的验证逻辑保持一致
    const riskItems = useMemo(() => {
        return validateRiskItemsArray(latestScan?.riskItems);
    }, [latestScan?.riskItems]);
  // 检查是否有部分刷新的警告
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

  return (<Page title="追踪脚本扫描" subtitle="扫描店铺中的追踪脚本，识别迁移风险">
    <BlockStack gap="500">
      {additionalScriptsWarning}
      {paginationLimitWarning}
      {partialRefreshWarning}
      {upgradeStatus && upgradeStatus.title && upgradeStatus.message && (() => {
        // ✅ 修复 #7: 使用共享的日期解析函数
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

      {/* 订阅计划卡片 */}
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
                <List.Item>像素迁移中心（App Pixel + CAPI 向导）在 Growth 及以上开放</List.Item>
                <List.Item>高级 TY/OS 组件、事件对账与多渠道像素需 Pro 及以上</List.Item>
                <List.Item>多店铺/白标报告在 Agency 套餐提供</List.Item>
              </List>
            )}
            {isGrowthOrAbove && !isProOrAbove && (
              <List type="bullet">
                <List.Item>当前可用：App Pixel + 单/双渠道 CAPI 迁移</List.Item>
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
                        onClick={async () => {
                          // 类型安全验证
                          const validatedRiskScore = validateRiskScore(latestScan.riskScore);
                          // 使用安全的日期解析函数
                          const scanDate = safeParseDate(latestScan.createdAt);
                          
                          const shareData = {
                            title: "追踪脚本扫描报告",
                            text: `店铺追踪扫描报告\n风险评分: ${validatedRiskScore}/100\n检测平台: ${identifiedPlatforms.join(", ") || "无"}\n扫描时间: ${scanDate.toLocaleString("zh-CN")}`,
                          };
                          
                          if (navigator.share) {
                            try {
                              await navigator.share(shareData);
                              showSuccess("报告已分享");
                            } catch (error) {
                              // 用户取消分享不算错误，但其他错误需要处理
                              if (error instanceof Error && error.name !== 'AbortError') {
                                console.error("分享失败:", error);
                                // 降级到剪贴板
                                if (navigator.clipboard && navigator.clipboard.writeText) {
                                  try {
                                    await navigator.clipboard.writeText(shareData.text);
                                    showSuccess("报告摘要已复制到剪贴板");
                                  } catch (clipboardError) {
                                    console.error("复制失败:", clipboardError);
                                    showError("无法分享或复制，请手动复制");
                                  }
                                } else {
                                  showError("浏览器不支持分享或复制功能");
                                }
                              }
                            }
                          } else if (navigator.clipboard && navigator.clipboard.writeText) {
                            try {
                              await navigator.clipboard.writeText(shareData.text);
                              showSuccess("报告摘要已复制到剪贴板");
                            } catch (error) {
                              console.error("复制失败:", error);
                              showError("复制失败，请手动复制");
                            }
                          } else {
                            showError("浏览器不支持分享或复制功能");
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
                    {safeFormatDate(latestScan.createdAt)}
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
                            console.error("复制失败:", error);
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
                          
                          // ✅ 修复 #2: 清理之前的 Blob URL（如果存在）
                          if (exportBlobUrlRef.current) {
                            URL.revokeObjectURL(exportBlobUrlRef.current);
                            exportBlobUrlRef.current = null;
                          }
                          
                          try {
                            const checklist = generateChecklistText("plain");
                            const blob = new Blob([checklist], { type: "text/plain" });
                            const url = URL.createObjectURL(blob);
                            exportBlobUrlRef.current = url; // 保存 URL 引用以便清理
                            
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = `migration-checklist-${new Date().toISOString().split("T")[0]}.txt`;
                            
                            // 安全地添加和移除 DOM 元素
                            try {
                              document.body.appendChild(a);
                              a.click();
                              // ✅ 修复 #2: 延迟移除，确保下载开始，使用 ref 保存以便清理
                              exportTimeoutRef.current = setTimeout(() => {
                                try {
                                  if (a.parentNode) {
                                    document.body.removeChild(a);
                                  }
                                } catch (removeError) {
                                  console.warn("Failed to remove download link:", removeError);
                                }
                                // 清理 Blob URL
                                if (exportBlobUrlRef.current) {
                                  URL.revokeObjectURL(exportBlobUrlRef.current);
                                  exportBlobUrlRef.current = null;
                                }
                                exportTimeoutRef.current = null;
                              }, TIMEOUTS.EXPORT_CLEANUP);
                            } catch (domError) {
                              console.error("Failed to trigger download:", domError);
                              // ✅ 修复 #2: 确保在错误情况下也清理 URL
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
                            console.error("导出失败:", error);
                            // ✅ 修复 #2: 确保在错误情况下也清理 URL
                            if (exportBlobUrlRef.current) {
                              URL.revokeObjectURL(exportBlobUrlRef.current);
                              exportBlobUrlRef.current = null;
                            }
                            showError("导出失败，请重试");
                            setIsExporting(false);
                          }
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

                    <InlineStack gap="200" align="end">
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
      </BlockStack>
    </Page>);
}
