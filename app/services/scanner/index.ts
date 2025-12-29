

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../../db.server";
import type { ScanResult, ScriptTag, CheckoutConfig } from "../../types";
import type {
    WebPixelInfo,
    EnhancedScanResult,
    ScanError,
    GraphQLEdge,
    GraphQLPageInfo,
    ScriptAnalysisResult
} from "./types";
import { detectPlatforms, PLATFORM_PATTERNS } from "./patterns";
import { assessRisks, calculateRiskScore } from "./risk-assessment";
import { generateMigrationActions } from "./migration-actions";
import { analyzeScriptContent } from "./content-analysis";
import { refreshTypOspStatus } from "../checkout-profile.server";
import { logger } from "../../utils/logger.server";
import { SCANNER_CONFIG } from "../../utils/config";
import { 
    batchCreateAuditAssets, 
    type AuditAssetInput 
} from "../audit-asset.server";

export type {
    WebPixelInfo,
    EnhancedScanResult,
    MigrationAction,
    ScriptAnalysisResult
} from "./types";
export type { ScanResult, RiskItem } from "../../types";

export { analyzeScriptContent } from "./content-analysis";

/**
 * 扫描功能配置常量
 */
const SCAN_CACHE_TTL_MS = 10 * 60 * 1000; // 10 分钟 - 缓存有效期
const MAX_SCRIPT_TAGS = SCANNER_CONFIG.MAX_SCRIPT_TAGS; // ScriptTags 分页限制 - 防止内存溢出，超过此数量将停止分页
const MAX_WEB_PIXELS = SCANNER_CONFIG.MAX_WEB_PIXELS; // WebPixels 分页限制 - 防止内存溢出，超过此数量将停止分页
const MAX_PAGINATION_ITERATIONS = 50; // 最大分页迭代次数 - 防止无限循环，超过此次数将停止分页

/**
 * 验证 GraphQL 响应中的 edges 数组结构
 */
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

/**
 * 验证 ScriptTag 数据结构
 */
function isValidScriptTag(tag: unknown): tag is ScriptTag {
    if (typeof tag !== "object" || tag === null) {
        return false;
    }
    const t = tag as Record<string, unknown>;
    return (
        typeof t.id === "number" &&
        (typeof t.gid === "string" || t.gid === null || t.gid === undefined) &&
        (typeof t.src === "string" || t.src === null || t.src === undefined) &&
        typeof t.display_scope === "string"
    );
}

/**
 * 验证数组中的 ScriptTag 元素
 */
function validateScriptTagsArray(tags: unknown): ScriptTag[] {
    if (!Array.isArray(tags)) {
        return [];
    }
    return tags.filter(isValidScriptTag);
}

/**
 * 验证 RiskItem 数据结构
 */
function isValidRiskItem(item: unknown): item is import("../../types").RiskItem {
    if (typeof item !== "object" || item === null) {
        return false;
    }
    const r = item as Record<string, unknown>;
    return (
        typeof r.id === "string" &&
        typeof r.name === "string" &&
        typeof r.description === "string" &&
        (r.severity === "high" || r.severity === "medium" || r.severity === "low")
    );
}

/**
 * 验证数组中的 RiskItem 元素
 */
function validateRiskItemsArray(items: unknown): import("../../types").RiskItem[] {
    if (!Array.isArray(items)) {
        return [];
    }
    return items.filter(isValidRiskItem);
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

            let data: any;
            try {
                data = await response.json();
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : "Unknown error";
                logger.error("Failed to parse GraphQL response as JSON:", errorMessage);
                // 返回已获取的数据，而不是空数组
                if (allTags.length > 0) {
                    logger.warn(`Returning ${allTags.length} ScriptTags despite JSON parse error`);
                }
                return allTags;
            }
            
            // 检查 GraphQL 错误
            if (data.errors && data.errors.length > 0) {
                const errorMessage = data.errors[0]?.message || "Unknown GraphQL error";
                logger.error("GraphQL error fetching ScriptTags:", errorMessage);
                // 返回已获取的数据，而不是空数组
                if (allTags.length > 0) {
                    logger.warn(`Returning ${allTags.length} ScriptTags despite errors`);
                }
                return allTags;
            }
            
            // 验证 GraphQL 响应结构
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

            // 检查 cursor 是否变化，防止无限循环
            if (cursor === previousCursor && hasNextPage) {
                logger.warn("ScriptTags pagination cursor did not advance, stopping to avoid loop");
                break;
            }
            
            // 检查返回的数据是否为空但 hasNextPage 为 true（异常情况）
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
        // 返回已获取的数据，而不是空数组
        if (allTags.length > 0) {
            logger.warn(`Returning ${allTags.length} ScriptTags despite error`);
        }
    }

    return allTags;
}

