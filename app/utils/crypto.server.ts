import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "crypto";
const SCRYPT_PARAMS = {
    N: 131072,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
};
const DEFAULT_ENCRYPTION_SALT = "tracking-guardian-credentials-salt";
const DEV_ENCRYPTION_SALT = "dev-salt-not-for-production";
let cachedKey: Buffer | null = null;
let cachedKeySecret: string | null = null;
let cachedKeySalt: string | null = null;

/**
 * Get the encryption key derived from ENCRYPTION_SECRET.
 * This is the centralized key derivation function used by all encryption utilities.
 * Uses scrypt with secure parameters for key derivation.
 * 
 * @returns 32-byte encryption key buffer
 * @throws Error in production if ENCRYPTION_SECRET is not set
 */
export function getEncryptionKey(): Buffer {
    const secret = process.env.ENCRYPTION_SECRET;
    const salt = process.env.ENCRYPTION_SALT || DEFAULT_ENCRYPTION_SALT;
    const isProduction = process.env.NODE_ENV === "production";
    const isCI = process.env.CI === "true" || process.env.CI === "1";
    const isTest = process.env.NODE_ENV === "test";
    if (!secret) {
        // Production and CI environments must have ENCRYPTION_SECRET configured
        if (isProduction || isCI) {
            throw new Error("ENCRYPTION_SECRET must be set in production and CI environments. " +
                "Generate a secure secret using: openssl rand -base64 32");
        }
        // Only allow insecure default in local development (not test/CI)
        if (isTest && !process.env.ALLOW_INSECURE_TEST_SECRET) {
            throw new Error("ENCRYPTION_SECRET must be set in test environment. " +
                "Set ENCRYPTION_SECRET or ALLOW_INSECURE_TEST_SECRET=true for local tests.");
        }
        // Additional safety: if Shopify credentials are configured, require ENCRYPTION_SECRET
        // This prevents accidentally using the dev key with a real Shopify app
        const hasShopifyCredentials = Boolean(process.env.SHOPIFY_API_SECRET);
        const hasShopifyAppUrl = Boolean(process.env.SHOPIFY_APP_URL?.includes(".myshopify."));
        if (hasShopifyCredentials && hasShopifyAppUrl) {
            throw new Error(
                "ENCRYPTION_SECRET must be set when connecting to a live Shopify app. " +
                "Detected SHOPIFY_API_SECRET and a myshopify.com URL. " +
                "Generate a secure secret using: openssl rand -base64 32"
            );
        }
        // Using console.warn here intentionally - this runs at startup before logger may be initialized
        // eslint-disable-next-line no-console
        console.warn("⚠️ [STARTUP] ENCRYPTION_SECRET not set. Using insecure default for local development only.");
        const devSecret = "INSECURE_DEV_SECRET_DO_NOT_USE_IN_PRODUCTION";
        return scryptSync(devSecret, DEV_ENCRYPTION_SALT, 32, SCRYPT_PARAMS);
    }
    if (secret.length < 32) {
        // eslint-disable-next-line no-console
        console.warn("⚠️ [STARTUP] ENCRYPTION_SECRET is shorter than 32 characters.");
    }
    if (cachedKey && cachedKeySecret === secret && cachedKeySalt === salt) {
        return cachedKey;
    }
    if (!process.env.ENCRYPTION_SALT && process.env.NODE_ENV === "production") {
        // eslint-disable-next-line no-console
        console.warn("⚠️ [STARTUP] ENCRYPTION_SALT not set. Using default salt.");
    }
    cachedKey = scryptSync(secret, salt, 32, SCRYPT_PARAMS);
    cachedKeySecret = secret;
    cachedKeySalt = salt;
    return cachedKey;
}
export function validateEncryptionConfig(): {
    valid: boolean;
    warnings: string[];
} {
    const warnings: string[] = [];
    const isProduction = process.env.NODE_ENV === "production";
    const isCI = process.env.CI === "true" || process.env.CI === "1";
    const isTest = process.env.NODE_ENV === "test";
    if (!process.env.ENCRYPTION_SECRET) {
        if (isProduction || isCI) {
            throw new Error("ENCRYPTION_SECRET must be set in production and CI environments");
        }
        if (isTest && !process.env.ALLOW_INSECURE_TEST_SECRET) {
            throw new Error("ENCRYPTION_SECRET must be set in test environment");
        }
        warnings.push("ENCRYPTION_SECRET not set - using insecure development default");
    }
    else if (process.env.ENCRYPTION_SECRET.length < 32) {
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
