/**
 * Admin Mutations Service
 * 
 * GraphQL mutations for managing ScriptTags and WebPixels.
 */

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { logger } from "../utils/logger.server";

// =============================================================================
// Types
// =============================================================================

export interface MutationResult {
    success: boolean;
    deletedId?: string;
    error?: string;
    userErrors?: Array<{
        field: string[];
        message: string;
    }>;
}

// =============================================================================
// ScriptTag Mutations
// =============================================================================

/**
 * Delete a ScriptTag by its GraphQL global ID.
 * 
 * Requires `write_script_tags` scope.
 * 
 * @param admin - Admin API context
 * @param scriptTagGid - GraphQL global ID (e.g., "gid://shopify/ScriptTag/123")
 * @returns MutationResult with success status and any errors
 */
export async function deleteScriptTag(
    admin: AdminApiContext,
    scriptTagGid: string
): Promise<MutationResult> {
    // Validate GID format
    if (!scriptTagGid.startsWith("gid://shopify/ScriptTag/")) {
        return {
            success: false,
            error: `Invalid ScriptTag GID format: ${scriptTagGid}`,
        };
    }

    try {
        const response = await admin.graphql(`
            mutation ScriptTagDelete($id: ID!) {
                scriptTagDelete(id: $id) {
                    deletedScriptTagId
                    userErrors {
                        field
                        message
                    }
                }
            }
        `, {
            variables: { id: scriptTagGid },
        });

        const result = await response.json();
        const data = result.data?.scriptTagDelete;

        if (data?.userErrors && data.userErrors.length > 0) {
            const errorMessages = data.userErrors.map((e: { message: string }) => e.message).join(", ");
            logger.warn(`ScriptTag deletion failed for ${scriptTagGid}`, {
                userErrors: data.userErrors,
            });
            return {
                success: false,
                userErrors: data.userErrors,
                error: errorMessages,
            };
        }

        if (data?.deletedScriptTagId) {
            logger.info(`ScriptTag deleted successfully: ${data.deletedScriptTagId}`);
            return {
                success: true,
                deletedId: data.deletedScriptTagId,
            };
        }

        // Handle GraphQL-level errors
        const graphqlResult = result as { errors?: Array<{ message: string }> };
        if (graphqlResult.errors && graphqlResult.errors.length > 0) {
            const errorMessages = graphqlResult.errors.map((e) => e.message).join(", ");
            logger.error(`GraphQL errors during ScriptTag deletion`, { errors: graphqlResult.errors });
            return {
                success: false,
                error: errorMessages,
            };
        }

        return {
            success: false,
            error: "Unexpected response from Shopify API",
        };
    } catch (error) {
        logger.error(`Failed to delete ScriptTag ${scriptTagGid}`, error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

// =============================================================================
// WebPixel Mutations
// =============================================================================

/**
 * Delete a WebPixel by its GraphQL global ID.
 * 
 * Requires `write_pixels` scope.
 * 
 * @param admin - Admin API context
 * @param webPixelGid - GraphQL global ID (e.g., "gid://shopify/WebPixel/123")
 * @returns MutationResult with success status and any errors
 */
export async function deleteWebPixel(
    admin: AdminApiContext,
    webPixelGid: string
): Promise<MutationResult> {
    // Validate GID format
    if (!webPixelGid.startsWith("gid://shopify/WebPixel/")) {
        return {
            success: false,
            error: `Invalid WebPixel GID format: ${webPixelGid}`,
        };
    }

    try {
        const response = await admin.graphql(`
            mutation WebPixelDelete($id: ID!) {
                webPixelDelete(id: $id) {
                    deletedWebPixelId
                    userErrors {
                        field
                        message
                    }
                }
            }
        `, {
            variables: { id: webPixelGid },
        });

        const result = await response.json();
        const data = result.data?.webPixelDelete;

        if (data?.userErrors && data.userErrors.length > 0) {
            const errorMessages = data.userErrors.map((e: { message: string }) => e.message).join(", ");
            logger.warn(`WebPixel deletion failed for ${webPixelGid}`, {
                userErrors: data.userErrors,
            });
            return {
                success: false,
                userErrors: data.userErrors,
                error: errorMessages,
            };
        }

        if (data?.deletedWebPixelId) {
            logger.info(`WebPixel deleted successfully: ${data.deletedWebPixelId}`);
            return {
                success: true,
                deletedId: data.deletedWebPixelId,
            };
        }

        // Handle GraphQL-level errors
        const graphqlResult = result as { errors?: Array<{ message: string }> };
        if (graphqlResult.errors && graphqlResult.errors.length > 0) {
            const errorMessages = graphqlResult.errors.map((e) => e.message).join(", ");
            logger.error(`GraphQL errors during WebPixel deletion`, { errors: graphqlResult.errors });
            return {
                success: false,
                error: errorMessages,
            };
        }

        return {
            success: false,
            error: "Unexpected response from Shopify API",
        };
    } catch (error) {
        logger.error(`Failed to delete WebPixel ${webPixelGid}`, error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

/**
 * Delete multiple WebPixels, keeping one (for deduplication).
 * 
 * @param admin - Admin API context
 * @param webPixelGids - Array of WebPixel GIDs to delete
 * @param keepFirst - If true, keeps the first pixel and deletes the rest
 * @returns Array of MutationResults
 */
export async function deleteMultipleWebPixels(
    admin: AdminApiContext,
    webPixelGids: string[],
    keepFirst: boolean = true
): Promise<{ kept?: string; results: MutationResult[] }> {
    if (webPixelGids.length === 0) {
        return { results: [] };
    }

    const gidsToDelete = keepFirst ? webPixelGids.slice(1) : webPixelGids;
    const kept = keepFirst ? webPixelGids[0] : undefined;

    const results: MutationResult[] = [];
    
    for (const gid of gidsToDelete) {
        const result = await deleteWebPixel(admin, gid);
        results.push(result);
        
        // Add small delay between deletions to avoid rate limiting
        if (gidsToDelete.indexOf(gid) < gidsToDelete.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    logger.info(`Deleted ${successCount}/${gidsToDelete.length} duplicate WebPixels`, {
        kept,
        failCount,
    });

    return { kept, results };
}