async function fetchAllWebPixels(admin: AdminApiContext): Promise<WebPixelInfo[]> {
    const allPixels: WebPixelInfo[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;
    let previousCursor: string | null = null;
    let iterationCount = 0;

    try {
        while (hasNextPage && iterationCount < MAX_PAGINATION_ITERATIONS) {
            iterationCount++;
            const response = await admin.graphql(`
                query GetWebPixels($cursor: String) {
                    webPixels(first: 50, after: $cursor) {
                        edges {
                            node {
                                id
                                settings
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

            let data: any;
            try {
                data = await response.json();
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : "Unknown error";
                logger.error("Failed to parse GraphQL response as JSON in fetchAllWebPixels:", errorMessage);
                // 返回已获取的数据，而不是空数组
                if (allPixels.length > 0) {
                    logger.warn(`Returning ${allPixels.length} WebPixels despite JSON parse error`);
                }
                return allPixels;
            }
            
            // Check for GraphQL errors (e.g., missing scope or field not available)
            if (data.errors && data.errors.length > 0) {
                const errorMessage = data.errors[0]?.message || "Unknown GraphQL error";
                if (errorMessage.includes("doesn't exist") || errorMessage.includes("access")) {
                    logger.warn("WebPixels API not available (may need to reinstall app for read_pixels scope):", errorMessage);
                } else {
                    logger.error("GraphQL error fetching WebPixels:", errorMessage);
                }
                return allPixels; // Return empty array gracefully
            }
            
            // 验证 GraphQL 响应结构
            const webPixelsData = data.data?.webPixels;
            if (!webPixelsData || typeof webPixelsData !== "object") {
                logger.warn("Invalid GraphQL response structure for webPixels");
                return allPixels;
            }

            const edges = webPixelsData.edges;
            if (!validateGraphQLEdges<WebPixelInfo>(edges)) {
                logger.warn("Invalid edges structure in webPixels GraphQL response");
                return allPixels;
            }

            let pageInfo: GraphQLPageInfo = webPixelsData.pageInfo || { hasNextPage: false, endCursor: null };
            if (typeof pageInfo !== "object" || pageInfo === null) {
                logger.warn("Invalid pageInfo structure in webPixels, using defaults");
                pageInfo = { hasNextPage: false, endCursor: null };
            }

            for (const edge of edges) {
                allPixels.push({
                    id: edge.node.id,
                    settings: edge.node.settings,
                });
            }

            hasNextPage = pageInfo.hasNextPage;
            cursor = pageInfo.endCursor;

            // 检查 cursor 是否变化，防止无限循环
            if (cursor === previousCursor && hasNextPage) {
                logger.warn("WebPixels pagination cursor did not advance, stopping to avoid loop");
                break;
            }
            
            // 检查返回的数据是否为空但 hasNextPage 为 true（异常情况）
            if (edges.length === 0 && hasNextPage) {
                logger.warn("Received empty edges but hasNextPage is true, stopping to avoid infinite loop");
                break;
            }
            
            previousCursor = cursor;

            if (allPixels.length >= MAX_WEB_PIXELS) {
                logger.warn(`WebPixels pagination limit reached (${MAX_WEB_PIXELS})`);
                break;
            }
        }
        
        if (iterationCount >= MAX_PAGINATION_ITERATIONS) {
            logger.warn(`WebPixels pagination reached max iterations (${MAX_PAGINATION_ITERATIONS})`);
        }
    } catch (error) {
        // Log but don't throw - return empty array to avoid breaking other functionality
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes("doesn't exist") || errorMessage.includes("access")) {
            logger.warn("WebPixels API call failed (scope issue, app may need reinstall):", errorMessage);
        } else {
            logger.error("Failed to fetch WebPixels (paginated):", error);
        }
    }

    return allPixels;
}

function collectScriptContent(result: EnhancedScanResult): string {
    // 使用数组 join 代替字符串拼接，性能更好
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

        // Meta Pixel ID 检测：需要更严格的上下文检查
        const metaMatch = src.match(/\b(\d{15,16})\b/);
        if (metaMatch) {
            // 加强上下文检查：必须包含 Meta/Facebook 相关关键词
            const hasMetaContext = src.includes("facebook") || 
                                   src.includes("fbq") || 
                                   src.includes("connect.facebook") ||
                                   src.includes("fbevents") ||
                                   src.includes("facebook.net");
            
            if (hasMetaContext) {
                const pixelId = metaMatch[1];
                // 额外验证：Meta Pixel ID 通常是 15 或 16 位数字
                if (pixelId.length === 15 || pixelId.length === 16) {
                    const key = `meta:${pixelId}`;
                    if (!platformIdentifiers[key]) {
                        platformIdentifiers[key] = { sources: [], platform: "meta" };
                    }
                    platformIdentifiers[key].sources.push(`scripttag_${tag.id}_${tag.gid || ""}`);
                }
            }
        }

        // TikTok Pixel Code 检测：需要更严格的上下文检查
        const tiktokMatch = src.match(/[A-Z0-9]{20,}/i);
        if (tiktokMatch) {
            // 加强上下文检查：必须包含 TikTok 相关关键词
            const hasTiktokContext = src.includes("tiktok") || 
                                     src.includes("ttq") ||
                                     src.includes("analytics.tiktok") ||
                                     src.includes("tiktok.com");
            
            if (hasTiktokContext) {
                const pixelCode = tiktokMatch[0];
                // 额外验证：TikTok Pixel Code 通常是 20-30 位字符，且不包含 URL
                if (pixelCode.length >= 20 && pixelCode.length <= 30 && !pixelCode.includes("://")) {
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
        // 类型安全：pixel.settings 可能是 string | null
        if (!pixel.settings) continue;
        
        let settings: Record<string, unknown>;
        try {
            settings = typeof pixel.settings === "string"
                ? JSON.parse(pixel.settings)
                : (pixel.settings as Record<string, unknown>);

            for (const [settingKey, value] of Object.entries(settings as Record<string, unknown>)) {
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

                // Meta Pixel ID：需要设置键名包含 pixel 或 meta 相关关键词
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

                // TikTok Pixel Code：需要设置键名包含 pixel 或 tiktok 相关关键词
                else if (/^[A-Z0-9]{20,30}$/i.test(value) && 
                        !value.includes("://") &&
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
            logger.warn(`Failed to parse pixel settings for pixel ${pixel.id} in detectDuplicatePixels:`, errorMessage);
            // 继续处理其他像素，不中断整个检测流程
            continue;
        }
    }

    // 处理所有收集到的平台标识符，检测重复
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

// saveScanReport logic has been inlined into scanShopTracking to support AuditAsset sync

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
    });

    if (!cached || !cached.completedAt) {
        return null;
    }

    if (!isScanCacheValid(cached.completedAt, ttlMs)) {
        logger.debug(`Scan cache expired for shop ${shopId}, age: ${Date.now() - cached.completedAt.getTime()}ms`);
        return null;
    }

    logger.debug(`Using cached scan result for shop ${shopId}, age: ${Date.now() - cached.completedAt.getTime()}ms`);

    return {
        scriptTags: (cached.scriptTags as ScriptTag[] | null) || [],
        checkoutConfig: (cached.checkoutConfig as CheckoutConfig | null) || null,
        identifiedPlatforms: (cached.identifiedPlatforms as string[]) || [],
        additionalScriptsPatterns: [],
        riskItems: (cached.riskItems as ScanResult["riskItems"] | null) || [],
        riskScore: cached.riskScore || 0,
        webPixels: [],
        duplicatePixels: [],
        migrationActions: [],
        _cachedAt: cached.completedAt, // Bug #4 修复: 记录缓存时间
    };
}

export async function scanShopTracking(
    admin: AdminApiContext,
    shopId: string,
    options: { force?: boolean; cacheTtlMs?: number } = {}
): Promise<EnhancedScanResult> {
    const { force = false, cacheTtlMs = SCAN_CACHE_TTL_MS } = options;

    const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: { shopTier: true }
    });
    const shopTier = shop?.shopTier || "unknown";

    // Bug #4 修复: 改进缓存策略，缩短TTL并添加强制刷新选项
    // 对于关键操作（如迁移前），应该使用 force=true 强制刷新
    if (!force) {
        const cached = await getCachedScanResult(shopId, cacheTtlMs);
        if (cached) {
            // 检查缓存是否可能过期（scriptTags可能在缓存期间被修改）
            // 如果缓存超过5分钟，建议强制刷新（但这里只刷新webPixels）
            const cacheAge = Date.now() - (cached._cachedAt?.getTime() || 0);
            const shouldRefreshScriptTags = cacheAge > 5 * 60 * 1000; // 5分钟
            
            let refreshFailed = false;
            try {
                // 总是刷新webPixels（变化较快）
                cached.webPixels = await fetchAllWebPixels(admin);
                cached.duplicatePixels = detectDuplicatePixels(cached);
                cached.migrationActions = generateMigrationActions(cached, shopTier);
                
                // 如果缓存较旧，标记为部分刷新，建议用户手动刷新
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
                // 清空可能过时的字段，避免显示不准确的数据
                cached.webPixels = [];
                cached.duplicatePixels = [];
                cached.migrationActions = [];
                // 标记为部分刷新
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
        // 安全的 JSON 序列化函数，处理循环引用和不可序列化的值
        function safeJsonClone<T>(obj: T): T {
            try {
                return JSON.parse(JSON.stringify(obj)) as T;
            } catch (error) {
                logger.warn("Failed to clone object for database storage, using original:", error instanceof Error ? error.message : String(error));
                // 返回原始对象，让 Prisma 处理序列化
                return obj;
            }
        }

        const savedReport = await prisma.scanReport.create({
            data: {
                shopId,
                scriptTags: safeJsonClone(result.scriptTags),
                checkoutConfig: result.checkoutConfig ? safeJsonClone(result.checkoutConfig) : undefined,
                identifiedPlatforms: result.identifiedPlatforms,
                riskItems: safeJsonClone(result.riskItems),
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

    // 同步扫描结果到 AuditAsset 表
    let auditAssetSyncFailed = false;
    try {
        const auditAssets: AuditAssetInput[] = [];
        
        // 从 ScriptTags 创建 AuditAssets
        for (const tag of result.scriptTags) {
            const platforms = detectPlatforms(tag.src || "");
            const platform = platforms[0]; // 使用检测到的第一个平台
            
            auditAssets.push({
                sourceType: "api_scan",
                category: platform ? "pixel" : "other",
                platform: platform || undefined,
                displayName: platform 
                    ? `ScriptTag: ${platform}` 
                    : `ScriptTag #${tag.id}`,
                riskLevel: tag.display_scope === "order_status" ? "high" : "medium",
                suggestedMigration: "web_pixel",
                details: {
                    scriptTagId: tag.id,
                    scriptTagGid: tag.gid,
                    src: tag.src,
                    displayScope: tag.display_scope,
                },
                scanReportId,
            });
        }
        
        // 从识别到的平台创建 AuditAssets（如果还没有对应的 ScriptTag）
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
        }
    } catch (error) {
        // AuditAsset 同步失败不应阻止扫描完成，但标记为失败
        auditAssetSyncFailed = true;
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error("Failed to sync AuditAssets from scan", { shopId, error: errorMessage });
    }
    
    // 如果 AuditAsset 同步失败，在结果中标记
    if (auditAssetSyncFailed) {
        result._auditAssetSyncFailed = true;
    }

    return result;
}

/**
 * 获取扫描历史记录
 * @param shopId - 店铺 ID
 * @param limit - 返回记录数量限制，默认 10，范围 1-100
 * @returns 扫描报告数组，按创建时间降序排列
 */
export async function getScanHistory(
    shopId: string,
    limit: number = 10
): Promise<Awaited<ReturnType<typeof prisma.scanReport.findMany>>> {
    // 验证并限制 limit 参数范围，防止过大或负值
    const validLimit = Math.max(1, Math.min(limit, 100));
    
    return prisma.scanReport.findMany({
        where: { shopId },
        orderBy: { createdAt: "desc" },
        take: validLimit,
    });
}
