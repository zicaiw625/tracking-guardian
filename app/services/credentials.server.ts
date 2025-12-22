/**
 * Credentials Decryption Service
 * 
 * Centralized logic for decrypting platform credentials from PixelConfig.
 * Handles both modern encrypted credentials and legacy plaintext credentials.
 */

import { decryptJson } from "../utils/crypto.server";
import { logger } from "../utils/logger.server";
import type { PlatformCredentials } from "../types";

/**
 * Result of credential decryption attempt
 */
export interface DecryptCredentialsResult {
  /** Decrypted credentials, or null if decryption failed */
  credentials: PlatformCredentials | null;
  /** Whether legacy (unencrypted) credentials were used */
  usedLegacy: boolean;
  /** Error message if decryption failed */
  error?: string;
}

/**
 * PixelConfig shape for credential decryption
 */
export interface PixelConfigForCredentials {
  credentialsEncrypted?: string | null;
  credentials?: unknown;
  platform?: string;
}

/**
 * Decrypts platform credentials from a PixelConfig.
 * 
 * Tries the following in order:
 * 1. Decrypt from `credentialsEncrypted` field (preferred)
 * 2. Decrypt from legacy `credentials` field (if string)
 * 3. Use legacy `credentials` field directly (if object)
 * 
 * @param pixelConfig - The pixel configuration containing credentials
 * @param platform - Platform name for logging purposes
 * @returns Decryption result with credentials and metadata
 */
export function getDecryptedCredentials(
  pixelConfig: PixelConfigForCredentials,
  platform: string
): DecryptCredentialsResult {
  let credentials: PlatformCredentials | null = null;
  let usedLegacy = false;
  let error: string | undefined;

  // Try encrypted credentials first (preferred)
  if (pixelConfig.credentialsEncrypted) {
    try {
      credentials = decryptJson<PlatformCredentials>(pixelConfig.credentialsEncrypted);
      return { credentials, usedLegacy: false };
    } catch (decryptError) {
      error = decryptError instanceof Error ? decryptError.message : "Unknown error";
      logger.warn(`Failed to decrypt credentialsEncrypted for ${platform}: ${error}`);
    }
  }

  // Fall back to legacy credentials field
  if (!credentials && pixelConfig.credentials) {
    try {
      const legacyCredentials = pixelConfig.credentials;
      
      if (typeof legacyCredentials === "string") {
        // Legacy encrypted string
        credentials = decryptJson<PlatformCredentials>(legacyCredentials);
        usedLegacy = true;
      } else if (typeof legacyCredentials === "object" && legacyCredentials !== null) {
        // Legacy plaintext object
        credentials = legacyCredentials as PlatformCredentials;
        usedLegacy = true;
      }

      if (usedLegacy) {
        logger.info(`Using legacy credentials field for ${platform} - please migrate to credentialsEncrypted`);
      }
    } catch (legacyError) {
      const legacyErrorMsg = legacyError instanceof Error ? legacyError.message : "Unknown error";
      logger.warn(`Failed to read legacy credentials for ${platform}: ${legacyErrorMsg}`);
      error = error || legacyErrorMsg;
    }
  }

  return { credentials, usedLegacy, error };
}

/**
 * Validates that credentials exist and contain required fields for a platform.
 * 
 * @param credentials - Credentials to validate
 * @param platform - Platform name for validation rules
 * @returns Validation result
 */
export function validateCredentials(
  credentials: PlatformCredentials | null,
  platform: string
): { valid: boolean; error?: string } {
  if (!credentials) {
    return { valid: false, error: "No credentials available" };
  }

  // Platform-specific validation
  switch (platform) {
    case "google": {
      const googleCreds = credentials as { measurementId?: string; apiSecret?: string };
      if (!googleCreds.measurementId || !googleCreds.apiSecret) {
        return { valid: false, error: "Missing measurementId or apiSecret for Google" };
      }
      break;
    }
    case "meta": {
      const metaCreds = credentials as { pixelId?: string; accessToken?: string };
      if (!metaCreds.pixelId || !metaCreds.accessToken) {
        return { valid: false, error: "Missing pixelId or accessToken for Meta" };
      }
      break;
    }
    case "tiktok": {
      const tiktokCreds = credentials as { pixelCode?: string; accessToken?: string };
      if (!tiktokCreds.pixelCode || !tiktokCreds.accessToken) {
        return { valid: false, error: "Missing pixelCode or accessToken for TikTok" };
      }
      break;
    }
    // Add more platforms as needed
  }

  return { valid: true };
}

/**
 * Helper to get credentials with validation in one call.
 * 
 * @param pixelConfig - The pixel configuration
 * @param platform - Platform name
 * @returns Credentials if valid, null otherwise
 */
export function getValidatedCredentials(
  pixelConfig: PixelConfigForCredentials,
  platform: string
): { credentials: PlatformCredentials | null; error?: string } {
  const decryptResult = getDecryptedCredentials(pixelConfig, platform);
  
  if (!decryptResult.credentials) {
    return { credentials: null, error: decryptResult.error || "Failed to decrypt credentials" };
  }

  const validation = validateCredentials(decryptResult.credentials, platform);
  
  if (!validation.valid) {
    return { credentials: null, error: validation.error };
  }

  return { credentials: decryptResult.credentials };
}

