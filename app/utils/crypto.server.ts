import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "crypto";

// =============================================================================
// Configuration Constants
// =============================================================================

const SCRYPT_PARAMS = {
    N: 131072,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
};

const DEFAULT_ENCRYPTION_SALT = "tracking-guardian-credentials-salt";
const DEV_ENCRYPTION_SALT = "dev-salt-not-for-production";

/**
 * Fallback development secret, used only when:
 * 1. NOT in production or CI
 * 2. NOT connected to a live Shopify app
 * 3. DEV_ENCRYPTION_SECRET is not set
 * 4. ENCRYPTION_SECRET is not set
 * 
 * SECURITY NOTE: This fallback is intentionally weak to encourage proper secret configuration.
 * Set DEV_ENCRYPTION_SECRET or ENCRYPTION_SECRET in your .env file for development.
 */
const FALLBACK_DEV_SECRET = "tg-dev-fallback-" + randomBytes(16).toString("hex");

// Cache for derived keys
let cachedKey: Buffer | null = null;
let cachedKeySecret: string | null = null;
let cachedKeySalt: string | null = null;

// Track whether we've warned about using fallback secret (to avoid spamming logs)
let hasWarnedAboutFallback = false;

// =============================================================================
// Key Derivation
// =============================================================================

/**
 * Get the encryption key derived from ENCRYPTION_SECRET.
 * This is the centralized key derivation function used by all encryption utilities.
 * Uses scrypt with secure parameters for key derivation.
 * 
 * Environment Variables:
 * - ENCRYPTION_SECRET: Required in production/CI. Primary encryption secret.
 * - DEV_ENCRYPTION_SECRET: Optional. Development-specific secret (recommended for dev).
 * - ENCRYPTION_SALT: Optional. Salt for key derivation.
 * - ALLOW_INSECURE_TEST_SECRET: Set to "true" to allow fallback in test environment.
 * 
 * Priority order for secret:
 * 1. ENCRYPTION_SECRET (if set)
 * 2. DEV_ENCRYPTION_SECRET (if in development and set)
 * 3. Fallback (only in development, with warnings)
 * 
 * @returns 32-byte encryption key buffer
 * @throws Error in production if ENCRYPTION_SECRET is not set
 */
export function getEncryptionKey(): Buffer {
    const secret = process.env.ENCRYPTION_SECRET;
    const devSecret = process.env.DEV_ENCRYPTION_SECRET;
    const salt = process.env.ENCRYPTION_SALT || DEFAULT_ENCRYPTION_SALT;
    const isProduction = process.env.NODE_ENV === "production";
    const isCI = process.env.CI === "true" || process.env.CI === "1";
    const isTest = process.env.NODE_ENV === "test";

    // Determine which secret to use
    let effectiveSecret: string;
    let usingFallback = false;

    if (secret) {
        // Primary secret is set - use it
        effectiveSecret = secret;
        
        if (secret.length < 32) {
            // eslint-disable-next-line no-console
            console.warn("⚠️ [STARTUP] ENCRYPTION_SECRET is shorter than 32 characters.");
        }
    } else if (devSecret && !isProduction && !isCI) {
        // Use development-specific secret
        effectiveSecret = devSecret;
        
        if (!hasWarnedAboutFallback) {
            // eslint-disable-next-line no-console
            console.info("ℹ️ [STARTUP] Using DEV_ENCRYPTION_SECRET for development.");
            hasWarnedAboutFallback = true;
        }
    } else {
        // No secret provided - check if we can use fallback
        
        // Production and CI environments must have ENCRYPTION_SECRET configured
        if (isProduction || isCI) {
            throw new Error(
                "ENCRYPTION_SECRET must be set in production and CI environments. " +
                "Generate a secure secret using: openssl rand -base64 32"
            );
        }
        
        // Test environment requires explicit opt-in for fallback
        if (isTest && !process.env.ALLOW_INSECURE_TEST_SECRET) {
            throw new Error(
                "ENCRYPTION_SECRET must be set in test environment. " +
                "Set ENCRYPTION_SECRET, DEV_ENCRYPTION_SECRET, or ALLOW_INSECURE_TEST_SECRET=true for local tests."
            );
        }
        
        // Additional safety: if Shopify credentials are configured, require a proper secret
        // This prevents accidentally using the fallback with a real Shopify app
        const hasShopifyCredentials = Boolean(process.env.SHOPIFY_API_SECRET);
        const hasShopifyAppUrl = Boolean(process.env.SHOPIFY_APP_URL?.includes(".myshopify."));
        if (hasShopifyCredentials && hasShopifyAppUrl) {
            throw new Error(
                "ENCRYPTION_SECRET or DEV_ENCRYPTION_SECRET must be set when connecting to a live Shopify app. " +
                "Detected SHOPIFY_API_SECRET and a myshopify.com URL. " +
                "Generate a secure secret using: openssl rand -base64 32"
            );
        }
        
        // Use fallback for local development only
        effectiveSecret = FALLBACK_DEV_SECRET;
        usingFallback = true;
        
        if (!hasWarnedAboutFallback) {
            // eslint-disable-next-line no-console
            console.warn(
                "⚠️ [STARTUP] No encryption secret configured. Using random fallback for local development only.\n" +
                "   To fix this warning, add to your .env file:\n" +
                "   DEV_ENCRYPTION_SECRET=$(openssl rand -base64 32)"
            );
            hasWarnedAboutFallback = true;
        }
    }

    // Use cached key if available and matches current config
    const effectiveSalt = usingFallback ? DEV_ENCRYPTION_SALT : salt;
    if (cachedKey && cachedKeySecret === effectiveSecret && cachedKeySalt === effectiveSalt) {
        return cachedKey;
    }

    // Log salt warning in production
    if (!process.env.ENCRYPTION_SALT && isProduction) {
        // eslint-disable-next-line no-console
        console.warn("⚠️ [STARTUP] ENCRYPTION_SALT not set. Using default salt.");
    }

    // Derive and cache the key
    cachedKey = scryptSync(effectiveSecret, effectiveSalt, 32, SCRYPT_PARAMS);
    cachedKeySecret = effectiveSecret;
    cachedKeySalt = effectiveSalt;
    
    return cachedKey;
}

