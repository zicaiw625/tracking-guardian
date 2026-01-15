import { decryptJson } from "../utils/crypto.server";
import { logger } from "../utils/logger.server";
import type { PlatformCredentials } from "../types";
import { ok, err, type Result, fromThrowable } from "../types/result";
import { isProduction } from "../utils/config";

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

export interface CredentialsWithMetadata {
  credentials: PlatformCredentials;
  usedLegacy: boolean;
}

export interface PixelConfigForCredentials {
  credentialsEncrypted?: string | null;
  credentials_legacy?: unknown;
  platform?: string;
}

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

function tryReadLegacy(
  legacyCredentials: unknown,
  platform: string
): Result<PlatformCredentials, CredentialError> {
  if (typeof legacyCredentials === "string") {
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
    logger.error(`Legacy plaintext credentials detected for ${platform} - migration required`, {
      platform,
      isProduction: isProduction(),
    });
    return err({
      type: "LEGACY_MIGRATION_NEEDED",
      message: "Legacy plaintext credentials are not allowed. Please migrate to encrypted credentials.",
      platform,
    });
  }
  return err({
    type: "NO_CREDENTIALS",
    message: "Invalid legacy credentials format",
    platform,
  });
}

export function decryptCredentials(
  pixelConfig: PixelConfigForCredentials,
  platform: string
): Result<CredentialsWithMetadata, CredentialError> {
  if (pixelConfig.credentialsEncrypted) {
    const encryptedResult = tryDecryptEncrypted(pixelConfig.credentialsEncrypted, platform);
    if (encryptedResult.ok) {
      return ok({ credentials: encryptedResult.value, usedLegacy: false });
    }
  }
  if (pixelConfig.credentials_legacy) {
    const legacyResult = tryReadLegacy(pixelConfig.credentials_legacy, platform);
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
