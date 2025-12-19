// Cryptographic utilities for secure credential storage
// Uses AES-256-GCM for encryption with proper key derivation

import { 
  createCipheriv, 
  createDecipheriv, 
  createHash,
  randomBytes, 
  scryptSync 
} from "crypto";

// Scrypt parameters for key derivation (OWASP recommended)
// N = 2^17 (131072) - CPU/memory cost parameter
// r = 8 - block size parameter
// p = 1 - parallelization parameter
const SCRYPT_PARAMS = {
  N: 131072, // 2^17, recommended minimum for sensitive data
  r: 8,
  p: 1,
  maxmem: 256 * 1024 * 1024, // 256 MB max memory
};

// Cache for derived key to avoid repeated expensive scrypt operations
let cachedKey: Buffer | null = null;
let cachedKeySecret: string | null = null;

/**
 * Get or derive encryption key from environment variables
 * Uses scrypt with OWASP-recommended parameters for key derivation
 */
const getEncryptionKey = (): Buffer => {
  const secret = process.env.ENCRYPTION_SECRET;
  const salt = process.env.ENCRYPTION_SALT;
  
  // Always require ENCRYPTION_SECRET in production
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "ENCRYPTION_SECRET must be set in production. " +
        "Generate a secure secret using: openssl rand -base64 32"
      );
    }
    // Development fallback with clear warning
    console.warn(
      "⚠️ ENCRYPTION_SECRET not set. Using insecure default for development only. " +
      "Set ENCRYPTION_SECRET environment variable for production."
    );
    // Use a deterministic but clearly dev-only key
    const devSecret = "INSECURE_DEV_SECRET_DO_NOT_USE_IN_PRODUCTION";
    const devSalt = "dev-salt-not-for-production";
    return scryptSync(devSecret, devSalt, 32, SCRYPT_PARAMS);
  }
  
  // Validate secret length (minimum 32 characters recommended)
  if (secret.length < 32) {
    console.warn(
      "⚠️ ENCRYPTION_SECRET is shorter than 32 characters. " +
      "Consider using a longer secret for better security."
    );
  }
  
  // Use cached key if secret hasn't changed (avoid expensive scrypt on every call)
  if (cachedKey && cachedKeySecret === secret) {
    return cachedKey;
  }
  
  // Get salt from environment or generate a secure default
  // Note: In production, ENCRYPTION_SALT should be set and consistent across deploys
  const effectiveSalt = salt || `tracking-guardian-${secret.slice(0, 8)}`;
  
  if (!salt && process.env.NODE_ENV === "production") {
    console.warn(
      "⚠️ ENCRYPTION_SALT not set. Using derived salt. " +
      "Set ENCRYPTION_SALT environment variable for consistent encryption across deployments."
    );
  }
  
  // Derive a 256-bit key from the secret using scrypt
  cachedKey = scryptSync(secret, effectiveSalt, 32, SCRYPT_PARAMS);
  cachedKeySecret = secret;
  
  return cachedKey;
};

/**
 * Validates encryption configuration
 * Call this during app startup to ensure proper configuration
 */
export function validateEncryptionConfig(): { valid: boolean; warnings: string[] } {
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
    warnings.push("ENCRYPTION_SALT not set - using derived salt");
  }
  
  return { valid: true, warnings };
}

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16; // 128 bits for AES-GCM
const AUTH_TAG_LENGTH = 16; // 128 bits authentication tag

/**
 * Encrypts sensitive data using AES-256-GCM
 * @param plaintext - The data to encrypt
 * @returns Base64-encoded encrypted string (iv:authTag:ciphertext)
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all in hex)
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts data encrypted with the encrypt function
 * @param encryptedData - The encrypted string (iv:authTag:ciphertext)
 * @returns The original plaintext
 */
export function decrypt(encryptedData: string): string {
  const key = getEncryptionKey();
  const parts = encryptedData.split(":");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format");
  }

  const [ivHex, authTagHex, ciphertext] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Encrypts a JSON object
 * @param data - Object to encrypt
 * @returns Base64-encoded encrypted string
 */