/**
 * Reset the cached encryption key (for testing purposes).
 * This should only be called in tests.
 */
export function resetEncryptionKeyCache(): void {
    cachedKey = null;
    cachedKeySecret = null;
    cachedKeySalt = null;
    hasWarnedAboutFallback = false;
}
/**
 * Validate encryption configuration and return any warnings.
 * 
 * @returns Validation result with warnings
 * @throws Error if configuration is invalid for the current environment
 */
export function validateEncryptionConfig(): {
    valid: boolean;
    warnings: string[];
    secretSource: "ENCRYPTION_SECRET" | "DEV_ENCRYPTION_SECRET" | "fallback" | "none";
} {
    const warnings: string[] = [];
    const isProduction = process.env.NODE_ENV === "production";
    const isCI = process.env.CI === "true" || process.env.CI === "1";
    const isTest = process.env.NODE_ENV === "test";
    
    let secretSource: "ENCRYPTION_SECRET" | "DEV_ENCRYPTION_SECRET" | "fallback" | "none" = "none";

    if (process.env.ENCRYPTION_SECRET) {
        secretSource = "ENCRYPTION_SECRET";
        if (process.env.ENCRYPTION_SECRET.length < 32) {
            warnings.push("ENCRYPTION_SECRET is shorter than recommended 32 characters");
        }
    } else if (process.env.DEV_ENCRYPTION_SECRET && !isProduction && !isCI) {
        secretSource = "DEV_ENCRYPTION_SECRET";
        if (process.env.DEV_ENCRYPTION_SECRET.length < 32) {
            warnings.push("DEV_ENCRYPTION_SECRET is shorter than recommended 32 characters");
        }
    } else {
        // No secret set
        if (isProduction || isCI) {
            throw new Error("ENCRYPTION_SECRET must be set in production and CI environments");
        }
        if (isTest && !process.env.ALLOW_INSECURE_TEST_SECRET) {
            throw new Error("ENCRYPTION_SECRET or DEV_ENCRYPTION_SECRET must be set in test environment");
        }
        
        secretSource = "fallback";
        warnings.push(
            "No encryption secret configured. Using random fallback. " +
            "Set DEV_ENCRYPTION_SECRET in .env for consistent development encryption."
        );
    }
    
    if (!process.env.ENCRYPTION_SALT && isProduction) {
        warnings.push("ENCRYPTION_SALT not set - using default salt");
    }
    
    return { valid: true, warnings, secretSource };
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
export function generateEventId(orderId: string, eventType: string, shopDomain?: string): string {
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
    // This is a rare edge case that shouldn't happen in normal operation
    // Using console.warn to avoid circular dependency with logger
    // eslint-disable-next-line no-console
    console.warn(`[normalizeOrderId] Unable to extract numeric ID from: ${orderIdStr}`);
    return orderIdStr;
}
export interface MatchKeyInput {
    orderId?: string | number | null;
    checkoutToken?: string | null;
}
export interface MatchKeyResult {
    matchKey: string;
    isOrderId: boolean;
    normalizedOrderId: string | null;
    checkoutToken: string | null;
}
export function generateMatchKey(input: MatchKeyInput): MatchKeyResult {
    const { orderId, checkoutToken } = input;
    if (orderId != null && orderId !== "") {
        const normalizedOrderId = normalizeOrderId(orderId);
        return {
            matchKey: normalizedOrderId,
            isOrderId: true,
            normalizedOrderId,
            checkoutToken: checkoutToken || null,
        };
    }
    if (checkoutToken != null && checkoutToken !== "") {
        return {
            matchKey: checkoutToken,
            isOrderId: false,
            normalizedOrderId: null,
            checkoutToken,
        };
    }
    throw new Error("[P1-04] Cannot generate match key: both orderId and checkoutToken are null/empty");
}
export function matchKeysEqual(a: MatchKeyInput, b: MatchKeyInput): boolean {
    if (a.orderId && b.orderId) {
        return normalizeOrderId(a.orderId) === normalizeOrderId(b.orderId);
    }
    if (a.orderId && b.checkoutToken) {
        const normalizedA = normalizeOrderId(a.orderId);
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
    if (a.checkoutToken && b.checkoutToken) {
        return a.checkoutToken === b.checkoutToken;
    }
    return false;
}
export function generateDeduplicationFingerprint(shopId: string, matchKey: string, eventType: string): string {
    const input = `${shopId}:${matchKey}:${eventType}`;
    return createHash("sha256")
        .update(input, "utf8")
        .digest("hex");
}
