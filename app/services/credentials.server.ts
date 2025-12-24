/**
 * Credentials Decryption Service
 *
 * Centralized logic for decrypting platform credentials from PixelConfig.
 * Handles both modern encrypted credentials and legacy plaintext credentials.
 *
 * Uses Result type for type-safe error handling.
 */

import { decryptJson } from "../utils/crypto.server";
import { logger } from "../utils/logger.server";
import type { PlatformCredentials } from "../types";
import { ok, err, type Result, fromThrowable } from "../types/result";

// =============================================================================
// Types
// =============================================================================

/**
 * Error types for credential operations
 */
export type CredentialErrorType =
  | "DECRYPTION_FAILED"
  | "NO_CREDENTIALS"
  | "VALIDATION_FAILED"
  | "LEGACY_MIGRATION_NEEDED";

export interface CredentialError {
  type: CredentialErrorType;
  message: string;
  platform?: string;
}

/**
 * Result of credential decryption with metadata
 */
export interface CredentialsWithMetadata {
  credentials: PlatformCredentials;
  usedLegacy: boolean;
}

/**
 * PixelConfig shape for credential decryption
 */
export interface PixelConfigForCredentials {
  credentialsEncrypted?: string | null;
  credentials?: unknown;
  platform?: string;
}

// =============================================================================
// Result-Based Functions
// =============================================================================

/**
 * Try to decrypt from encrypted field.
 */
function tryDecryptEncrypted(
  encrypted: string,
  platform: string
): Result<PlatformCredentials, CredentialError> {
  const result = fromThrowable(
    () => decryptJson<PlatformCredentials>(encrypted),
    (e): CredentialError => ({
      type: "DECRYPTION_FAILED",
      message: e instanceof Error ? e.message : "Unknown decryption error",
      platform,
    })
  );

  if (!result.ok) {
    logger.warn(`Failed to decrypt credentialsEncrypted for ${platform}: ${result.error.message}`);
  }

  return result;
}

/**
 * Try to read from legacy credentials field.
 */
function tryReadLegacy(
  legacyCredentials: unknown,
  platform: string
): Result<PlatformCredentials, CredentialError> {
  if (typeof legacyCredentials === "string") {
    // Legacy encrypted string
    const result = fromThrowable(
      () => decryptJson<PlatformCredentials>(legacyCredentials),
      (e): CredentialError => ({
        type: "DECRYPTION_FAILED",
        message: e instanceof Error ? e.message : "Unknown decryption error",
        platform,
      })
    );

    if (result.ok) {
      logger.info(`Using legacy encrypted credentials for ${platform} - please migrate`);
    }
    return result;
  }

  if (typeof legacyCredentials === "object" && legacyCredentials !== null) {
    // Legacy plaintext object
    logger.info(`Using legacy plaintext credentials for ${platform} - please migrate`);
    return ok(legacyCredentials as PlatformCredentials);
  }

  return err({
    type: "NO_CREDENTIALS",
    message: "Invalid legacy credentials format",
    platform,
  });
}

/**
 * Decrypts platform credentials from a PixelConfig using Result type.
 *
 * Tries the following in order:
 * 1. Decrypt from `credentialsEncrypted` field (preferred)
 * 2. Decrypt from legacy `credentials` field (if string)
 * 3. Use legacy `credentials` field directly (if object)
 */
export function decryptCredentials(
  pixelConfig: PixelConfigForCredentials,
  platform: string
): Result<CredentialsWithMetadata, CredentialError> {
  // Try encrypted credentials first (preferred)
  if (pixelConfig.credentialsEncrypted) {
    const encryptedResult = tryDecryptEncrypted(pixelConfig.credentialsEncrypted, platform);
    if (encryptedResult.ok) {
      return ok({ credentials: encryptedResult.value, usedLegacy: false });
    }
    // Fall through to try legacy
  }

  // Try legacy credentials
  if (pixelConfig.credentials) {
    const legacyResult = tryReadLegacy(pixelConfig.credentials, platform);
    if (legacyResult.ok) {
      return ok({ credentials: legacyResult.value, usedLegacy: true });
    }
    return err(legacyResult.error);
  }

  return err({
    type: "NO_CREDENTIALS",
    message: "No credentials found in configuration",
    platform,
  });
}

/**
 * Validates that credentials contain required fields for a platform.
 */
export function validatePlatformCredentials(
  credentials: PlatformCredentials,
  platform: string
): Result<PlatformCredentials, CredentialError> {
  switch (platform) {
    case "google": {
      const googleCreds = credentials as { measurementId?: string; apiSecret?: string };
      if (!googleCreds.measurementId || !googleCreds.apiSecret) {
        return err({
          type: "VALIDATION_FAILED",
          message: "Missing measurementId or apiSecret for Google",
          platform,
        });
      }
      break;
    }
    case "meta": {
      const metaCreds = credentials as { pixelId?: string; accessToken?: string };
      if (!metaCreds.pixelId || !metaCreds.accessToken) {
        return err({
          type: "VALIDATION_FAILED",
          message: "Missing pixelId or accessToken for Meta",
          platform,
        });
      }
      break;
    }
    case "tiktok": {
      const tiktokCreds = credentials as { pixelCode?: string; accessToken?: string };
      if (!tiktokCreds.pixelCode || !tiktokCreds.accessToken) {
        return err({
          type: "VALIDATION_FAILED",
          message: "Missing pixelCode or accessToken for TikTok",
          platform,
        });
      }
      break;
    }
  }

  return ok(credentials);
}

/**
 * Get validated credentials using Result type.
 * Combines decryption and validation in one call.
 */
export function getValidCredentials(
  pixelConfig: PixelConfigForCredentials,
  platform: string
): Result<CredentialsWithMetadata, CredentialError> {
  const decryptResult = decryptCredentials(pixelConfig, platform);

  if (!decryptResult.ok) {
    return decryptResult;
  }

  const validationResult = validatePlatformCredentials(
    decryptResult.value.credentials,
    platform
  );

  if (!validationResult.ok) {
    return validationResult;
  }

  return ok(decryptResult.value);
}