export function encryptJson<T extends object>(data: T): string {
  return encrypt(JSON.stringify(data));
}

/**
 * Decrypts and parses a JSON object
 * @param encryptedData - Encrypted string
 * @returns The original object
 */
export function decryptJson<T extends object>(encryptedData: string): T {
  const jsonString = decrypt(encryptedData);
  return JSON.parse(jsonString) as T;
}

/**
 * SHA-256 hash function for PII data (email, phone, etc.)
 * Used for sending hashed data to ad platforms
 * 
 * Uses Node.js crypto module for guaranteed compatibility across all Node.js versions
 * Note: This function is async for API compatibility, but the implementation is sync
 */
export async function hashValue(value: string): Promise<string> {
  // Use Node.js createHash for reliable cross-runtime compatibility
  // This avoids issues with crypto.subtle not being available in some environments
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Synchronous version of hashValue for use in synchronous contexts
 * Prefer the async version when possible
 */
export function hashValueSync(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Normalizes a phone number by removing all non-numeric characters
 * @param phone - Phone number string
 * @returns Normalized phone number
 */
export function normalizePhone(phone: string): string {
  // Remove all non-numeric characters except leading +
  return phone.replace(/[^\d+]/g, "");
}

/**
 * Normalizes an email address for hashing
 * @param email - Email address
 * @returns Normalized email (lowercase, trimmed)
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

// ==========================================
// Event Deduplication
// ==========================================

/**
 * Generate a deterministic event ID for deduplication
 * 
 * This function generates a consistent eventId that can be used for:
 * 1. ConversionLog internal deduplication (prevent double processing)
 * 2. Platform CAPI deduplication (Meta event_id, TikTok event_id, GA4 transaction_id)
 * 
 * The eventId is deterministic based on orderId and eventType, ensuring:
 * - Same order + same event type = same eventId
 * - Pixel flow and Webhook flow generate identical eventIds
 * - Platforms can deduplicate events from different sources
 * 
 * Format: {orderId}_{eventType}_{short_hash}
 * Example: gid://shopify/Order/123456_purchase_a1b2c3d4
 * 
 * @param orderId - The order ID (can be Shopify GID or numeric ID)
 * @param eventType - Event type (e.g., "purchase", "checkout_started")
 * @param shopDomain - Optional shop domain for additional uniqueness
 * @returns Deterministic event ID for deduplication
 */
export function generateEventId(
  orderId: string,
  eventType: string,
  shopDomain?: string
): string {
  // Normalize orderId - extract numeric ID if it's a GID
  const normalizedOrderId = normalizeOrderId(orderId);
  
  // Create a deterministic hash based on the inputs
  const hashInput = shopDomain 
    ? `${shopDomain}:${normalizedOrderId}:${eventType}`
    : `${normalizedOrderId}:${eventType}`;
  
  // Generate short hash (first 8 characters of SHA-256)
  const shortHash = createHash("sha256")
    .update(hashInput, "utf8")
    .digest("hex")
    .slice(0, 8);
  
  // Format: orderId_eventType_hash
  // This format is readable for debugging while being unique
  return `${normalizedOrderId}_${eventType}_${shortHash}`;
}

/**
 * Normalize order ID by extracting numeric ID from Shopify GID
 * 
 * Shopify order IDs can come in different formats:
 * - GID: "gid://shopify/Order/1234567890"
 * - Numeric string: "1234567890"
 * - Number: 1234567890
 * 
 * This function extracts a consistent numeric string
 * 
 * @param orderId - Order ID in any format
 * @returns Normalized numeric order ID as string
 */
export function normalizeOrderId(orderId: string | number): string {
  const orderIdStr = String(orderId);
  
  // Check if it's a Shopify GID format
  const gidMatch = orderIdStr.match(/gid:\/\/shopify\/Order\/(\d+)/);
  if (gidMatch) {
    return gidMatch[1];
  }
  
  // Check if it contains a numeric ID at the end (handles various formats)
  const numericMatch = orderIdStr.match(/(\d+)$/);
  if (numericMatch) {
    return numericMatch[1];
  }
  
  // Return as-is if no pattern matches
  return orderIdStr;
}
