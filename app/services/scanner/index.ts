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
import { logger } from "../../utils/logger";

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
 * Detect duplicate pixels across script tags and web pixels
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
    const platformCounts: Record<string, string[]> = {};

    // Check script tags
    for (const tag of result.scriptTags) {
        const src = tag.src || "";
        for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
            for (const pattern of patterns) {
                if (pattern.test(src)) {
                    if (!platformCounts[platform]) {
                        platformCounts[platform] = [];
                    }
                    platformCounts[platform].push(`scripttag_${tag.id}`);
                    break;
                }
            }
        }
    }

    // Check web pixels
    for (const pixel of result.webPixels) {
        if (pixel.settings) {
            try {
                const settings = typeof pixel.settings === "string"
                    ? JSON.parse(pixel.settings)
                    : pixel.settings;

                for (const [key, value] of Object.entries(settings as Record<string, unknown>)) {
                    if (typeof value === "string") {
                        if (/^G-[A-Z0-9]+$/.test(value) || /^AW-\d+$/.test(value)) {
                            if (!platformCounts["google"]) platformCounts["google"] = [];
                            platformCounts["google"].push(`webpixel_${pixel.id}_${key}`);
                        } else if (/^\d{15,16}$/.test(value)) {
                            if (!platformCounts["meta"]) platformCounts["meta"] = [];
                            platformCounts["meta"].push(`webpixel_${pixel.id}_${key}`);
                        }
                    }
                }
            } catch {
                // Ignore parse errors
            }
        }
    }

    // Find duplicates
    for (const [platform, ids] of Object.entries(platformCounts)) {
        if (ids.length > 1) {
            duplicates.push({ platform, count: ids.length, ids });
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

/**
 * Main scan function - scans shop for tracking scripts and generates report
 */
export async function scanShopTracking(admin: AdminApiContext, shopId: string): Promise<EnhancedScanResult> {
    const errors: ScanError[] = [];
    const result: EnhancedScanResult = {
        scriptTags: [],
        checkoutConfig: null,
        identifiedPlatforms: [],
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
    result.migrationActions = generateMigrationActions(result);
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

