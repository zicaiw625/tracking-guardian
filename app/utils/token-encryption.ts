/**
 * Token Encryption Utilities
 * 
 * Specialized encryption for Shopify access tokens and ingestion secrets.
 * Uses versioned format for future-proof decryption and migration support.
 * 
 * Encryption key is derived from the centralized crypto.ts module.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { getEncryptionKey, validateEncryptionConfig } from "./crypto";
import { logger } from "./logger";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

// Version prefix for encrypted tokens - allows future format changes
const CURRENT_VERSION = "v1";
const VERSION_PREFIX = `${CURRENT_VERSION}:`;
/**
 * Encrypt a Shopify access token for secure storage.
 * 
 * @param token - Plain text access token
 * @returns Versioned encrypted token string
 */
export function encryptAccessToken(token: string): string {
  if (!token) {
    return "";
  }
  
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(token, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();
  
  return `${VERSION_PREFIX}${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}
/**
 * Decrypt an encrypted Shopify access token.
 * 
 * @param encryptedToken - Versioned encrypted token string
 * @returns Plain text access token
 * @throws TokenDecryptionError if decryption fails
 */
export function decryptAccessToken(encryptedToken: string): string {
  if (!encryptedToken) {
    return "";
  }
  
  // Handle legacy unencrypted tokens
  if (!encryptedToken.startsWith(VERSION_PREFIX)) {
    logger.warn("[Token Encryption] Found unencrypted legacy token. " +
      "It will be encrypted on next auth refresh.");
    return encryptedToken;
  }
  
  try {
    const key = getEncryptionKey();
    const withoutVersion = encryptedToken.slice(VERSION_PREFIX.length);
    const parts = withoutVersion.split(":");
    
    if (parts.length !== 3) {
      throw new Error("Invalid encrypted token format");
    }
    
    const [ivHex, authTagHex, ciphertext] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(ciphertext, "hex", "utf8");
    decrypted += decipher.final("utf8");
    
    return decrypted;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    logger.error(`[Token Encryption] Decryption failed: ${errorMsg}`);
    throw new TokenDecryptionError(
      "Failed to decrypt access token. Re-authentication required.",
      { cause: error }
    );
  }
}
/**
 * Check if a token is encrypted (has version prefix).
 */
export function isTokenEncrypted(token: string | null | undefined): boolean {
  if (!token) return false;
  return token.startsWith(VERSION_PREFIX);
}

/**
 * Ensure a token is encrypted, encrypting if necessary.
 */
export function ensureTokenEncrypted(token: string): string {
  if (!token) return "";
  if (isTokenEncrypted(token)) return token;
  return encryptAccessToken(token);
}

/**
 * Encrypt an ingestion secret for secure storage.
 */
export function encryptIngestionSecret(secret: string): string {
  return encryptAccessToken(secret);
}

/**
 * Decrypt an encrypted ingestion secret.
 * Returns empty string on failure (shop should regenerate).
 */
export function decryptIngestionSecret(encryptedSecret: string): string {
  if (!encryptedSecret) return "";
  
  try {
    return decryptAccessToken(encryptedSecret);
  } catch {
    logger.warn(
      "[Token Encryption] Failed to decrypt ingestion secret. " +
      "Shop should regenerate via Settings."
    );
    return "";
  }
}

/**
 * Generate a new encrypted ingestion secret.
 * 
 * @returns Object with both plain and encrypted versions
 */
export function generateEncryptedIngestionSecret(): {
  plain: string;
  encrypted: string;
} {
  const plain = randomBytes(32).toString("hex");
  const encrypted = encryptIngestionSecret(plain);
  return { plain, encrypted };
}

/**
 * Error thrown when token decryption fails.
 */
export class TokenDecryptionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TokenDecryptionError";
  }
}

/**
 * Migrate a legacy unencrypted token to encrypted format.
 * 
 * @returns Encrypted token if migration needed, null if already encrypted
 */
export function migrateToEncrypted(token: string | null | undefined): string | null {
  if (!token) return null;
  if (isTokenEncrypted(token)) return null;
  return encryptAccessToken(token);
}

/**
 * Validate token encryption configuration.
 * Delegates to centralized validateEncryptionConfig from crypto.ts.
 */
export function validateTokenEncryptionConfig(): {
  valid: boolean;
  warnings: string[];
} {
  return validateEncryptionConfig();
}
