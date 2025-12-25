// Scanner module - main entry point

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

// Re-export types
export type { 
    WebPixelInfo, 
    EnhancedScanResult, 
    MigrationAction, 
    ScriptAnalysisResult 
} from "./types";
export type { ScanResult, RiskItem } from "../../types";

// Re-export functions
export { analyzeScriptContent } from "./content-analysis";

/**
 * Fetch all script tags with pagination
 */
async function fetchAllScriptTags(admin: AdminApiContext): Promise<ScriptTag[]> {
    const allTags: ScriptTag[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;

    while (hasNextPage) {
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

        const data = await response.json();
        const edges = data.data?.scriptTags?.edges || [];
        const pageInfo: GraphQLPageInfo = data.data?.scriptTags?.pageInfo || { hasNextPage: false, endCursor: null };

        for (const edge of edges as GraphQLEdge<{
            id: string;
            src: string;
            displayScope: string;
            cache: boolean;
            createdAt: string;
            updatedAt: string;
        }>[]) {
            const gidMatch = edge.node.id.match(/ScriptTag\/(\d+)/);
            const numericId = gidMatch ? parseInt(gidMatch[1], 10) : 0;
            allTags.push({
                id: numericId,
                gid: edge.node.id, // Preserve original GID for mutations
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

        if (allTags.length > 1000) {
            logger.warn("ScriptTags pagination limit reached (1000)");
            break;
        }
    }

    return allTags;
}

/**
 * Fetch all web pixels with pagination
 */
async function fetchAllWebPixels(admin: AdminApiContext): Promise<WebPixelInfo[]> {
    const allPixels: WebPixelInfo[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;

    while (hasNextPage) {
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

        const data = await response.json();
        const edges = data.data?.webPixels?.edges || [];
        const pageInfo: GraphQLPageInfo = data.data?.webPixels?.pageInfo || { hasNextPage: false, endCursor: null };

        for (const edge of edges as GraphQLEdge<WebPixelInfo>[]) {
            allPixels.push({
                id: edge.node.id,
                settings: edge.node.settings,
            });
        }

        hasNextPage = pageInfo.hasNextPage;
        cursor = pageInfo.endCursor;

        if (allPixels.length > 200) {
            logger.warn("WebPixels pagination limit reached (200)");
            break;
        }
    }

    return allPixels;
}

/**
 * Collect script content from tags for analysis
 */
function collectScriptContent(result: EnhancedScanResult): string {
    let content = "";
    for (const tag of result.scriptTags) {
        content += ` ${tag.src || ""} ${tag.event || ""}`;
    }
    return content;
}

/**
 * P1-05: Improved duplicate pixel detection
 * 
 * Detects duplicates based on:
 * 1. Same platform AND same identifier (e.g., same GA4 Measurement ID)
 * 2. Ignores cross-application pixels (only flags duplicates within same platform type)
 */
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
    
    // Track by platform AND identifier for more precise duplicate detection
    // Key format: "{platform}:{identifier}" -> list of sources
    const platformIdentifiers: Record<string, { sources: string[]; platform: string }> = {};

    // Check script tags - extract actual identifiers
    for (const tag of result.scriptTags) {
        const src = tag.src || "";
        
        // Google (GA4 or Google Ads)
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
        
        // Meta Pixel ID
        const metaMatch = src.match(/\b(\d{15,16})\b/);
        if (metaMatch && (src.includes("facebook") || src.includes("fbq") || src.includes("connect.facebook"))) {
            const key = `meta:${metaMatch[1]}`;
            if (!platformIdentifiers[key]) {
                platformIdentifiers[key] = { sources: [], platform: "meta" };
            }
            platformIdentifiers[key].sources.push(`scripttag_${tag.id}_${tag.gid || ""}`);
        }
        
        // TikTok Pixel ID
        const tiktokMatch = src.match(/[A-Z0-9]{20,}/i);
        if (tiktokMatch && (src.includes("tiktok") || src.includes("ttq"))) {
            const key = `tiktok:${tiktokMatch[0]}`;
            if (!platformIdentifiers[key]) {
                platformIdentifiers[key] = { sources: [], platform: "tiktok" };
            }
            platformIdentifiers[key].sources.push(`scripttag_${tag.id}_${tag.gid || ""}`);
        }
    }

    // Check web pixels - extract identifiers from settings
    for (const pixel of result.webPixels) {
        if (pixel.settings) {
            try {
                const settings = typeof pixel.settings === "string"
                    ? JSON.parse(pixel.settings)
                    : pixel.settings;

                // Check for explicit platform identifiers in settings
                for (const [settingKey, value] of Object.entries(settings as Record<string, unknown>)) {
                    if (typeof value !== "string") continue;
                    
                    // GA4 Measurement ID
                    if (/^G-[A-Z0-9]+$/.test(value)) {
                        const key = `google:${value}`;
                        if (!platformIdentifiers[key]) {
                            platformIdentifiers[key] = { sources: [], platform: "google" };
                        }
                        platformIdentifiers[key].sources.push(`webpixel_${pixel.id}_${settingKey}`);
                    }
                    // Google Ads
                    else if (/^AW-\d+$/.test(value)) {
                        const key = `google_ads:${value}`;
                        if (!platformIdentifiers[key]) {
                            platformIdentifiers[key] = { sources: [], platform: "google" };
                        }
                        platformIdentifiers[key].sources.push(`webpixel_${pixel.id}_${settingKey}`);
                    }
                    // Meta Pixel ID (15-16 digits)
                    else if (/^\d{15,16}$/.test(value)) {
                        const key = `meta:${value}`;
                        if (!platformIdentifiers[key]) {
                            platformIdentifiers[key] = { sources: [], platform: "meta" };
                        }
                        platformIdentifiers[key].sources.push(`webpixel_${pixel.id}_${settingKey}`);
                    }
                    // TikTok Pixel ID
                    else if (/^[A-Z0-9]{20,}$/i.test(value) && !value.includes("://")) {
                        const key = `tiktok:${value}`;
                        if (!platformIdentifiers[key]) {
                            platformIdentifiers[key] = { sources: [], platform: "tiktok" };
                        }
                        platformIdentifiers[key].sources.push(`webpixel_${pixel.id}_${settingKey}`);
                    }
                }
            } catch {
                // Ignore parse errors
            }
        }
    }

    // Find duplicates - only flag if same identifier appears multiple times
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

/**
 * Save scan report to database
 */
async function saveScanReport(shopId: string, result: ScanResult, errorMessage: string | null = null): Promise<void> {
    await prisma.scanReport.create({
        data: {
            shopId,
            scriptTags: JSON.parse(JSON.stringify(result.scriptTags)),
            checkoutConfig: result.checkoutConfig ? JSON.parse(JSON.stringify(result.checkoutConfig)) : undefined,
            identifiedPlatforms: result.identifiedPlatforms,
            riskItems: JSON.parse(JSON.stringify(result.riskItems)),
            riskScore: result.riskScore,
            status: errorMessage ? "completed_with_errors" : "completed",
            errorMessage,
            completedAt: new Date(),
        },
    });
}

// =============================================================================
// P2-2: Scan Caching Configuration
// =============================================================================

/**
 * Default cache TTL in milliseconds (10 minutes)
 */
const SCAN_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Check if a cached scan result is still valid
 */
function isScanCacheValid(cachedAt: Date, ttlMs: number = SCAN_CACHE_TTL_MS): boolean {
    const now = Date.now();
    const cacheAge = now - cachedAt.getTime();
    return cacheAge < ttlMs;
}

/**
 * P2-2: Get cached scan result if available and valid
 * @returns The cached result or null if cache is expired/missing
 */
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

    // Reconstruct EnhancedScanResult from cached data
    return {
        scriptTags: (cached.scriptTags as ScriptTag[] | null) || [],
        checkoutConfig: (cached.checkoutConfig as CheckoutConfig | null) || null,
        identifiedPlatforms: (cached.identifiedPlatforms as string[]) || [],
        additionalScriptsPatterns: [], // Not stored in DB to avoid PII
        riskItems: (cached.riskItems as ScanResult["riskItems"] | null) || [],
        riskScore: cached.riskScore || 0,
        webPixels: [], // Web pixels need to be re-fetched for freshness
        duplicatePixels: [],
        migrationActions: [], // Will be regenerated
    };
}

/**
 * Main scan function - scans shop for tracking scripts and generates report
 * 
 * P2-2: Supports caching - use `force: true` to bypass cache
 */
export async function scanShopTracking(
    admin: AdminApiContext, 
    shopId: string,
    options: { force?: boolean; cacheTtlMs?: number } = {}
): Promise<EnhancedScanResult> {
    const { force = false, cacheTtlMs = SCAN_CACHE_TTL_MS } = options;

    // Fetch shop tier for migration actions
    const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: { shopTier: true }
    });
    const shopTier = shop?.shopTier || "unknown";

    // P2-2: Check cache unless force refresh is requested
    if (!force) {
        const cached = await getCachedScanResult(shopId, cacheTtlMs);
        if (cached) {
            // Re-fetch web pixels for freshness (they change more frequently)
            try {
                cached.webPixels = await fetchAllWebPixels(admin);
                cached.duplicatePixels = detectDuplicatePixels(cached);
                cached.migrationActions = generateMigrationActions(cached, shopTier);
                logger.info(`Returning cached scan with fresh web pixels for shop ${shopId}`);
            } catch (error) {
                logger.warn(`Failed to refresh web pixels for cached scan: ${error}`);
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

    // Refresh TYP/OSP status
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

    // Fetch script tags
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

    // Fetch checkout config
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

    // Fetch web pixels
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

    // Analyze content and detect platforms
    const allScriptContent = collectScriptContent(result);
    result.identifiedPlatforms = detectPlatforms(allScriptContent);
    logger.info(`Identified platforms: ${result.identifiedPlatforms.join(", ") || "none"}`);

    // Detect duplicates
    result.duplicatePixels = detectDuplicatePixels(result);
    logger.info(`Duplicate pixels found: ${result.duplicatePixels.length}`);

    // Assess risks
    result.riskItems = assessRisks(result);
    result.riskScore = calculateRiskScore(result.riskItems);
    logger.info(`Risk assessment complete: score=${result.riskScore}, items=${result.riskItems.length}`);

    // Generate migration actions
    result.migrationActions = generateMigrationActions(result, shopTier);
    logger.info(`Generated ${result.migrationActions.length} migration actions`);

    // Save report
    try {
        await saveScanReport(shopId, result, errors.length > 0 ? JSON.stringify(errors) : null);
        logger.info(`Scan report saved for shop ${shopId}`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error("Error saving scan report:", error);
        throw new Error(`Failed to save scan report: ${errorMessage}`);
    }

    return result;
}

/**
 * Get scan history for a shop
 */
export async function getScanHistory(shopId: string, limit = 10) {
    return prisma.scanReport.findMany({
        where: { shopId },
        orderBy: { createdAt: "desc" },
        take: limit,
    });
}

