import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";
import { getScanHistory } from "../../services/scanner.server";
import { refreshTypOspStatus } from "../../services/checkout-profile.server";
import { generateMigrationActions } from "../../services/scanner/migration-actions";
import { getExistingWebPixels } from "../../services/migration.server";
import { getAuditAssets } from "../../services/audit-asset.server";
import { analyzeDependencies } from "../../services/dependency-analysis.server";
import { generateMigrationTimeline, getMigrationProgress } from "../../services/migration-priority.server";
import { generateMigrationChecklist } from "../../services/migration-checklist.server";
import {
    getScriptTagDeprecationStatus,
    getAdditionalScriptsDeprecationStatus,
    getMigrationUrgencyStatus,
    getUpgradeStatusMessage,
    formatDeadlineForUI,
    type ShopTier,
    type ShopUpgradeStatus,
} from "../../utils/deprecation-dates";
import { getPlanDefinition, normalizePlan, isPlanAtLeast } from "../../utils/plans";
import {
    validateScriptTagsArray,
    validateRiskItemsArray,
    validateStringArray,
    validateRiskScore,
} from "../../utils/scan-data-validation";
import { isValidShopTier } from "../../utils/scan-validation";
import { logger } from "../../utils/logger.server";
import type { ScriptTag } from "../../types";
import type { MigrationAction, EnhancedScanResult } from "../../services/scanner/types";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { SCANNER_CONFIG, SCRIPT_ANALYSIS_CONFIG } = await import("../../utils/config.server");
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
            scriptAnalysisMaxContentLength: SCRIPT_ANALYSIS_CONFIG.MAX_CONTENT_LENGTH,
            scriptAnalysisChunkSize: SCRIPT_ANALYSIS_CONFIG.CHUNK_SIZE,
            scannerMaxScriptTags: SCANNER_CONFIG.MAX_SCRIPT_TAGS,
            scannerMaxWebPixels: SCANNER_CONFIG.MAX_WEB_PIXELS,
            webPixelsCount: 0,
        });
    }
    const latestScanRaw = await prisma.scanReport.findFirst({
        where: { shopId: shop.id },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            scriptTags: true,
            checkoutConfig: true,
            riskItems: true,
            riskScore: true,
            identifiedPlatforms: true,
            status: true,
            errorMessage: true,
            createdAt: true,
            completedAt: true,
        },
    });
    if (latestScanRaw?.status === "completed") {
        const planId = normalizePlan(shop.plan ?? "free");
        const isAgency = isPlanAtLeast(planId, "agency");
        const riskScore = latestScanRaw.riskScore ?? 0;
        const riskItems = validateRiskItemsArray(latestScanRaw.riskItems);
        const assetCount = riskItems.length;
        const { trackEvent } = await import("~/services/analytics.server");
        const { safeFireAndForget } = await import("~/utils/helpers.server");
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
    let webPixelsCount = 0;
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
                    webPixelsCount = webPixels.length;
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
    const typOspPromise = (async () => {
        if (admin && isTypOspStale) {
            try {
                return await refreshTypOspStatus(admin, shop.id);
            } catch (error) {
                return {
                    status: "unknown" as const,
                    typOspPagesEnabled: shop.typOspPagesEnabled,
                    checkedAt: lastTypOspCheck,
                    error: error instanceof Error ? error.message : "Unknown error",
                    unknownReason: "API_ERROR",
                };
            }
        }
        return {
            status: "cached" as const,
            typOspPagesEnabled: shop.typOspPagesEnabled,
            checkedAt: lastTypOspCheck,
        };
    })();

    const planId = normalizePlan(shop.plan);
    const planDef = getPlanDefinition(planId);
    
    const [
        typOspResult,
        migrationTimeline,
        migrationProgress,
        dependencyGraph,
        auditAssets,
        migrationChecklist
    ] = await Promise.all([
        typOspPromise,
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

    const typOspPagesEnabled = typOspResult.typOspPagesEnabled;
    const typOspUpdatedAt = typOspResult.checkedAt;
    let typOspUnknownReason: string | undefined = shop.typOspStatusReason ?? undefined;
    let typOspUnknownError: string | undefined;

    if (typOspResult.status === "unknown") {
        typOspUnknownReason = (typOspResult as any).unknownReason;
        typOspUnknownError = (typOspResult as any).error;
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
        planId,
        planLabel: planDef.name,
        planTagline: planDef.tagline,
        migrationTimeline,
        migrationProgress,
        dependencyGraph,
        auditAssets,
        migrationChecklist,
        scriptAnalysisMaxContentLength: SCRIPT_ANALYSIS_CONFIG.MAX_CONTENT_LENGTH,
        scriptAnalysisChunkSize: SCRIPT_ANALYSIS_CONFIG.CHUNK_SIZE,
        scannerMaxScriptTags: SCANNER_CONFIG.MAX_SCRIPT_TAGS,
        scannerMaxWebPixels: SCANNER_CONFIG.MAX_WEB_PIXELS,
        webPixelsCount,
    });
};
