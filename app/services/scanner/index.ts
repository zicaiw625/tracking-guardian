import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../../db.server";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { ScriptTag, CheckoutConfig, ScanResult } from "../../types";
import type {
    WebPixelInfo,
    EnhancedScanResult,
    ScanError,
    GraphQLEdge,
    GraphQLPageInfo,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ScriptAnalysisResult
} from "./types";
import { detectPlatforms } from "./patterns";
import { assessRisks, calculateRiskScore } from "./risk-assessment";
import { generateMigrationActions } from "./migration-actions";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { analyzeScriptContent } from "./content-analysis";
import { detectRisksInContent } from "./risk-detector.server";
import { refreshTypOspStatus } from "../checkout-profile.server";
import { logger } from "../../utils/logger.server";
import type { Prisma } from "@prisma/client";
import { SCANNER_CONFIG } from "../../utils/config.server";
import { randomUUID } from "crypto";
import {
    batchCreateAuditAssets,
    type AuditAssetInput
} from "../audit-asset.server";
import { sanitizeScriptTags } from "../../utils/url-sanitize.server";

export type {
    WebPixelInfo,
    EnhancedScanResult,
    MigrationAction,
    ScriptAnalysisResult
} from "./types";
export type { ScanResult, RiskItem } from "../../types";

export { analyzeScriptContent } from "./content-analysis";

const SCAN_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_SCRIPT_TAGS = SCANNER_CONFIG.MAX_SCRIPT_TAGS;
const MAX_PAGINATION_ITERATIONS = 50;

