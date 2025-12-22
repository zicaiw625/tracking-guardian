import { timingSafeEqual, createHash } from "crypto";
import prisma from "../db.server";
import { decryptAccessToken, decryptIngestionSecret, TokenDecryptionError } from "./token-encryption";
import { logger } from "./logger";
import type { Shop, PixelConfig, AlertConfig } from "@prisma/client";
export function timingSafeEquals(a: string, b: string): boolean {
    const hashA = createHash("sha256").update(a).digest();
    const hashB = createHash("sha256").update(b).digest();
    return timingSafeEqual(hashA, hashB);
}
export interface DecryptedShop extends Omit<Shop, "accessToken" | "ingestionSecret"> {
    accessToken: string | null;
    ingestionSecret: string;
}
export interface ShopWithDecryptedSecret extends Shop {
    decryptedIngestionSecret: string;
}
export async function getShopWithDecryptedFields(shopDomain: string): Promise<DecryptedShop | null> {
    const shop = await prisma.shop.findUnique({
        where: { shopDomain },
    });
    if (!shop) {
        return null;
    }
    return decryptShopFields(shop);
}
export async function getShopByIdWithDecryptedFields(shopId: string): Promise<DecryptedShop | null> {
    const shop = await prisma.shop.findUnique({
        where: { id: shopId },
    });
    if (!shop) {
        return null;
    }
    return decryptShopFields(shop);
}
function decryptShopFields(shop: Shop): DecryptedShop {
    let decryptedAccessToken: string | null = null;
    let decryptedIngestionSecret = "";
    if (shop.accessToken) {
        try {
            decryptedAccessToken = decryptAccessToken(shop.accessToken);
        }
        catch (error) {
            if (error instanceof TokenDecryptionError) {
                logger.warn(`[Shop Access] Failed to decrypt accessToken for shop ${shop.shopDomain}. ` +
                    "Re-authentication required.");
                decryptedAccessToken = null;
            }
            else {
                throw error;
            }
        }
    }
    if (shop.ingestionSecret) {
        decryptedIngestionSecret = decryptIngestionSecret(shop.ingestionSecret);
    }
    return {
        ...shop,
        accessToken: decryptedAccessToken,
        ingestionSecret: decryptedIngestionSecret,
    };
}
export async function getDecryptedIngestionSecret(shopDomain: string): Promise<string | null> {
    const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: {
            id: true,
            shopDomain: true,
            isActive: true,
            ingestionSecret: true,
        },
    });
    if (!shop || !shop.isActive) {
        return null;
    }
    if (!shop.ingestionSecret) {
        return null;
    }
    return decryptIngestionSecret(shop.ingestionSecret);
}
export interface ShopVerificationData {
    id: string;
    shopDomain: string;
    isActive: boolean;
    ingestionSecret: string | null;
    previousIngestionSecret: string | null;
    previousSecretExpiry: Date | null;
}
export async function getShopForVerification(shopDomain: string): Promise<ShopVerificationData | null> {
    const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: {
            id: true,
            shopDomain: true,
            isActive: true,
            ingestionSecret: true,
            previousIngestionSecret: true,
            previousSecretExpiry: true,
        },
    });
    if (!shop) {
        return null;
    }
    const currentSecret = shop.ingestionSecret
        ? decryptIngestionSecret(shop.ingestionSecret)
        : null;
    let previousSecret: string | null = null;
    if (shop.previousIngestionSecret &&
        shop.previousSecretExpiry &&
        new Date() < shop.previousSecretExpiry) {
        previousSecret = decryptIngestionSecret(shop.previousIngestionSecret);
    }
    return {
        id: shop.id,
        shopDomain: shop.shopDomain,
        isActive: shop.isActive,
        ingestionSecret: currentSecret,
        previousIngestionSecret: previousSecret,
        previousSecretExpiry: shop.previousSecretExpiry,
    };
}
export function verifyWithGraceWindow(shop: ShopVerificationData, verifyFn: (secret: string) => boolean): {
    matched: boolean;
    usedPreviousSecret: boolean;
} {
    if (shop.ingestionSecret && verifyFn(shop.ingestionSecret)) {
        return { matched: true, usedPreviousSecret: false };
    }
    if (shop.previousIngestionSecret && verifyFn(shop.previousIngestionSecret)) {
        logger.info(`[Grace Window] Request verified using previous secret for ${shop.shopDomain}. ` +
            `Expires: ${shop.previousSecretExpiry?.toISOString()}`);
        return { matched: true, usedPreviousSecret: true };
    }
    return { matched: false, usedPreviousSecret: false };
}
export async function migrateShopTokensToEncrypted(): Promise<{
    accessTokensMigrated: number;
    ingestionSecretsMigrated: number;
    skipped: number;
    errors: number;
}> {
    const { encryptAccessToken, isTokenEncrypted } = await import("./token-encryption");
    const { encryptIngestionSecret } = await import("./token-encryption");
    let accessTokensMigrated = 0;
    let ingestionSecretsMigrated = 0;
    let skipped = 0;
    let errors = 0;
    const shops = await prisma.shop.findMany({
        select: {
            id: true,
            shopDomain: true,
            accessToken: true,
            ingestionSecret: true,
        },
    });
    for (const shop of shops) {
        try {
            const updates: {
                accessToken?: string;
                ingestionSecret?: string;
            } = {};
            if (shop.accessToken && !isTokenEncrypted(shop.accessToken)) {
                updates.accessToken = encryptAccessToken(shop.accessToken);
                accessTokensMigrated++;
            }
            if (shop.ingestionSecret && !isTokenEncrypted(shop.ingestionSecret)) {
                updates.ingestionSecret = encryptIngestionSecret(shop.ingestionSecret);
                ingestionSecretsMigrated++;
            }
            if (Object.keys(updates).length > 0) {
                await prisma.shop.update({
                    where: { id: shop.id },
                    data: updates,
                });
            }
            else {
                skipped++;
            }
        }
        catch (error) {
            logger.error(`[Migration] Failed to migrate shop ${shop.shopDomain}`, error);
            errors++;
        }
    }
    logger.info(`[Shop Token Migration] Completed: ` +
        `${accessTokensMigrated} accessTokens migrated, ` +
        `${ingestionSecretsMigrated} ingestionSecrets migrated, ` +
        `${skipped} skipped, ${errors} errors`);
    return { accessTokensMigrated, ingestionSecretsMigrated, skipped, errors };
}
