import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { deleteWebPixel, deleteMultipleWebPixels } from "../services/admin-mutations.server";
import { logger } from "../utils/logger.server";
import { i18nServer } from "../i18n.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const t = await i18nServer.getFixedT(request);
    const { admin, session } = await authenticate.admin(request);
    if (request.method !== "POST") {
        return json({ success: false, error: "Method not allowed" }, { status: 405 });
    }
    try {
        const formData = await request.formData();
        const webPixelGid = formData.get("webPixelGid") as string;
        const webPixelGids = formData.get("webPixelGids") as string;
        const keepFirst = formData.get("keepFirst") === "true";
        if (webPixelGids) {
            let gids: string[];
            try {
                gids = JSON.parse(webPixelGids);
            } catch {
                return json({
                    success: false,
                    error: "Invalid webPixelGids format - expected JSON array",
                }, { status: 400 });
            }
            if (!Array.isArray(gids) || gids.length === 0) {
                return json({
                    success: false,
                    error: "webPixelGids must be a non-empty array",
                }, { status: 400 });
            }
            logger.info(`Attempting to delete ${gids.length} WebPixels (keepFirst=${keepFirst})`, {
                shop: session.shop,
                count: gids.length,
            });
            const { kept, results } = await deleteMultipleWebPixels(admin, gids, keepFirst);
            const successCount = results.filter(r => r.success).length;
            const failures = results.filter(r => !r.success);
            return json({
                success: failures.length === 0,
                keptPixelGid: kept,
                deletedCount: successCount,
                totalAttempted: results.length,
                failures: failures.length > 0 ? failures : undefined,
                message: kept 
                    ? t("scan.success.deletePartialWithKept", { success: successCount, total: results.length, kept })
                    : t("scan.success.deletePartial", { success: successCount, total: results.length }),
            });
        }
        if (!webPixelGid) {
            return json({
                success: false,
                error: "Missing webPixelGid",
            }, { status: 400 });
        }
        logger.info(`Attempting to delete WebPixel`, {
            shop: session.shop,
            webPixelGid,
        });
        const result = await deleteWebPixel(admin, webPixelGid);
        if (result.success) {
            logger.info(`WebPixel deleted successfully`, {
                shop: session.shop,
                deletedId: result.deletedId,
            });
            return json({
                success: true,
                deletedId: result.deletedId,
                message: t("scan.success.deleteSuccess"),
            });
        }
        if (result.userErrors && result.userErrors.length > 0) {
            const firstError = result.userErrors[0];
            if (firstError.message.includes("not found")) {
                return json({
                    success: false,
                    error: t("scan.errors.webPixelNotFoundOrDeleted"),
                    details: result.userErrors,
                }, { status: 404 });
            }
            if (firstError.message.includes("permission") || firstError.message.includes("access")) {
                return json({
                    success: false,
                    error: t("scan.errors.deletePermissionDenied"),
                    details: result.userErrors,
                }, { status: 403 });
            }
        }
        return json({
            success: false,
            error: result.error || t("scan.errors.deleteFailed"),
            details: result.userErrors,
        }, { status: 400 });
    } catch (error) {
        logger.error("Delete WebPixel action error", error);
        return json({
            success: false,
            error: error instanceof Error ? error.message : t("common.serverError"),
        }, { status: 500 });
    }
};

export const loader = async () => {
    return json({ error: "Method not allowed" }, { status: 405 });
};
