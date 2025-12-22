/**
 * Action Route: Upgrade WebPixel Settings
 * 
 * POST /app/actions/upgrade-web-pixel
 * 
 * Upgrades a WebPixel's settings to the latest schema version.
 * Handles migration from ingestion_secret to ingestion_key and adds missing fields.
 * 
 * P1-02: WebPixel settings schema upgrade action
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { 
    upgradeWebPixelSettings, 
    getExistingWebPixels, 
    isOurWebPixel, 
    needsSettingsUpgrade 
} from "../services/migration.server";
import { getShopWithDecryptedFields } from "../utils/shop-access";
import { logger } from "../utils/logger";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);

    if (request.method !== "POST") {
        return json({ success: false, error: "Method not allowed" }, { status: 405 });
    }

    try {
        const formData = await request.formData();
        const webPixelGid = formData.get("webPixelGid") as string;

        // Get shop data with decrypted ingestion key
        const shop = await getShopWithDecryptedFields(session.shop);
        if (!shop) {
            return json({
                success: false,
                error: "店铺信息未找到",
            }, { status: 404 });
        }

        // Get backend URL
        const backendUrl = process.env.SHOPIFY_APP_URL || "https://tracking-guardian.onrender.com";

        // ingestionSecret is already decrypted by getShopWithDecryptedFields
        const ingestionKey = shop.ingestionSecret;
        if (!ingestionKey) {
            return json({
                success: false,
                error: "店铺未配置 ingestion key",
            }, { status: 400 });
        }

        // If specific GID provided, upgrade that pixel
        if (webPixelGid) {
            // Fetch current settings
            const webPixels = await getExistingWebPixels(admin);
            const targetPixel = webPixels.find(p => p.id === webPixelGid);

            if (!targetPixel) {
                return json({
                    success: false,
                    error: "WebPixel 未找到",
                }, { status: 404 });
            }

            let currentSettings: unknown = null;
            if (targetPixel.settings) {
                try {
                    currentSettings = JSON.parse(targetPixel.settings);
                } catch {
                    return json({
                        success: false,
                        error: "无法解析当前 Pixel 配置",
                    }, { status: 400 });
                }
            }

            if (!isOurWebPixel(currentSettings)) {
                return json({
                    success: false,
                    error: "此 WebPixel 不属于 Tracking Guardian",
                }, { status: 400 });
            }

            if (!needsSettingsUpgrade(currentSettings)) {
                return json({
                    success: true,
                    message: "Pixel 配置已是最新版本",
                    alreadyUpToDate: true,
                });
            }

            logger.info(`Upgrading WebPixel settings`, {
                shop: session.shop,
                webPixelGid,
            });

            const result = await upgradeWebPixelSettings(
                admin,
                webPixelGid,
                currentSettings,
                session.shop,
                ingestionKey,
                backendUrl
            );

            if (result.success) {
                logger.info(`WebPixel settings upgraded successfully`, {
                    shop: session.shop,
                    webPixelId: result.webPixelId,
                });
                return json({
                    success: true,
                    webPixelId: result.webPixelId,
                    message: "Pixel 配置升级成功",
                });
            }

            return json({
                success: false,
                error: result.error || "升级失败",
                userErrors: result.userErrors,
            }, { status: 400 });
        }

        // No specific GID - find and upgrade all our pixels that need it
        const webPixels = await getExistingWebPixels(admin);
        const pixelsToUpgrade: Array<{ id: string; settings: unknown }> = [];

        for (const pixel of webPixels) {
            if (!pixel.settings) continue;
            
            try {
                const settings = JSON.parse(pixel.settings);
                if (isOurWebPixel(settings, session.shop) && needsSettingsUpgrade(settings)) {
                    pixelsToUpgrade.push({ id: pixel.id, settings });
                }
            } catch {
                // Skip pixels with invalid settings
            }
        }

        if (pixelsToUpgrade.length === 0) {
            return json({
                success: true,
                message: "没有需要升级的 Pixel 配置",
                upgraded: 0,
            });
        }

        logger.info(`Upgrading ${pixelsToUpgrade.length} WebPixel(s)`, {
            shop: session.shop,
        });

        const results: Array<{ id: string; success: boolean; error?: string }> = [];

        for (const pixel of pixelsToUpgrade) {
            const result = await upgradeWebPixelSettings(
                admin,
                pixel.id,
                pixel.settings,
                session.shop,
                ingestionKey,
                backendUrl
            );

            results.push({
                id: pixel.id,
                success: result.success,
                error: result.error,
            });
        }

        const successCount = results.filter(r => r.success).length;
        const failures = results.filter(r => !r.success);

        return json({
            success: failures.length === 0,
            message: `升级了 ${successCount}/${pixelsToUpgrade.length} 个 Pixel 配置`,
            upgraded: successCount,
            total: pixelsToUpgrade.length,
            failures: failures.length > 0 ? failures : undefined,
        });

    } catch (error) {
        logger.error("Upgrade WebPixel action error", error);
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

