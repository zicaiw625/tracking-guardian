import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "crypto";
import { logger } from "./logger.server";

function clampInt(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, Math.floor(value)));
}

function parseEnvInt(name: string): number | null {
    const raw = process.env[name];
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
}

function readScryptParams(): { N: number; r: number; p: number; maxmem: number } {
    const defaultN = 131072;
    const defaultR = 8;
    const defaultP = 1;
    const defaultMaxmem = 256 * 1024 * 1024;

    const N = clampInt(parseEnvInt("ENCRYPTION_SCRYPT_N") ?? defaultN, 16384, 1048576);
    const r = clampInt(parseEnvInt("ENCRYPTION_SCRYPT_R") ?? defaultR, 1, 32);
    const p = clampInt(parseEnvInt("ENCRYPTION_SCRYPT_P") ?? defaultP, 1, 16);

    const maxmemMb = parseEnvInt("ENCRYPTION_SCRYPT_MAXMEM_MB");
    const maxmemBytesEnv = parseEnvInt("ENCRYPTION_SCRYPT_MAXMEM_BYTES");
    const computedMaxmem = maxmemBytesEnv != null
        ? maxmemBytesEnv
        : maxmemMb != null
        ? maxmemMb * 1024 * 1024
        : defaultMaxmem;
    const maxmem = clampInt(computedMaxmem, 32 * 1024 * 1024, 2 * 1024 * 1024 * 1024);

    return { N, r, p, maxmem };
}

const DEFAULT_ENCRYPTION_SALT = "tracking-guardian-credentials-salt";
const DEV_ENCRYPTION_SALT = "dev-salt-not-for-production";

const FALLBACK_DEV_SECRET = "tg-dev-fallback-" + randomBytes(16).toString("hex");

let cachedKey: Buffer | null = null;
let cachedKeySecret: string | null = null;
let cachedKeySalt: string | null = null;

let hasWarnedAboutFallback = false;
let hasLoggedScryptParams = false;

export function getEncryptionKey(): Buffer {
    const secret = process.env.ENCRYPTION_SECRET;
    const devSecret = process.env.DEV_ENCRYPTION_SECRET;
    const isProduction = process.env.NODE_ENV === "production";
    const isCI = process.env.CI === "true" || process.env.CI === "1";
    const isTest = process.env.NODE_ENV === "test";
    if (!process.env.ENCRYPTION_SALT && isProduction) {
        throw new Error("ENCRYPTION_SALT must be set in production environments");
    }
    const salt = process.env.ENCRYPTION_SALT || DEFAULT_ENCRYPTION_SALT;
    let effectiveSecret: string;
    let usingFallback = false;
    if (secret) {
        effectiveSecret = secret;
        if (secret.length < 32) {
            logger.warn("⚠️ [STARTUP] ENCRYPTION_SECRET is shorter than 32 characters.");
        }
    } else if (devSecret && !isProduction && !isCI) {
        effectiveSecret = devSecret;
        if (!hasWarnedAboutFallback) {
            logger.info("ℹ️ [STARTUP] Using DEV_ENCRYPTION_SECRET for development.");
            hasWarnedAboutFallback = true;
        }
    } else {
        if (isProduction || isCI) {
            throw new Error(
                "ENCRYPTION_SECRET must be set in production and CI environments. " +
                "Generate a secure secret using: openssl rand -base64 32"
            );
        }
        if (isTest && !process.env.ALLOW_INSECURE_TEST_SECRET) {
            throw new Error(
                "ENCRYPTION_SECRET must be set in test environment. " +
                "Set ENCRYPTION_SECRET, DEV_ENCRYPTION_SECRET, or ALLOW_INSECURE_TEST_SECRET=true for local tests."
            );
        }
        const hasShopifyCredentials = Boolean(process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET);
        if (hasShopifyCredentials) {
            throw new Error(
                "ENCRYPTION_SECRET or DEV_ENCRYPTION_SECRET must be set when connecting to a live Shopify app. " +
                "Detected Shopify API credentials in the environment. " +
                "Generate a secure secret using: openssl rand -base64 32"
            );
        }
        effectiveSecret = FALLBACK_DEV_SECRET;
        usingFallback = true;
        if (!hasWarnedAboutFallback) {
            logger.warn(
                "⚠️ [STARTUP] No encryption secret configured. Using random fallback for local development only.\n" +
                "   To fix this warning, add to your .env file:\n" +
                "   DEV_ENCRYPTION_SECRET=$(openssl rand -base64 32)"
            );
            hasWarnedAboutFallback = true;
        }
    }
    const effectiveSalt = usingFallback ? DEV_ENCRYPTION_SALT : salt;
    if (cachedKey && cachedKeySecret === effectiveSecret && cachedKeySalt === effectiveSalt) {
        return cachedKey;
    }
    const scryptParams = readScryptParams();
    if (!hasLoggedScryptParams) {
        logger.info("[STARTUP] Encryption scrypt params", {
            N: scryptParams.N,
            r: scryptParams.r,
            p: scryptParams.p,
            maxmem: scryptParams.maxmem,
        });
        hasLoggedScryptParams = true;
    }
    cachedKey = scryptSync(effectiveSecret, effectiveSalt, 32, scryptParams);
    cachedKeySecret = effectiveSecret;
    cachedKeySalt = effectiveSalt;
    return cachedKey;
}

export function resetEncryptionKeyCache(): void {
    cachedKey = null;
    cachedKeySecret = null;
    cachedKeySalt = null;
    hasWarnedAboutFallback = false;
}

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
        throw new Error("ENCRYPTION_SALT must be set in production environments");
    }
    return { valid: true, warnings, secretSource };
}
const ALGORITHM = "aes-256-gcm";
export const IV_LENGTH = 16;
export const IV_LENGTH_V2 = 12;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const AUTH_TAG_LENGTH = 16;

export type EncryptionVersion = "v1" | "v2";

export function encrypt(plaintext: string, version: EncryptionVersion = "v1"): string {
    const key = getEncryptionKey();
    const ivLength = version === "v2" ? IV_LENGTH_V2 : IV_LENGTH;
    const iv = randomBytes(ivLength);
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
    const ivLength = iv.length;
    
    if (ivLength !== IV_LENGTH && ivLength !== IV_LENGTH_V2) {
        throw new Error(`Invalid IV length: ${ivLength} bytes (expected ${IV_LENGTH} for v1 or ${IV_LENGTH_V2} for v2)`);
    }
    
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
    return createHash("sha256")
        .update(hashInput, "utf8")
        .digest("hex")
        .substring(0, 32);
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
    logger.warn(`[normalizeOrderId] Unable to extract numeric ID from: ${orderIdStr}`);
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
export function makeOrderKey(input: { orderId?: string | number | null; checkoutToken?: string | null }): string | null {
    if (input.orderId != null && input.orderId !== "") {
        return normalizeOrderId(input.orderId);
    }
    if (input.checkoutToken != null && input.checkoutToken !== "") {
        const checkoutTokenHash = hashValueSync(input.checkoutToken);
        return `checkout_${checkoutTokenHash}`;
    }
    return null;
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
        const checkoutTokenHash = hashValueSync(checkoutToken);
        const hashedKey = `checkout_${checkoutTokenHash}`;
        return {
            matchKey: hashedKey,
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
