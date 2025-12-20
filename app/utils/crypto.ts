

import { 
  createCipheriv, 
  createDecipheriv, 
  createHash,
  randomBytes, 
  scryptSync 
} from "crypto";

const SCRYPT_PARAMS = {
  N: 131072, 
  r: 8,
  p: 1,
  maxmem: 256 * 1024 * 1024, 
};

// P1: Unified salt strategy with token-encryption.ts
// Both modules now use the same default salt when ENCRYPTION_SALT is not set
const DEFAULT_ENCRYPTION_SALT = "tracking-guardian-credentials-salt";
const DEV_ENCRYPTION_SALT = "dev-salt-not-for-production";

let cachedKey: Buffer | null = null;
let cachedKeySecret: string | null = null;
let cachedKeySalt: string | null = null;

const getEncryptionKey = (): Buffer => {
  const secret = process.env.ENCRYPTION_SECRET;
  const salt = process.env.ENCRYPTION_SALT || DEFAULT_ENCRYPTION_SALT;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "ENCRYPTION_SECRET must be set in production. " +
        "Generate a secure secret using: openssl rand -base64 32"
      );
    }
    
    console.warn(
      "⚠️ ENCRYPTION_SECRET not set. Using insecure default for development only. " +
      "Set ENCRYPTION_SECRET environment variable for production."
    );
    
    const devSecret = "INSECURE_DEV_SECRET_DO_NOT_USE_IN_PRODUCTION";
    return scryptSync(devSecret, DEV_ENCRYPTION_SALT, 32, SCRYPT_PARAMS);
  }

  if (secret.length < 32) {
    console.warn(
      "⚠️ ENCRYPTION_SECRET is shorter than 32 characters. " +
      "Consider using a longer secret for better security."
    );
  }

  // Cache key only if both secret and salt match
  if (cachedKey && cachedKeySecret === secret && cachedKeySalt === salt) {
    return cachedKey;
  }
  
  if (!process.env.ENCRYPTION_SALT && process.env.NODE_ENV === "production") {
    console.warn(
      "⚠️ ENCRYPTION_SALT not set. Using default salt. " +
      "Set ENCRYPTION_SALT environment variable for consistent encryption across deployments."
    );
  }

  cachedKey = scryptSync(secret, salt, 32, SCRYPT_PARAMS);
  cachedKeySecret = secret;
  cachedKeySalt = salt;
  
  return cachedKey;
};

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
const IV_LENGTH = 16; 
const AUTH_TAG_LENGTH = 16; 

export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

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

export function encryptJson<T extends object>(data: T): string {
  return encrypt(JSON.stringify(data));
}

export function decryptJson<T extends object>(encryptedData: string): T {
  const jsonString = decrypt(encryptedData);
  return JSON.parse(jsonString) as T;
}

export async function hashValue(value: string): Promise<string> {

  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashValueSync(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function normalizePhone(phone: string): string {
  
  return phone.replace(/[^\d+]/g, "");
}

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

export function generateEventId(
  orderId: string,
  eventType: string,
  shopDomain?: string
): string {
  
  const normalizedOrderId = normalizeOrderId(orderId);

  const hashInput = shopDomain 
    ? `${shopDomain}:${normalizedOrderId}:${eventType}`
    : `${normalizedOrderId}:${eventType}`;

  const shortHash = createHash("sha256")
    .update(hashInput, "utf8")
    .digest("hex")
    .slice(0, 8);

  return `${normalizedOrderId}_${eventType}_${shortHash}`;
}

export function normalizeOrderId(orderId: string | number): string {
  const orderIdStr = String(orderId);

  const gidMatch = orderIdStr.match(/gid:\/\/shopify\/Order\/(\d+)/);
  if (gidMatch) {
    return gidMatch[1];
  }

  const numericMatch = orderIdStr.match(/(\d+)$/);
  if (numericMatch) {
    return numericMatch[1];
  }

  console.warn(`[normalizeOrderId] Unable to extract numeric ID from: ${orderIdStr}`);
  return orderIdStr;
}

/**
 * P1-04: Unified match key generation for pixel receipt and webhook deduplication
 * 
 * Match Priority:
 * 1. orderId (normalized numeric ID) - highest priority, most reliable
 * 2. checkoutToken - fallback when orderId is not available
 * 
 * This ensures consistent matching between:
 * - PixelEventReceipt (from pixel events)
 * - ConversionJob (from webhooks)
 * - ConversionLog (final tracking records)
 */

export interface MatchKeyInput {
  orderId?: string | number | null;
  checkoutToken?: string | null;
}

export interface MatchKeyResult {
  /** The primary key used for matching */
  matchKey: string;
  /** Whether the key is an orderId (true) or checkoutToken fallback (false) */
  isOrderId: boolean;
  /** Original orderId if available */
  normalizedOrderId: string | null;
  /** Original checkoutToken if available */
  checkoutToken: string | null;
}

/**
 * Generate a consistent match key for deduplication
 * 
 * @param input - Object containing orderId and/or checkoutToken
 * @returns MatchKeyResult with the key and metadata
 * @throws Error if neither orderId nor checkoutToken is provided
 */
export function generateMatchKey(input: MatchKeyInput): MatchKeyResult {
  const { orderId, checkoutToken } = input;
  
  // Priority 1: Use orderId if available and valid
  if (orderId != null && orderId !== "") {
    const normalizedOrderId = normalizeOrderId(orderId);
    return {
      matchKey: normalizedOrderId,
      isOrderId: true,
      normalizedOrderId,
      checkoutToken: checkoutToken || null,
    };
  }
  
  // Priority 2: Fall back to checkoutToken
  if (checkoutToken != null && checkoutToken !== "") {
    return {
      matchKey: checkoutToken,
      isOrderId: false,
      normalizedOrderId: null,
      checkoutToken,
    };
  }
  
  // Neither available - this is an error condition
  throw new Error(
    "[P1-04] Cannot generate match key: both orderId and checkoutToken are null/empty"
  );
}

/**
 * Check if two match key inputs would produce the same match key
 * 
 * @param a - First input
 * @param b - Second input
 * @returns true if they match by either orderId or checkoutToken
 */
export function matchKeysEqual(a: MatchKeyInput, b: MatchKeyInput): boolean {
  // First check if both have orderId
  if (a.orderId && b.orderId) {
    return normalizeOrderId(a.orderId) === normalizeOrderId(b.orderId);
  }
  
  // Check if orderId from one matches checkoutToken from the other
  // (This handles the case where pixel uses checkoutToken but webhook has orderId)
  if (a.orderId && b.checkoutToken) {
    const normalizedA = normalizeOrderId(a.orderId);
    // checkoutToken might contain the order ID in some formats
    if (b.checkoutToken.includes(normalizedA)) {
      return true;
    }
  }
  if (b.orderId && a.checkoutToken) {
    const normalizedB = normalizeOrderId(b.orderId);
    if (a.checkoutToken.includes(normalizedB)) {
      return true;
    }
  }
  
  // Check if both have the same checkoutToken
  if (a.checkoutToken && b.checkoutToken) {
    return a.checkoutToken === b.checkoutToken;
  }
  
  return false;
}

/**
 * P1-04: Generate a stable fingerprint for deduplication across services
 * 
 * This creates a hash that can be used as a unique identifier regardless
 * of whether the source was pixel or webhook.
 */
export function generateDeduplicationFingerprint(
  shopId: string,
  matchKey: string,
  eventType: string
): string {
  const input = `${shopId}:${matchKey}:${eventType}`;
  return createHash("sha256")
    .update(input, "utf8")
    .digest("hex");
}