function validateGraphQLEdges<T>(edges: unknown): edges is GraphQLEdge<T>[] {
    if (!Array.isArray(edges)) {
        return false;
    }
    return edges.every((edge: unknown) => {
        return (
            typeof edge === "object" &&
            edge !== null &&
            "node" in edge &&
            "cursor" in edge &&
            typeof (edge as { cursor: unknown }).cursor === "string"
        );
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidScriptTag(tag: unknown): tag is ScriptTag {
    if (!isRecord(tag)) {
        return false;
    }
    return (
        typeof tag.id === "number" &&
        (typeof tag.gid === "string" || tag.gid === null || tag.gid === undefined) &&
        (typeof tag.src === "string" || tag.src === null || tag.src === undefined) &&
        typeof tag.display_scope === "string"
    );
}

function isValidRiskItem(item: unknown): item is import("../../types").RiskItem {
    if (!isRecord(item)) {
        return false;
    }
    if (!("id" in item) || !("name" in item) || !("description" in item) || !("severity" in item)) {
        return false;
    }
    return (
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.description === "string" &&
        (item.severity === "high" || item.severity === "medium" || item.severity === "low")
    );
}

function validateRiskItemsArray(items: unknown): import("../../types").RiskItem[] {
    if (!Array.isArray(items)) {
        return [];
    }
    return items.filter(isValidRiskItem);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isScriptTagArray(value: unknown): value is ScriptTag[] {
    return Array.isArray(value) && value.every((item) => isValidScriptTag(item));
}

function isCheckoutConfig(value: unknown): value is CheckoutConfig {
    if (!isRecord(value)) {
        return false;
    }
    return (
        typeof value.checkoutApiSupported === "boolean" ||
        (value.features !== undefined && isRecord(value.features))
    );
}

async function fetchAllScriptTags(admin: AdminApiContext): Promise<ScriptTag[]> {
    const allTags: ScriptTag[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;
    let previousCursor: string | null = null;
    let iterationCount = 0;
    try {
        while (hasNextPage && iterationCount < MAX_PAGINATION_ITERATIONS) {
            iterationCount++;
            const response = await admin.graphql(`
                query GetScriptTags($cursor: String) {
                    scriptTags(first: 100, after: $cursor) {
                        edges {
                            node {
                                id
                                src
                                displayScope
                                cache
                                createdAt
                                updatedAt
                            }
                            cursor
                        }
                        pageInfo {
                            hasNextPage
                            endCursor
                        }
                    }
                }
            `, { variables: { cursor } });
            let data: {
                data?: {
                    scriptTags?: {
                        edges?: Array<{
                            node: {
                                id: string;
                                src: string;
                                displayScope: string;
                                cache: boolean;
                                createdAt: string;
                                updatedAt: string;
                            };
                            cursor: string;
                        }>;
                        pageInfo?: {
                            hasNextPage: boolean;
                            endCursor: string | null;
                        };
                    };
                };
                errors?: Array<{ message: string }>;
            };
            try {
                data = await response.json();
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : "Unknown error";
                logger.error("Failed to parse GraphQL response as JSON:", errorMessage);
                if (allTags.length > 0) {
                    logger.warn(`Returning ${allTags.length} ScriptTags despite JSON parse error`);
                }
                return allTags;
            }
            if (data.errors && data.errors.length > 0) {
                const errorMessage = data.errors[0]?.message || "Unknown GraphQL error";
                logger.error("GraphQL error fetching ScriptTags:", errorMessage);
                if (allTags.length > 0) {
                    logger.warn(`Returning ${allTags.length} ScriptTags despite errors`);
                }
                return allTags;
            }
            const scriptTagsData = data.data?.scriptTags;
            if (!scriptTagsData || typeof scriptTagsData !== "object") {
                logger.warn("Invalid GraphQL response structure for scriptTags");
                if (allTags.length > 0) {
                    logger.warn(`Returning ${allTags.length} ScriptTags despite invalid response structure`);
                }
                return allTags;
            }
            const edges = scriptTagsData.edges;
            if (!validateGraphQLEdges<{
                id: string;
                src: string;
                displayScope: string;
                cache: boolean;
                createdAt: string;
                updatedAt: string;
            }>(edges)) {
                logger.warn("Invalid edges structure in GraphQL response");
                if (allTags.length > 0) {
                    logger.warn(`Returning ${allTags.length} ScriptTags despite invalid edges`);
                }
                return allTags;
            }
            let pageInfo: GraphQLPageInfo = scriptTagsData.pageInfo || { hasNextPage: false, endCursor: null };
            if (typeof pageInfo !== "object" || pageInfo === null) {
                logger.warn("Invalid pageInfo structure, using defaults");
                pageInfo = { hasNextPage: false, endCursor: null };
            }
            for (const edge of edges) {
                const gidMatch = edge.node.id.match(/ScriptTag\/(\d+)/);
                const numericId = gidMatch ? parseInt(gidMatch[1], 10) : 0;
                allTags.push({
                    id: numericId,
                    gid: edge.node.id,
                    src: edge.node.src,
                    event: "onload",
                    display_scope: edge.node.displayScope?.toLowerCase() || "all",
                    cache: edge.node.cache,
                    created_at: edge.node.createdAt,
                    updated_at: edge.node.updatedAt,
                } as ScriptTag);
            }
            hasNextPage = pageInfo.hasNextPage;
            cursor = pageInfo.endCursor;
            if (cursor === previousCursor && hasNextPage) {
                logger.warn("ScriptTags pagination cursor did not advance, stopping to avoid loop");
                break;
            }
            if (edges.length === 0 && hasNextPage) {
                logger.warn("Received empty edges but hasNextPage is true, stopping to avoid infinite loop");
                break;
            }
            previousCursor = cursor;
            if (allTags.length >= MAX_SCRIPT_TAGS) {
                logger.warn(`ScriptTags pagination limit reached (${MAX_SCRIPT_TAGS})`);
                break;
            }
        }
        if (iterationCount >= MAX_PAGINATION_ITERATIONS) {
            logger.warn(`ScriptTags pagination reached max iterations (${MAX_PAGINATION_ITERATIONS})`);
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error("Failed to fetch ScriptTags:", errorMessage);
        if (allTags.length > 0) {
            logger.warn(`Returning ${allTags.length} ScriptTags despite error`);
        }
    }
    return allTags;
}

async function fetchAllWebPixels(admin: AdminApiContext): Promise<WebPixelInfo[]> {
    const allPixels: WebPixelInfo[] = [];
    try {
        const response = await admin.graphql(`
            query GetWebPixel {
                webPixel {
                    id
                    settings
                }
            }
        `);
        
        let data: {
            data?: {
                webPixel?: {
                    id: string;
                    settings?: string | null;
                };
            };
            errors?: Array<{ message: string }>;
        } | undefined;
        try {
            data = await response.json();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            logger.error("Failed to parse GraphQL response as JSON in fetchAllWebPixels:", errorMessage);
            return allPixels;
        }

        if (data.errors && data.errors.length > 0) {
            const errorMessage = data.errors[0]?.message || "Unknown GraphQL error";
            if (errorMessage.includes("doesn't exist") || errorMessage.includes("access")) {
                logger.warn("WebPixel API not available (may need to reinstall app for read_pixels scope):", { error: errorMessage });
            } else {
                logger.error("GraphQL error fetching WebPixel:", { error: errorMessage });
            }
            return allPixels;
        }

        const webPixel = data.data?.webPixel;
        if (webPixel && webPixel.id) {
            let settings = webPixel.settings;
            if (typeof settings === 'object' && settings !== null) {
                settings = JSON.stringify(settings);
            }
            allPixels.push({
                id: webPixel.id,
                settings: settings ?? null,
            });
        }
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes("doesn't exist") || errorMessage.includes("access")) {
             logger.warn("WebPixel API call failed (scope issue, app may need reinstall):", { error: errorMessage });
        } else {
             logger.error("Failed to fetch WebPixel:", error);
        }
    }
    return allPixels;
}

function collectScriptContent(result: EnhancedScanResult): string {
    const parts: string[] = [];
    for (const tag of result.scriptTags) {
        parts.push(tag.src || "", tag.event || "");
    }
    return parts.join(" ");
}

function detectDuplicatePixels(result: EnhancedScanResult): Array<{
    platform: string;
    count: number;
    ids: string[];
}> {
    const duplicates: Array<{
        platform: string;
        count: number;
        ids: string[];
    }> = [];
    const platformIdentifiers: Record<string, { sources: string[]; platform: string }> = {};
    for (const tag of result.scriptTags) {
        const src = tag.src || "";
        const ga4Match = src.match(/G-[A-Z0-9]+/);
        if (ga4Match) {
            const key = `google:${ga4Match[0]}`;
            if (!platformIdentifiers[key]) {
                platformIdentifiers[key] = { sources: [], platform: "google" };
            }
            platformIdentifiers[key].sources.push(`scripttag_${tag.id}_${tag.gid || ""}`);
        }
        const adsMatch = src.match(/AW-\d+/);
        if (adsMatch) {
            const key = `google_ads:${adsMatch[0]}`;
            if (!platformIdentifiers[key]) {
                platformIdentifiers[key] = { sources: [], platform: "google" };
            }
            platformIdentifiers[key].sources.push(`scripttag_${tag.id}_${tag.gid || ""}`);
        }
        const metaMatch = src.match(/\b(\d{15,16})\b/);
        if (metaMatch) {
            const hasMetaContext = src.includes("facebook") ||
                                   src.includes("fbq") ||
                                   src.includes("connect.facebook") ||
                                   src.includes("fbevents") ||
                                   src.includes("facebook.net");
            if (hasMetaContext) {
                const pixelId = metaMatch[1];
                if (pixelId.length === 15 || pixelId.length === 16) {
                    const key = `meta:${pixelId}`;
                    if (!platformIdentifiers[key]) {
                        platformIdentifiers[key] = { sources: [], platform: "meta" };
                    }
                    platformIdentifiers[key].sources.push(`scripttag_${tag.id}_${tag.gid || ""}`);
                }
            }
        }
        const tiktokMatch = src.match(/[A-Z0-9]{20,}/i);
        if (tiktokMatch) {
            const hasTiktokContext = src.includes("tiktok") ||
                                     src.includes("ttq") ||
                                     src.includes("analytics.tiktok") ||
                                     src.includes("tiktok.com");
            if (hasTiktokContext) {
                const pixelCode = tiktokMatch[0];
                if (pixelCode.length >= 20 && pixelCode.length <= 30 && !pixelCode.includes(":")) {
                    const key = `tiktok:${pixelCode}`;
                    if (!platformIdentifiers[key]) {
                        platformIdentifiers[key] = { sources: [], platform: "tiktok" };
                    }
                    platformIdentifiers[key].sources.push(`scripttag_${tag.id}_${tag.gid || ""}`);
                }
            }
        }
    }
    for (const pixel of result.webPixels) {
        if (!pixel.settings) continue;
        let settings: Record<string, unknown> | null = null;
        try {
            if (typeof pixel.settings === "string") {
                const parsed = JSON.parse(pixel.settings);
                if (isRecord(parsed)) {
                    settings = parsed;
                }
            } else if (isRecord(pixel.settings)) {
                settings = pixel.settings;
            }
            if (!settings) continue;
            for (const [settingKey, value] of Object.entries(settings)) {
                if (typeof value !== "string") continue;
                if (/^G-[A-Z0-9]+$/.test(value)) {
                    const key = `google:${value}`;
                    if (!platformIdentifiers[key]) {
                        platformIdentifiers[key] = { sources: [], platform: "google" };
                    }
                    platformIdentifiers[key].sources.push(`webpixel_${pixel.id}_${settingKey}`);
                }
                else if (/^AW-\d+$/.test(value)) {
                    const key = `google_ads:${value}`;
                    if (!platformIdentifiers[key]) {
                        platformIdentifiers[key] = { sources: [], platform: "google" };
                    }
                    platformIdentifiers[key].sources.push(`webpixel_${pixel.id}_${settingKey}`);
                }
                else if (/^\d{15,16}$/.test(value) &&
                         (settingKey.toLowerCase().includes("pixel") ||
                          settingKey.toLowerCase().includes("meta") ||
                          settingKey.toLowerCase().includes("facebook"))) {
                    const key = `meta:${value}`;
                    if (!platformIdentifiers[key]) {
                        platformIdentifiers[key] = { sources: [], platform: "meta" };
                    }
                    platformIdentifiers[key].sources.push(`webpixel_${pixel.id}_${settingKey}`);
                }
                else if (/^[A-Z0-9]{20,30}$/i.test(value) &&
                        !value.includes(":") &&
                        (settingKey.toLowerCase().includes("pixel") ||
                         settingKey.toLowerCase().includes("tiktok"))) {
                    const key = `tiktok:${value}`;
                    if (!platformIdentifiers[key]) {
                        platformIdentifiers[key] = { sources: [], platform: "tiktok" };
                    }
                    platformIdentifiers[key].sources.push(`webpixel_${pixel.id}_${settingKey}`);
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.warn(`Failed to parse pixel settings for pixel ${pixel.id} in detectDuplicatePixels:`, { error: errorMessage, pixelId: pixel.id });
            continue;
        }
    }
    for (const [key, data] of Object.entries(platformIdentifiers)) {
        if (data.sources.length > 1) {
            const [platform, identifier] = key.split(":");
            duplicates.push({
                platform: data.platform,
                count: data.sources.length,
                ids: data.sources,
            });
            logger.info(`Duplicate detected: ${platform} identifier ${identifier?.substring(0, 8)}... appears ${data.sources.length} times`);
        }
    }
    return duplicates;
}

function isScanCacheValid(cachedAt: Date, ttlMs: number = SCAN_CACHE_TTL_MS): boolean {
    const now = Date.now();
    const cacheAge = now - cachedAt.getTime();
    return cacheAge < ttlMs;
}

export async function getCachedScanResult(
    shopId: string,
    ttlMs: number = SCAN_CACHE_TTL_MS
): Promise<EnhancedScanResult | null> {
    const cached = await prisma.scanReport.findFirst({
        where: { shopId },
        orderBy: { createdAt: "desc" },
        select: {
            scriptTags: true,
            checkoutConfig: true,
            identifiedPlatforms: true,
            riskItems: true,
            riskScore: true,
            completedAt: true,
        },
    });
    if (!cached || !cached.completedAt) {
        return null;
    }
    if (!isScanCacheValid(cached.completedAt, ttlMs)) {
        logger.debug(`Scan cache expired for shop ${shopId}, age: ${Date.now() - cached.completedAt.getTime()}ms`);
        return null;
    }
    logger.debug(`Using cached scan result for shop ${shopId}, age: ${Date.now() - cached.completedAt.getTime()}ms`);
    const scriptTags = isScriptTagArray(cached.scriptTags) ? cached.scriptTags : [];
    const checkoutConfig = isCheckoutConfig(cached.checkoutConfig) ? cached.checkoutConfig : null;
    const identifiedPlatforms = isStringArray(cached.identifiedPlatforms) ? cached.identifiedPlatforms : [];
    const riskItems = validateRiskItemsArray(cached.riskItems);
    return {
        scriptTags,
        checkoutConfig,
        identifiedPlatforms,
        additionalScriptsPatterns: [],
        riskItems,
        riskScore: cached.riskScore || 0,
        webPixels: [],
        duplicatePixels: [],
        migrationActions: [],
        _cachedAt: cached.completedAt,
        _additionalScriptsNote: "Additional Scripts 需要通过手动粘贴识别，Shopify API 无法自动读取 checkout.liquid 中的 Additional Scripts 内容",
    };
}

export async function scanShopTracking(
    admin: AdminApiContext,
    shopId: string,
    options: { force?: boolean; cacheTtlMs?: number } = {}
): Promise<EnhancedScanResult> {
    function safeJsonClone<T>(obj: T): T {
      try {
        return JSON.parse(JSON.stringify(obj)) as T;
      } catch (error) {
        logger.warn("Failed to clone object for database storage, using original:", { error: error instanceof Error ? error.message : String(error) });
        return obj;
      }
    }
    const { force = false, cacheTtlMs = SCAN_CACHE_TTL_MS } = options;
    const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: { shopTier: true }
    });
    const shopTier = shop?.shopTier || "unknown";
    if (!force) {
        const cached = await getCachedScanResult(shopId, cacheTtlMs);
        if (cached) {
            const cacheAge = Date.now() - (cached._cachedAt?.getTime() || 0);
            const shouldRefreshScriptTags = cacheAge > 5 * 60 * 1000;
            let refreshFailed = false;
            try {
                cached.webPixels = await fetchAllWebPixels(admin);
                cached.duplicatePixels = detectDuplicatePixels(cached);
                cached.migrationActions = generateMigrationActions(cached, shopTier);
                if (shouldRefreshScriptTags) {
                    cached._partialRefresh = true;
                    cached._refreshRecommended = true;
                    logger.info(`Cached scan is older than 5 minutes, recommend manual refresh for shop ${shopId}`);
                } else {
                    logger.info(`Returning cached scan with fresh web pixels for shop ${shopId}`);
                }
            } catch (error) {
                refreshFailed = true;
                const errorMessage = error instanceof Error ? error.message : "Unknown error";
                logger.warn(`Failed to refresh web pixels for cached scan: ${errorMessage}`, {
                    shopId,
                    error: errorMessage,
                });
                cached.webPixels = [];
                cached.duplicatePixels = [];
                cached.migrationActions = [];
                cached._partialRefresh = true;
                cached._refreshRecommended = true;
            }
            if (refreshFailed) {
                logger.info(`Returning cached scan with partial refresh for shop ${shopId}`);
            }
            return cached;
        }
    }
    const errors: ScanError[] = [];
    const result: EnhancedScanResult = {
        scriptTags: [],
        checkoutConfig: null,
        identifiedPlatforms: [],
        additionalScriptsPatterns: [],
        riskItems: [],
        riskScore: 0,
        webPixels: [],
        duplicatePixels: [],
        migrationActions: [],
        _additionalScriptsNote: "Additional Scripts 需要通过手动粘贴识别，Shopify API 无法自动读取 checkout.liquid 中的 Additional Scripts 内容",
    };
    logger.info(`Starting enhanced scan for shop ${shopId}`);
    try {
        await refreshTypOspStatus(admin, shopId);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.warn("Failed to refresh TYP/OSP status during scan", { shopId, error: errorMessage });
        errors.push({
            stage: "typ_osp_status",
            message: errorMessage,
            timestamp: new Date(),
        });
    }
    try {
        result.scriptTags = await fetchAllScriptTags(admin);
        logger.info(`Found ${result.scriptTags.length} script tags (with pagination)`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error("Error fetching script tags:", error);
        errors.push({
            stage: "script_tags",
            message: errorMessage,
            timestamp: new Date(),
        });
    }
    try {
        const checkoutResponse = await admin.graphql(`
            query GetCheckoutConfig {
                shop {
                    checkoutApiSupported
                    features {
                        storefront
                    }
                }
            }
        `);
        const checkoutData = await checkoutResponse.json();
        result.checkoutConfig = checkoutData.data?.shop as CheckoutConfig;
        logger.info(`Checkout config fetched successfully`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error("Error fetching checkout config:", error);
        errors.push({
            stage: "checkout_config",
            message: errorMessage,
            timestamp: new Date(),
        });
    }
    try {
        result.webPixels = await fetchAllWebPixels(admin);
        logger.info(`Found ${result.webPixels.length} web pixels (with pagination)`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error("Error fetching web pixels:", error);
        errors.push({
            stage: "web_pixels",
            message: errorMessage,
            timestamp: new Date(),
        });
    }
    const allScriptContent = collectScriptContent(result);
    result.identifiedPlatforms = detectPlatforms(allScriptContent);
    logger.info(`Identified platforms: ${result.identifiedPlatforms.join(", ") || "none"}`);
    result.duplicatePixels = detectDuplicatePixels(result);
    logger.info(`Duplicate pixels found: ${result.duplicatePixels.length}`);
    result.riskItems = assessRisks(result);
    result.riskScore = calculateRiskScore(result.riskItems);
    logger.info(`Risk assessment complete: score=${result.riskScore}, items=${result.riskItems.length}`);
    result.migrationActions = generateMigrationActions(result, shopTier);
    logger.info(`Generated ${result.migrationActions.length} migration actions`);
    let scanReportId: string | undefined;
    try {
        const sanitizedScriptTags = sanitizeScriptTags(result.scriptTags);
        const savedReport = await prisma.scanReport.create({
            data: {
                id: randomUUID(),
                shopId,
                scriptTags: (safeJsonClone(sanitizedScriptTags) as unknown) as Prisma.InputJsonValue,
                checkoutConfig: result.checkoutConfig ? ((safeJsonClone(result.checkoutConfig) as unknown) as Prisma.InputJsonValue) : undefined,
                identifiedPlatforms: result.identifiedPlatforms,
                riskItems: (safeJsonClone(result.riskItems) as unknown) as Prisma.InputJsonValue,
                riskScore: result.riskScore,
                status: errors.length > 0 ? "completed_with_errors" : "completed",
                errorMessage: errors.length > 0 ? JSON.stringify(errors) : null,
                completedAt: new Date(),
            },
        });
        scanReportId = savedReport.id;
        logger.info(`Scan report saved for shop ${shopId}`, { scanReportId });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error("Error saving scan report:", error);
        throw new Error(`Failed to save scan report: ${errorMessage}`);
    }
    let auditAssetSyncFailed = false;
    try {
        const auditAssets: AuditAssetInput[] = [];
        for (const tag of result.scriptTags) {
            const platforms = detectPlatforms(tag.src || "");
            const platform = platforms[0];
            let riskDetection: ReturnType<typeof detectRisksInContent> | null = null;
            if (tag.src) {
                try {
                    riskDetection = detectRisksInContent(tag.src);
                } catch (error) {
                    logger.warn("Failed to detect risks in ScriptTag", {
                        scriptTagId: tag.id,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
            let riskLevel: "high" | "medium" | "low" = tag.display_scope === "order_status" ? "high" : "medium";
            if (riskDetection) {
                if (riskDetection.detectedIssues.piiAccess ||
                    riskDetection.detectedIssues.windowDocumentAccess ||
                    riskDetection.detectedIssues.blockingLoad) {
                    riskLevel = "high";
                } else if (riskDetection.detectedIssues.duplicateTriggers) {
                    if (riskLevel === "medium") {
                      // no-op: could upgrade to high if desired
                    }
                }
            }
            auditAssets.push({
                sourceType: "api_scan",
                category: platform ? "pixel" : "other",
                platform: platform || undefined,
                displayName: platform
                    ? `ScriptTag: ${platform}`
                    : `ScriptTag #${tag.id}`,
                riskLevel,
                suggestedMigration: "web_pixel",
                details: {
                    scriptTagId: tag.id,
                    scriptTagGid: tag.gid,
                    src: tag.src,
                    displayScope: tag.display_scope,
                    detectedRisks: riskDetection ? {
                        piiAccess: riskDetection.detectedIssues.piiAccess,
                        windowDocumentAccess: riskDetection.detectedIssues.windowDocumentAccess,
                        blockingLoad: riskDetection.detectedIssues.blockingLoad,
                        duplicateTriggers: riskDetection.detectedIssues.duplicateTriggers,
                        riskScore: riskDetection.riskScore,
                    } : undefined,
                },
                scanReportId,
            });
        }
        for (const platform of result.identifiedPlatforms) {
            const hasScriptTag = result.scriptTags.some(tag =>
                detectPlatforms(tag.src || "").includes(platform)
            );
            if (!hasScriptTag) {
                auditAssets.push({
                    sourceType: "api_scan",
                    category: "pixel",
                    platform,
                    displayName: `Detected: ${platform}`,
                    riskLevel: "medium",
                    suggestedMigration: "web_pixel",
                    details: {
                        source: "platform_detection",
                    },
                    scanReportId,
                });
            }
        }
        if (auditAssets.length > 0) {
            const auditResult = await batchCreateAuditAssets(shopId, auditAssets, scanReportId);
            logger.info(`AuditAssets synced from scan`, {
                shopId,
                scanReportId,
                created: auditResult.created,
                updated: auditResult.updated,
            });
            try {
                const { calculatePrioritiesForShop, updateAssetPriority } = await import("./priority-calculator");
                const priorities = await calculatePrioritiesForShop(shopId);
                for (const priorityScore of priorities) {
                    await updateAssetPriority(priorityScore.assetId, priorityScore);
                }
                logger.info(`Priority and time estimates calculated for shop ${shopId}`, {
                    shopId,
                    assetCount: priorities.length,
                });
            } catch (error) {
                logger.error("Failed to calculate priority/time estimates", {
                    shopId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    } catch (error) {
        auditAssetSyncFailed = true;
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error("Failed to sync AuditAssets from scan", { shopId, error: errorMessage });
    }
    if (auditAssetSyncFailed) {
        result._auditAssetSyncFailed = true;
    }
    return result;
}

export async function getScanHistory(
    shopId: string,
    limit: number = 10
): Promise<Awaited<ReturnType<typeof prisma.scanReport.findMany>>> {
    const validLimit = Math.max(1, Math.min(limit, 100));
    return prisma.scanReport.findMany({
        where: { shopId },
        orderBy: { createdAt: "desc" },
        take: validLimit,
    });
}
