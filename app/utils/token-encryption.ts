import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SCRYPT_PARAMS = {
    N: 131072,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
};
const CURRENT_VERSION = "v1";
const VERSION_PREFIX = `${CURRENT_VERSION}:`;
const DEFAULT_ENCRYPTION_SALT = "tracking-guardian-credentials-salt";
const DEV_ENCRYPTION_SALT = "dev-salt-not-for-production";
let cachedTokenKey: Buffer | null = null;
let cachedTokenKeySecret: string | null = null;
let cachedTokenKeySalt: string | null = null;
function getTokenEncryptionKey(): Buffer {
    const secret = process.env.ENCRYPTION_SECRET;
    const salt = process.env.ENCRYPTION_SALT || DEFAULT_ENCRYPTION_SALT;
    if (!secret) {
        if (process.env.NODE_ENV === "production") {
            throw new Error("ENCRYPTION_SECRET must be set in production. " +
                "Generate a secure secret using: openssl rand -base64 32");
        }
        console.warn("⚠️ [Token Encryption] ENCRYPTION_SECRET not set. " +
            "Using insecure default for development only.");
        const devSecret = "INSECURE_DEV_SECRET_DO_NOT_USE_IN_PRODUCTION";
        return scryptSync(devSecret, DEV_ENCRYPTION_SALT, 32, SCRYPT_PARAMS);
    }
    if (cachedTokenKey && cachedTokenKeySecret === secret && cachedTokenKeySalt === salt) {
        return cachedTokenKey;
    }
    if (!process.env.ENCRYPTION_SALT && process.env.NODE_ENV === "production") {
        console.warn("⚠️ [Token Encryption] ENCRYPTION_SALT not set. Using default salt. " +
            "Set ENCRYPTION_SALT environment variable for consistent encryption across deployments.");
    }
    cachedTokenKey = scryptSync(secret, salt, 32, SCRYPT_PARAMS);
    cachedTokenKeySecret = secret;
    cachedTokenKeySalt = salt;
    return cachedTokenKey;
}
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
    return `${VERSION_PREFIX}${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}
export function decryptAccessToken(encryptedToken: string): string {
    if (!encryptedToken) {
        return "";
    }
    if (!encryptedToken.startsWith(VERSION_PREFIX)) {
        console.warn("[Token Encryption] Found unencrypted legacy token. " +
            "It will be encrypted on next auth refresh.");
        return encryptedToken;
    }
    try {
        const key = getTokenEncryptionKey();
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
    }
    catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        console.error(`[Token Encryption] Decryption failed: ${errorMsg}`);
        throw new TokenDecryptionError("Failed to decrypt access token. Re-authentication required.", { cause: error });
    }
}
export function isTokenEncrypted(token: string | null | undefined): boolean {
    if (!token)
        return false;
    return token.startsWith(VERSION_PREFIX);
}
export function ensureTokenEncrypted(token: string): string {
    if (!token)
        return "";
    if (isTokenEncrypted(token))
        return token;
    return encryptAccessToken(token);
}
export function encryptIngestionSecret(secret: string): string {
    return encryptAccessToken(secret);
}
export function decryptIngestionSecret(encryptedSecret: string): string {
    if (!encryptedSecret)
        return "";
    try {
        return decryptAccessToken(encryptedSecret);
    }
    catch {
        console.warn("[Token Encryption] Failed to decrypt ingestion secret. " +
            "Shop should regenerate via Settings.");
        return "";
    }
}
export function generateEncryptedIngestionSecret(): {
    plain: string;
    encrypted: string;
} {
    const plain = randomBytes(32).toString("hex");
    const encrypted = encryptIngestionSecret(plain);
    return { plain, encrypted };
}
export class TokenDecryptionError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "TokenDecryptionError";
    }
}
export function migrateToEncrypted(token: string | null | undefined): string | null {
    if (!token)
        return null;
    if (isTokenEncrypted(token))
        return null;
    return encryptAccessToken(token);
}
export function validateTokenEncryptionConfig(): {
    valid: boolean;
    warnings: string[];
} {
    const warnings: string[] = [];
    const isProduction = process.env.NODE_ENV === "production";
    if (!process.env.ENCRYPTION_SECRET) {
        if (isProduction) {
            throw new Error("ENCRYPTION_SECRET must be set in production");
        }
        warnings.push("ENCRYPTION_SECRET not set - using insecure development default");
    }
    else if (process.env.ENCRYPTION_SECRET.length < 32) {
        warnings.push("ENCRYPTION_SECRET is shorter than recommended 32 characters");
    }
    if (!process.env.ENCRYPTION_SALT && isProduction) {
        warnings.push("ENCRYPTION_SALT not set - using default salt");
    }
    return { valid: true, warnings };
}
