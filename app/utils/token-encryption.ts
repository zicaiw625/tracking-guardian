/**
 * Token Encryption Utility
 * 
 * P0-1: Secure encryption/decryption for sensitive tokens (accessToken, ingestionSecret)
 * Uses AES-256-GCM with proper key derivation
 * 
 * Features:
 * - AES-256-GCM encryption (authenticated encryption)
 * - Scrypt-based key derivation with caching
 * - Graceful degradation on decryption failure (triggers re-auth)
 * - Support for key rotation via version prefix
 */

import { 
  createCipheriv, 
  createDecipheriv, 
  randomBytes, 
  scryptSync 
} from "crypto";

// ==========================================
// Configuration
// ==========================================

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16; // 128 bits for AES-GCM
const AUTH_TAG_LENGTH = 16; // 128 bits authentication tag

// Scrypt parameters for key derivation (OWASP recommended)
const SCRYPT_PARAMS = {
  N: 131072, // 2^17, recommended minimum for sensitive data
  r: 8,
  p: 1,
  maxmem: 256 * 1024 * 1024, // 256 MB max memory
};

// Version prefix for encrypted data (enables key rotation)
const CURRENT_VERSION = "v1";
const VERSION_PREFIX = `${CURRENT_VERSION}:`;

// ==========================================
// Key Management
// ==========================================

// Cache for derived key to avoid repeated expensive scrypt operations
let cachedTokenKey: Buffer | null = null;
let cachedTokenKeySecret: string | null = null;

/**
 * Get or derive encryption key for tokens
 * Uses a separate key derivation from the main crypto.ts to allow independent rotation
 */
function getTokenEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET;
  const salt = process.env.ENCRYPTION_SALT || "shopify-access-token-salt";
  
  // Production requires ENCRYPTION_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "ENCRYPTION_SECRET must be set in production. " +
        "Generate a secure secret using: openssl rand -base64 32"
      );
    }
    // Development fallback with clear warning
    console.warn(
      "⚠️ [Token Encryption] ENCRYPTION_SECRET not set. " +
      "Using insecure default for development only."
    );
    const devSecret = "INSECURE_DEV_SECRET_DO_NOT_USE_IN_PRODUCTION";
    return scryptSync(devSecret, "dev-token-salt", 32, SCRYPT_PARAMS);
  }
  
  // Use cached key if secret hasn't changed
  if (cachedTokenKey && cachedTokenKeySecret === secret) {
    return cachedTokenKey;
  }
  
  // Derive key using scrypt
  cachedTokenKey = scryptSync(secret, salt, 32, SCRYPT_PARAMS);
  cachedTokenKeySecret = secret;
  
  return cachedTokenKey;
}

// ==========================================
// Encryption/Decryption
// ==========================================

/**
 * Encrypt an access token for secure storage
 * 
 * @param token - The plaintext access token
 * @returns Encrypted string in format: v1:iv:authTag:ciphertext (all hex)
 */
export function encryptAccessToken(token: string): string {
  if (!token) {
    return "";
  }
  
  const key = getTokenEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(token, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();
  
  // Format: version:iv:authTag:ciphertext (all in hex)
  return `${VERSION_PREFIX}${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt an access token from storage
 * 
 * @param encryptedToken - The encrypted token string
 * @returns Decrypted plaintext token
 * @throws Error if decryption fails (caller should trigger re-auth)
 */
export function decryptAccessToken(encryptedToken: string): string {
  if (!encryptedToken) {
    return "";
  }
  
  // Check if this is an unencrypted legacy token (doesn't start with version prefix)
  if (!encryptedToken.startsWith(VERSION_PREFIX)) {
    // Legacy token - return as-is but log for migration tracking
    // This allows gradual migration without breaking existing shops
    console.warn(
      "[Token Encryption] Found unencrypted legacy token. " +
      "It will be encrypted on next auth refresh."
    );
    return encryptedToken;
  }
  
  try {
    const key = getTokenEncryptionKey();
    
    // Remove version prefix and parse components
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
    console.error(`[Token Encryption] Decryption failed: ${errorMsg}`);
    
    // Throw a specific error that callers can catch to trigger re-auth
    throw new TokenDecryptionError(
      "Failed to decrypt access token. Re-authentication required.",
      { cause: error }
    );
  }
}

/**
 * Check if a token is encrypted (has version prefix)
 */
export function isTokenEncrypted(token: string | null | undefined): boolean {
  if (!token) return false;
  return token.startsWith(VERSION_PREFIX);
}

/**
 * Encrypt a token only if it's not already encrypted
 * Useful for migration scenarios
 */
export function ensureTokenEncrypted(token: string): string {
  if (!token) return "";
  if (isTokenEncrypted(token)) return token;
  return encryptAccessToken(token);
}

// ==========================================
// Ingestion Secret Encryption (P0-2)
// ==========================================

/**
 * Encrypt ingestion secret for storage
 * Uses same encryption as access tokens
 */
export function encryptIngestionSecret(secret: string): string {
  return encryptAccessToken(secret);
}

/**
 * Decrypt ingestion secret from storage
 * Returns empty string on failure (shop should regenerate)
 */
export function decryptIngestionSecret(encryptedSecret: string): string {
  if (!encryptedSecret) return "";
  
  try {
    return decryptAccessToken(encryptedSecret);
  } catch {
    // For ingestion secrets, we don't throw - just return empty
    // The shop should regenerate the secret
    console.warn(
      "[Token Encryption] Failed to decrypt ingestion secret. " +
      "Shop should regenerate via Settings."
    );
    return "";
  }
}

// ==========================================
// Error Types
// ==========================================

/**
 * Custom error for token decryption failures
 * Allows callers to specifically catch and handle re-auth scenarios
 */
export class TokenDecryptionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TokenDecryptionError";
  }
}

// ==========================================
// Migration Helpers
// ==========================================

/**
 * Migrate a plaintext token to encrypted format
 * Returns the encrypted version or null if already encrypted/empty
 */
export function migrateToEncrypted(token: string | null | undefined): string | null {
  if (!token) return null;
  if (isTokenEncrypted(token)) return null; // Already encrypted
  return encryptAccessToken(token);
}

/**
 * Validate encryption configuration at startup
 */
export function validateTokenEncryptionConfig(): { 
  valid: boolean; 
  warnings: string[] 
} {
  const warnings: string[] = [];
  const isProduction = process.env.NODE_ENV === "production";
  
  if (!process.env.ENCRYPTION_SECRET) {
    if (isProduction) {
      throw new Error("ENCRYPTION_SECRET must be set in production");
    }
    warnings.push("ENCRYPTION_SECRET not set - using insecure development default");
  } else if (process.env.ENCRYPTION_SECRET.length < 32) {
    warnings.push("ENCRYPTION_SECRET is shorter than recommended 32 characters");
  }
  
  if (!process.env.ENCRYPTION_SALT && isProduction) {
    warnings.push("ENCRYPTION_SALT not set - using default salt");
  }
  
  return { valid: true, warnings };
}
