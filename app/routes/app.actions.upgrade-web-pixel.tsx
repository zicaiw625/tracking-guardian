import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
    getExistingWebPixels,
    isOurWebPixel,
    needsSettingsUpgrade,
    upgradeWebPixelSettings
} from "../services/migration.server";
import { decryptIngestionSecret } from "../utils/token-encryption";
import { logger } from "../utils/logger.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);
    if (request.method !== "POST") {
        return json({ success: false, error: "Method not allowed" }, { status: 405 });
    }
    try {
        const shopDomain = session.shop;
        const shop = await prisma.shop.findUnique({
            where: { shopDomain },
            select: {
                id: true,
                shopDomain: true,
                ingestionSecret: true,
            },
        });
        if (!shop) {
            return json({
                success: false,
                error: "店铺未找到",
            }, { status: 404 });
        }
        let ingestionKey = "";
        if (shop.ingestionSecret) {
            try {
                ingestionKey = decryptIngestionSecret(shop.ingestionSecret);
            } catch (error) {
                logger.warn(`Failed to decrypt ingestion secret for ${shopDomain}`, {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        if (!ingestionKey) {
            return json({
                success: false,
                error: "无法获取 ingestion key，请重新安装应用",
            }, { status: 400 });
        }
        const webPixels = await getExistingWebPixels(admin);
        if (webPixels.length === 0) {
            return json({
                success: false,
                error: "未找到 Web Pixel，请先安装 Pixel",
            }, { status: 404 });
        }
        const pixelsToUpgrade: Array<{
            id: string;
            settings: unknown;
        }> = [];
        for (const pixel of webPixels) {
            if (!pixel.settings) continue;
            try {
                const settings = typeof pixel.settings === "string"
                    ? JSON.parse(pixel.settings)
                    : pixel.settings;
                if (isOurWebPixel(settings, shopDomain) && needsSettingsUpgrade(settings)) {
                    pixelsToUpgrade.push({
                        id: pixel.id,
                        settings,
                    });
                }
            } catch {
              // no-op: skip pixels that fail isOurWebPixel or needsSettingsUpgrade
            }
        }
        if (pixelsToUpgrade.length === 0) {
            return json({
                success: true,
                message: "所有 Pixel 配置已是最新版本，无需升级",
                upgradedCount: 0,
            });
        }
        logger.info(`Upgrading ${pixelsToUpgrade.length} WebPixel(s) for ${shopDomain}`);
        const results: Array<{
            pixelId: string;
            success: boolean;
            error?: string;
        }> = [];
        for (const pixel of pixelsToUpgrade) {
            const result = await upgradeWebPixelSettings(
                admin,
                pixel.id,
                pixel.settings,
                shopDomain,
                ingestionKey
            );
            results.push({
                pixelId: pixel.id,
                success: result.success,
                error: result.error,
            });
            if (result.success) {
                logger.info(`Successfully upgraded WebPixel ${pixel.id} for ${shopDomain}`);
            } else {
                logger.warn(`Failed to upgrade WebPixel ${pixel.id} for ${shopDomain}`, {
                    error: result.error,
                    userErrors: result.userErrors,
                });
            }
        }
        const successCount = results.filter(r => r.success).length;
        const failures = results.filter(r => !r.success);
        if (failures.length === 0) {
            return json({
                success: true,
                message: `成功升级 ${successCount} 个 Pixel 配置`,
                upgradedCount: successCount,
            });
        }
        return json({
            success: false,
            message: `升级了 ${successCount}/${results.length} 个 Pixel 配置`,
            upgradedCount: successCount,
            failures: failures.map(f => ({
                pixelId: f.pixelId,
                error: f.error,
            })),
        }, { status: 207 });
    } catch (error) {
        logger.error("Upgrade WebPixel action error", error);
        return json({
            success: false,
            error: error instanceof Error ? error.message : "服务器错误",
        }, { status: 500 });
    }
};

export const loader = async () => {
    return json({ error: "Method not allowed" }, { status: 405 });
};
