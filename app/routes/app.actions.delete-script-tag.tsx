/**
 * Action Route: Delete ScriptTag
 * 
 * POST /app/actions/delete-script-tag
 * 
 * Deletes a ScriptTag using the GraphQL Admin API.
 * Requires write_script_tags scope.
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { deleteScriptTag } from "../services/admin-mutations.server";
import { logger } from "../utils/logger.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);

    if (request.method !== "POST") {
        return json({ success: false, error: "Method not allowed" }, { status: 405 });
    }

    try {
        const formData = await request.formData();
        const scriptTagGid = formData.get("scriptTagGid") as string;
        const scriptTagId = formData.get("scriptTagId") as string;

        // Support both GID and numeric ID
        let gid = scriptTagGid;
        if (!gid && scriptTagId) {
            gid = `gid://shopify/ScriptTag/${scriptTagId}`;
        }

        if (!gid) {
            return json({
                success: false,
                error: "Missing scriptTagGid or scriptTagId",
            }, { status: 400 });
        }

        logger.info(`Attempting to delete ScriptTag`, {
            shop: session.shop,
            scriptTagGid: gid,
        });

        const result = await deleteScriptTag(admin, gid);

        if (result.success) {
            logger.info(`ScriptTag deleted successfully`, {
                shop: session.shop,
                deletedId: result.deletedId,
            });
            return json({
                success: true,
                deletedId: result.deletedId,
                message: "ScriptTag 删除成功",
            });
        }

        // Handle specific error cases
        if (result.userErrors && result.userErrors.length > 0) {
            const firstError = result.userErrors[0];
            
            // Check for common error types
            if (firstError.message.includes("not found")) {
                return json({
                    success: false,
                    error: "ScriptTag 不存在或已被删除",
                    details: result.userErrors,
                }, { status: 404 });
            }

            if (firstError.message.includes("permission") || firstError.message.includes("access")) {
                return json({
                    success: false,
                    error: "缺少删除权限，请确认应用已获得 write_script_tags 权限",
                    details: result.userErrors,
                }, { status: 403 });
            }
        }

        return json({
            success: false,
            error: result.error || "删除失败",
            details: result.userErrors,
        }, { status: 400 });

    } catch (error) {
        logger.error("Delete ScriptTag action error", error);
        return json({
            success: false,
            error: error instanceof Error ? error.message : "服务器错误",
        }, { status: 500 });
    }
};

// Loader to handle non-POST requests
export const loader = async () => {
    return json({ error: "Method not allowed" }, { status: 405 });
};

