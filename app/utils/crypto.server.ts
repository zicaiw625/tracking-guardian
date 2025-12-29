import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "crypto";

const SCRYPT_PARAMS = {
    N: 131072,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
};

const DEFAULT_ENCRYPTION_SALT = "tracking-guardian-credentials-salt";
const DEV_ENCRYPTION_SALT = "dev-salt-not-for-production";

const FALLBACK_DEV_SECRET = "tg-dev-fallback-" + randomBytes(16).toString("hex");

let cachedKey: Buffer | null = null;
let cachedKeySecret: string | null = null;
let cachedKeySalt: string | null = null;

let hasWarnedAboutFallback = false;

export function getEncryptionKey(): Buffer {
    const secret = process.env.ENCRYPTION_SECRET;
    const devSecret = process.env.DEV_ENCRYPTION_SECRET;
    const salt = process.env.ENCRYPTION_SALT || DEFAULT_ENCRYPTION_SALT;
    const isProduction = process.env.NODE_ENV === "production";
    const isCI = process.env.CI === "true" || process.env.CI === "1";
    const isTest = process.env.NODE_ENV === "test";

    let effectiveSecret: string;
    let usingFallback = false;

    if (secret) {

        effectiveSecret = secret;

        if (secret.length < 32) {

            console.warn("⚠️ [STARTUP] ENCRYPTION_SECRET is shorter than 32 characters.");
        }
    } else if (devSecret && !isProduction && !isCI) {

        effectiveSecret = devSecret;

        if (!hasWarnedAboutFallback) {

            console.info("ℹ️ [STARTUP] Using DEV_ENCRYPTION_SECRET for development.");
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

        const hasShopifyCredentials = Boolean(process.env.SHOPIFY_API_SECRET);
        const hasShopifyAppUrl = Boolean(process.env.SHOPIFY_APP_URL?.includes(".myshopify."));
        if (hasShopifyCredentials && hasShopifyAppUrl) {
            throw new Error(
                "ENCRYPTION_SECRET or DEV_ENCRYPTION_SECRET must be set when connecting to a live Shopify app. " +
                "Detected SHOPIFY_API_SECRET and a myshopify.com URL. " +
                "Generate a secure secret using: openssl rand -base64 32"
            );
        }

        effectiveSecret = FALLBACK_DEV_SECRET;
        usingFallback = true;

        if (!hasWarnedAboutFallback) {

            console.warn(
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

    if (!process.env.ENCRYPTION_SALT && isProduction) {

        console.warn("⚠️ [STARTUP] ENCRYPTION_SALT not set. Using default salt.");
    }

    cachedKey = scryptSync(effectiveSecret, effectiveSalt, 32, SCRYPT_PARAMS);
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
/**
 * 生成确定性 Event ID（统一实现）
 * 使用 orderId + eventType + shopDomain 组合确保唯一性
 * 格式: 32字符的SHA256哈希（与 capi-dedup.server.ts 保持一致）
 * 
 * 注意: 此函数与 app/services/capi-dedup.server.ts 中的 generateEventId 保持一致
 * 如果修改此函数，请同步修改 capi-dedup.server.ts
 */
export function generateEventId(orderId: string, eventType: string, shopDomain?: string): string {
    const normalizedOrderId = normalizeOrderId(orderId);
    const hashInput = shopDomain
        ? `${shopDomain}:${normalizedOrderId}:${eventType}`
        : `${normalizedOrderId}:${eventType}`;
    // 使用32字符hash，与 capi-dedup.server.ts 保持一致
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
