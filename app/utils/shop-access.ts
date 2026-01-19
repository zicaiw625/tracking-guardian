import { timingSafeEqual, createHash } from "crypto";
import prisma from "../db.server";
import { decryptAccessToken, decryptIngestionSecret, TokenDecryptionError, encryptAccessToken, isTokenEncrypted, encryptIngestionSecret } from "./token-encryption";
import { logger } from "./logger.server";
import type { Shop, PixelConfig } from "@prisma/client";

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
    primaryDomain: string | null;
    storefrontDomains: string[];
}

export interface ShopVerificationDataEncrypted {
    id: string;
    shopDomain: string;
    isActive: boolean;
    ingestionSecret: string | null;
    previousIngestionSecret: string | null;
    previousSecretExpiry: Date | null;
    primaryDomain: string | null;
    storefrontDomains: string[];
}

export async function getShopForVerificationEncrypted(shopDomain: string): Promise<ShopVerificationDataEncrypted | null> {
    const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: {
            id: true,
            shopDomain: true,
            isActive: true,
            ingestionSecret: true,
            previousIngestionSecret: true,
            previousSecretExpiry: true,
            primaryDomain: true,
            storefrontDomains: true,
        },
    });
    if (!shop) {
        return null;
    }
    return {
        id: shop.id,
        shopDomain: shop.shopDomain,
        isActive: shop.isActive,
        ingestionSecret: shop.ingestionSecret,
        previousIngestionSecret: shop.previousIngestionSecret,
        previousSecretExpiry: shop.previousSecretExpiry,
        primaryDomain: shop.primaryDomain,
        storefrontDomains: shop.storefrontDomains,
    };
}

export function decryptShopVerificationData(
    encrypted: ShopVerificationDataEncrypted
): ShopVerificationData {
    const currentSecret = encrypted.ingestionSecret
        ? decryptIngestionSecret(encrypted.ingestionSecret)
        : null;
    let previousSecret: string | null = null;
    if (
        encrypted.previousIngestionSecret &&
        encrypted.previousSecretExpiry &&
        new Date() < encrypted.previousSecretExpiry
    ) {
        previousSecret = decryptIngestionSecret(encrypted.previousIngestionSecret);
    }
    return {
        id: encrypted.id,
        shopDomain: encrypted.shopDomain,
        isActive: encrypted.isActive,
        ingestionSecret: currentSecret,
        previousIngestionSecret: previousSecret,
        previousSecretExpiry: encrypted.previousSecretExpiry,
        primaryDomain: encrypted.primaryDomain,
        storefrontDomains: encrypted.storefrontDomains,
    };
}

export interface ShopWithPixelConfigs extends ShopVerificationData {
    pixelConfigs: Array<{
        platform: string;
        id: string;
        platformId: string | null;
        clientConfig: unknown;
        clientSideEnabled: boolean;
        serverSideEnabled: boolean;
    }>;
}

export interface ShopWithPixelConfigsEncrypted extends ShopVerificationDataEncrypted {
    pixelConfigs: Array<{
        platform: string;
        id: string;
        platformId: string | null;
        clientConfig: unknown;
        clientSideEnabled: boolean;
        serverSideEnabled: boolean;
    }>;
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
            primaryDomain: true,
            storefrontDomains: true,
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
        primaryDomain: shop.primaryDomain,
        storefrontDomains: shop.storefrontDomains,
    };
}

export async function getShopForVerificationWithConfigs(
    shopDomain: string,
    environment?: "test" | "live"
): Promise<ShopWithPixelConfigs | null> {
    const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: {
            id: true,
            shopDomain: true,
            isActive: true,
            ingestionSecret: true,
            previousIngestionSecret: true,
            previousSecretExpiry: true,
            primaryDomain: true,
            storefrontDomains: true,
            pixelConfigs: {
                where: {
                    isActive: true,
                    ...(environment ? { environment } : { environment: "live" }),
                },
                select: {
                    platform: true,
                    id: true,
                    platformId: true,
                    environment: true,
                    clientConfig: true,
                    clientSideEnabled: true,
                    serverSideEnabled: true,
                },
            },
        },
    });
    if (!shop) {
        return null;
    }
    const currentSecret = shop.ingestionSecret
        ? decryptIngestionSecret(shop.ingestionSecret)
        : null;
    let previousSecret: string | null = null;
    if (
        shop.previousIngestionSecret &&
        shop.previousSecretExpiry &&
        new Date() < shop.previousSecretExpiry
    ) {
        previousSecret = decryptIngestionSecret(shop.previousIngestionSecret);
    }
    return {
        id: shop.id,
        shopDomain: shop.shopDomain,
        isActive: shop.isActive,
        ingestionSecret: currentSecret,
        previousIngestionSecret: previousSecret,
        previousSecretExpiry: shop.previousSecretExpiry,
        primaryDomain: shop.primaryDomain,
        storefrontDomains: shop.storefrontDomains,
        pixelConfigs: shop.pixelConfigs,
    };
}

