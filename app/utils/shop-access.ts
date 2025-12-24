/**
 * Shop Access Utilities
 * 
 * P1-01: IMPORTANT NOTE ON "ingestionSecret" NAMING
 * ================================================
 * 
 * Despite its name, the `ingestionSecret` field is NOT a cryptographic secret.
 * It is a **store-scoped identifier/token** used to correlate pixel events to shops.
 * 
 * SECURITY CHARACTERISTICS:
 * - ❌ NOT a secret: Visible in browser network requests (X-Tracking-Guardian-Key header)
 * - ❌ NOT for authentication: Anyone can see it by inspecting browser DevTools
 * - ✅ Store correlation: Used to match pixel events to the correct shop
 * - ✅ Rate limiting: Helps with per-shop rate limiting
 * - ✅ Encrypted at rest: Stored encrypted in database for operational security
 * 
 * ACTUAL SECURITY MEASURES (P1-01):
 * - Origin validation: Only accept requests from shop's allowed domains
 * - Checkout token binding: Verified against webhook's checkout_token
 * - Timestamp window: Reject stale/future timestamps
 * - Nonce/replay protection: Prevent duplicate event submission
 * - Order ID validation: Must be numeric or GID format
 * - Checkout token validation: Must be 8-128 chars, alphanumeric
 * 
 * WHY NOT RENAME TO "ingestionKey/Token"?
 * - Database field name (`Shop.ingestionSecret`) would require migration
 * - Existing shops have encrypted values under this field name
 * - Backward compatibility concerns
 * - The field IS encrypted at rest, so "secret" is accurate for storage
 * 
 * RECOMMENDATION FOR REVIEWERS:
 * - The HTTP header is already named `X-Tracking-Guardian-Key` (not secret)
 * - Trust comes from checkout token binding + origin validation, not this key
 * - See COMPLIANCE.md Section 5 "Pixel Event Security" for full details
 */

import { timingSafeEqual, createHash } from "crypto";
import prisma from "../db.server";
import { decryptAccessToken, decryptIngestionSecret, TokenDecryptionError } from "./token-encryption";
import { logger } from "./logger.server";
import type { Shop, PixelConfig, AlertConfig } from "@prisma/client";

/**
 * Timing-safe string comparison to prevent timing attacks.
 */
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

/**
 * Extended shop data with pixel configurations.
 * Used by pixel-events route to avoid N+1 query.
 */
export interface ShopWithPixelConfigs extends ShopVerificationData {
    pixelConfigs: Array<{ platform: string }>;
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

/**
 * Get shop for verification with active pixel configs included.
 * 
 * This is an optimized query that fetches shop data and pixel configs
 * in a single database call to avoid N+1 query pattern.
 * 
 * @param shopDomain - The shop domain to look up
 * @returns Shop verification data with pixel configs, or null if not found
 */
export async function getShopForVerificationWithConfigs(
    shopDomain: string
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
            // Include pixel configs in the same query
            pixelConfigs: {
                where: {
                    isActive: true,
                    serverSideEnabled: true,
                },
                select: {
                    platform: true,
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
