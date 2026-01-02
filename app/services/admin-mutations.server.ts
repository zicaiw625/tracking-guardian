

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { logger } from "../utils/logger.server";

export interface MutationResult {
    success: boolean;
    deletedId?: string;
    error?: string;
    userErrors?: Array<{
        field: string[];
        message: string;
    }>;
}

export async function deleteWebPixel(
    admin: AdminApiContext,
    webPixelGid: string
): Promise<MutationResult> {

    if (!webPixelGid.startsWith("gid://")) {
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