export async function getShopForVerificationWithConfigsEncrypted(
    shopDomain: string,
    environment?: "test" | "live"
): Promise<ShopWithPixelConfigsEncrypted | null> {
    const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: {
            id: true,
            shopDomain: true,
            isActive: true,
            ingestionSecret: true,
            previousIngestionSecret: true,
            previousSecretExpiry: true,
            primaryDomain: true,
            storefrontDomains: true,
            pixelConfigs: {
                where: {
                    isActive: true,
                    ...(environment ? { environment } : { environment: "live" }),
                },
                select: {
                    platform: true,
                    id: true,
                    platformId: true,
                    environment: true,
                    clientConfig: true,
                    clientSideEnabled: true,
                    serverSideEnabled: true,
                },
            },
        },
    });
    if (!shop) {
        return null;
    }
    return {
        id: shop.id,
        shopDomain: shop.shopDomain,
        isActive: shop.isActive,
        ingestionSecret: shop.ingestionSecret,
        previousIngestionSecret: shop.previousIngestionSecret,
        previousSecretExpiry: shop.previousSecretExpiry,
        primaryDomain: shop.primaryDomain,
        storefrontDomains: shop.storefrontDomains,
        pixelConfigs: shop.pixelConfigs,
    };
}

export function decryptShopWithPixelConfigs(
    encrypted: ShopWithPixelConfigsEncrypted
): ShopWithPixelConfigs {
    const currentSecret = encrypted.ingestionSecret
        ? decryptIngestionSecret(encrypted.ingestionSecret)
        : null;
    let previousSecret: string | null = null;
    if (
        encrypted.previousIngestionSecret &&
        encrypted.previousSecretExpiry &&
        new Date() < encrypted.previousSecretExpiry
    ) {
        previousSecret = decryptIngestionSecret(encrypted.previousIngestionSecret);
    }
    return {
        id: encrypted.id,
        shopDomain: encrypted.shopDomain,
        isActive: encrypted.isActive,
        ingestionSecret: currentSecret,
        previousIngestionSecret: previousSecret,
        previousSecretExpiry: encrypted.previousSecretExpiry,
        primaryDomain: encrypted.primaryDomain,
        storefrontDomains: encrypted.storefrontDomains,
        pixelConfigs: encrypted.pixelConfigs,
    };
}
export function verifyWithGraceWindow(shop: ShopVerificationData, verifyFn: (secret: string) => boolean): {
    matched: boolean;
    usedPreviousSecret: boolean;
} {
    if (shop.ingestionSecret && verifyFn(shop.ingestionSecret)) {
        return { matched: true, usedPreviousSecret: false };
    }
    if (shop.previousIngestionSecret && shop.previousSecretExpiry && new Date() < shop.previousSecretExpiry && verifyFn(shop.previousIngestionSecret)) {
        logger.info(`[Grace Window] Request verified using previous secret for ${shop.shopDomain}. ` +
            `Expires: ${shop.previousSecretExpiry?.toISOString()}`);
        return { matched: true, usedPreviousSecret: true };
    }
    return { matched: false, usedPreviousSecret: false };
}

export async function verifyWithGraceWindowAsync(shop: ShopVerificationData, verifyFn: (secret: string) => Promise<boolean>): Promise<{
    matched: boolean;
    usedPreviousSecret: boolean;
}> {
    if (shop.ingestionSecret && await verifyFn(shop.ingestionSecret)) {
        return { matched: true, usedPreviousSecret: false };
    }
    if (shop.previousIngestionSecret && shop.previousSecretExpiry && new Date() < shop.previousSecretExpiry && await verifyFn(shop.previousIngestionSecret)) {
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
