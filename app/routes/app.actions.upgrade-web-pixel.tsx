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
import { decryptIngestionSecret } from "../utils/token-encryption.server";
import { logger } from "../utils/logger.server";
import { i18nServer } from "../i18n.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const t = await i18nServer.getFixedT(request);
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
                error: t("scan.errors.shopNotFound"),
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
                error: t("scan.errors.ingestionKeyMissing"),
            }, { status: 400 });
        }
        const webPixels = await getExistingWebPixels(admin);
        if (webPixels.length === 0) {
            return json({
                success: false,
                error: t("scan.errors.webPixelNotFound"),
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
                message: t("scan.success.noUpgradeNeeded"),
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
                message: t("scan.success.upgradeSuccess", { count: successCount }),
                upgradedCount: successCount,
            });
        }
        return json({
            success: false,
            message: t("scan.errors.upgradePartial", { success: successCount, total: results.length }),
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
            error: error instanceof Error ? error.message : t("common.serverError"),
        }, { status: 500 });
    }
};

export const loader = async () => {
    return json({ error: "Method not allowed" }, { status: 405 });
};
