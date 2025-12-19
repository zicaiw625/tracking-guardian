/**
 * Shop Access Utilities
 * 
 * P0-1 & P0-2: Secure access to shop data with encrypted fields
 * 
 * This module provides utilities for accessing shop data with automatic
 * decryption of sensitive fields (accessToken, ingestionSecret).
 */

import prisma from "../db.server";
import { 
  decryptAccessToken, 
  decryptIngestionSecret,
  TokenDecryptionError 
} from "./token-encryption";
import type { Shop, PixelConfig, AlertConfig } from "@prisma/client";

// ==========================================
// Types
// ==========================================

export interface DecryptedShop extends Omit<Shop, "accessToken" | "ingestionSecret"> {
  /** Decrypted access token (null if decryption failed) */
  accessToken: string | null;
  /** Decrypted ingestion secret (empty string if decryption failed) */
  ingestionSecret: string;
}

export interface ShopWithDecryptedSecret extends Shop {
  /** Decrypted ingestion secret for pixel request verification */
  decryptedIngestionSecret: string;
}

// ==========================================
// Shop Access Functions
// ==========================================

/**
 * Get a shop by domain with decrypted sensitive fields
 * 
 * @param shopDomain - The shop's myshopify.com domain
 * @returns Shop data with decrypted accessToken and ingestionSecret
 */
export async function getShopWithDecryptedFields(
  shopDomain: string
): Promise<DecryptedShop | null> {
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  });
  
  if (!shop) {
    return null;
  }
  
  return decryptShopFields(shop);
}

/**
 * Get a shop by ID with decrypted sensitive fields
 */
export async function getShopByIdWithDecryptedFields(
  shopId: string
): Promise<DecryptedShop | null> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
  });
  
  if (!shop) {
    return null;
  }
  
  return decryptShopFields(shop);
}

/**
 * Decrypt sensitive fields in a shop record
 */
function decryptShopFields(shop: Shop): DecryptedShop {
  let decryptedAccessToken: string | null = null;
  let decryptedIngestionSecret = "";
  
  // Decrypt access token
  if (shop.accessToken) {
    try {
      decryptedAccessToken = decryptAccessToken(shop.accessToken);
    } catch (error) {
      if (error instanceof TokenDecryptionError) {
        console.warn(
          `[Shop Access] Failed to decrypt accessToken for shop ${shop.shopDomain}. ` +
          "Re-authentication required."
        );
        decryptedAccessToken = null;
      } else {
        throw error;
      }
    }
  }
  
  // Decrypt ingestion secret
  if (shop.ingestionSecret) {
    decryptedIngestionSecret = decryptIngestionSecret(shop.ingestionSecret);
  }
  
  return {
    ...shop,
    accessToken: decryptedAccessToken,
    ingestionSecret: decryptedIngestionSecret,
  };
}

/**
 * Get shop's decrypted ingestion secret for pixel event verification
 * 
 * This is optimized for the common case of verifying pixel signatures
 * where we only need the ingestion secret, not the full shop record.
 * 
 * @param shopDomain - The shop's myshopify.com domain
 * @returns Decrypted ingestion secret, or null if not found/failed
 */
export async function getDecryptedIngestionSecret(
  shopDomain: string
): Promise<string | null> {
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

/**
 * P0-2: Shop verification result with grace window support
 */
export interface ShopVerificationData {
  id: string;
  shopDomain: string;
  isActive: boolean;
  /** Current decrypted ingestion secret */
  ingestionSecret: string | null;
  /** Previous decrypted ingestion secret (for grace window) */
  previousIngestionSecret: string | null;
  /** When the previous secret expires */
  previousSecretExpiry: Date | null;
}

/**
 * Get shop with decrypted ingestion secret(s) for verification
 * P0-2: Includes previous secret for grace window support
 * 
 * Returns both current and previous secrets (if within grace window)
 */
export async function getShopForVerification(
  shopDomain: string
): Promise<ShopVerificationData | null> {
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
  
  // Decrypt current secret
  const currentSecret = shop.ingestionSecret 
    ? decryptIngestionSecret(shop.ingestionSecret) 
    : null;
  
  // P0-2: Decrypt previous secret only if within grace window
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
  };
}

/**
 * P0-2: Verify a signature against current or previous secret
 * Supports grace window during secret rotation
 * 
 * @returns The secret that matched (for logging), or null if no match
 */
export function verifyWithGraceWindow(
  shop: ShopVerificationData,
  verifyFn: (secret: string) => boolean
): { matched: boolean; usedPreviousSecret: boolean } {
  // Try current secret first
  if (shop.ingestionSecret && verifyFn(shop.ingestionSecret)) {
    return { matched: true, usedPreviousSecret: false };
  }
  
  // Try previous secret if within grace window
  if (shop.previousIngestionSecret && verifyFn(shop.previousIngestionSecret)) {
    console.info(
      `[Grace Window] Request verified using previous secret for ${shop.shopDomain}. ` +
      `Expires: ${shop.previousSecretExpiry?.toISOString()}`
    );
    return { matched: true, usedPreviousSecret: true };
  }
  
  return { matched: false, usedPreviousSecret: false };
}

// ==========================================
// Migration Helpers
// ==========================================

/**
 * P0-1 & P0-2: Migrate existing unencrypted shop tokens to encrypted format
 * 
 * This function can be called during app startup or as a one-time migration
 * to encrypt all existing plaintext tokens in the Shop table.
 */
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
      const updates: { accessToken?: string; ingestionSecret?: string } = {};
      
      // Migrate accessToken
      if (shop.accessToken && !isTokenEncrypted(shop.accessToken)) {
        updates.accessToken = encryptAccessToken(shop.accessToken);
        accessTokensMigrated++;
      }
      
      // Migrate ingestionSecret
      if (shop.ingestionSecret && !isTokenEncrypted(shop.ingestionSecret)) {
        updates.ingestionSecret = encryptIngestionSecret(shop.ingestionSecret);
        ingestionSecretsMigrated++;
      }
      
      // Apply updates if any
      if (Object.keys(updates).length > 0) {
        await prisma.shop.update({
          where: { id: shop.id },
          data: updates,
        });
      } else {
        skipped++;
      }
    } catch (error) {
      console.error(`[Migration] Failed to migrate shop ${shop.shopDomain}:`, error);
      errors++;
    }
  }
  
  console.log(
    `[Shop Token Migration] Completed: ` +
    `${accessTokensMigrated} accessTokens migrated, ` +
    `${ingestionSecretsMigrated} ingestionSecrets migrated, ` +
    `${skipped} skipped, ${errors} errors`
  );
  
  return { accessTokensMigrated, ingestionSecretsMigrated, skipped, errors };
}
