import { Prisma } from "@prisma/client";
import { logger } from "./logger.server";
import prisma from "../db.server";
import { isProduction } from "./config.server";

interface SecretConfig {
    name: string;
    envVar: string;
    required: boolean;
    minLength?: number;
    pattern?: RegExp;
    description?: string;
}

const REQUIRED_SECRETS: SecretConfig[] = [
    {
        name: "Encryption Secret",
        envVar: "ENCRYPTION_SECRET",
        required: true,
        minLength: 32,
        description: "Used to encrypt sensitive data (tokens, credentials). Generate with: openssl rand -base64 32",
    },
    {
        name: "Encryption Salt",
        envVar: "ENCRYPTION_SALT",
        required: true,
        minLength: 16,
        description: "Salt for key derivation. Use a unique value for each deployment.",
    },
    {
        name: "Cron Secret",
        envVar: "CRON_SECRET",
        required: true,
        minLength: 32,
        description: "Bearer token for cron endpoint authentication. Generate with: openssl rand -base64 32",
    },
    {
        name: "Shopify API Key",
        envVar: "SHOPIFY_API_KEY",
        required: true,
        minLength: 16,
        description: "Shopify app API key from Partners dashboard",
    },
    {
        name: "Shopify API Secret",
        envVar: "SHOPIFY_API_SECRET",
        required: true,
        minLength: 16,
        description: "Shopify app API secret from Partners dashboard",
    },
    {
        name: "Shopify App URL",
        envVar: "SHOPIFY_APP_URL",
        required: true,
        pattern: /^https:\/\/.+/,
        description: "Public URL where the app is hosted (must be HTTPS in production)",
    },
    {
        name: "Database URL",
        envVar: "DATABASE_URL",
        required: true,
        pattern: /^postgres(ql)?:\/\/.+/,
        description: "PostgreSQL connection string",
    },
];

const RECOMMENDED_SECRETS: SecretConfig[] = [
    {
        name: "Redis URL",
        envVar: "REDIS_URL",
        required: false,
        pattern: /^redis(s)?:\/\/.+/,
        description: "Redis connection for distributed rate limiting",
    },
    {
        name: "Resend API Key",
        envVar: "RESEND_API_KEY",
        required: false,
        description: "API key for email notifications via Resend",
    },
];

interface SecurityViolation {
    type: "fatal" | "warning";
    message: string;
    code: string;
}

export function checkSecurityViolations(): SecurityViolation[] {
    const isProduction = process.env.NODE_ENV === "production";
    const violations: SecurityViolation[] = [];
    if (isProduction && process.env.ALLOW_UNSIGNED_PIXEL_EVENTS === "true") {
        violations.push({
            type: "fatal",
            code: "UNSIGNED_PIXEL_EVENTS_PROD",
            message: "[P0-04 SECURITY VIOLATION] ALLOW_UNSIGNED_PIXEL_EVENTS=true is set in production! " +
                "This allows unsigned requests and completely defeats signature security. " +
                "The application MUST NOT start with this configuration. " +
                "Remove this environment variable immediately to proceed.",
        });
    }
    if (!isProduction && process.env.ALLOW_UNSIGNED_PIXEL_EVENTS === "true") {
        violations.push({
            type: "warning",
            code: "UNSIGNED_PIXEL_EVENTS_DEV",
            message: "[P0-04] ALLOW_UNSIGNED_PIXEL_EVENTS=true is set (development mode). " +
                "This is acceptable for development but MUST be removed before production deployment.",
        });
    }
    if (isProduction) {
        if (!process.env.ENCRYPTION_SECRET) {
            violations.push({
                type: "fatal",
                code: "MISSING_ENCRYPTION_SECRET",
                message: "[SECURITY] ENCRYPTION_SECRET is not set in production. " +
                    "This is required for encrypting sensitive data. " +
                    "Generate with: openssl rand -base64 32",
            });
        }
        if (!process.env.CRON_SECRET) {
            violations.push({
                type: "fatal",
                code: "MISSING_CRON_SECRET",
                message: "[SECURITY] CRON_SECRET is not set in production. " +
                    "This is required for cron endpoint authentication. " +
                    "Generate with: openssl rand -base64 32",
            });
        }
        if (!process.env.ENCRYPTION_SALT) {
            violations.push({
                type: "fatal",
                code: "MISSING_ENCRYPTION_SALT",
                message: "[SECURITY] ENCRYPTION_SALT is not set in production. " +
                    "This is required for consistent key derivation across deployments.",
            });
        }
        const appUrl = process.env.SHOPIFY_APP_URL;
        if (appUrl && !appUrl.startsWith("https://")) {
            violations.push({
                type: "fatal",
                code: "INSECURE_APP_URL",
                message: "[SECURITY] SHOPIFY_APP_URL must use HTTPS in production. " +
                    `Current value starts with: ${appUrl.substring(0, 10)}...`,
            });
        }
        const allowNullOrigin = process.env.PIXEL_ALLOW_NULL_ORIGIN;
        if (allowNullOrigin === undefined || allowNullOrigin === "") {
            violations.push({
                type: "fatal",
                code: "PIXEL_NULL_ORIGIN_NOT_CONFIGURED",
                message: "[P0-2 CONFIGURATION ERROR] PIXEL_ALLOW_NULL_ORIGIN is not set in production. " +
                    "When unset: unsigned null/missing Origin requests are rejected; signed null/missing Origin requests are allowed. " +
                    "If your deployment receives pixel events, set PIXEL_ALLOW_NULL_ORIGIN=true; otherwise set PIXEL_ALLOW_NULL_ORIGIN=false explicitly.",
            });
        } else {
            const normalized = allowNullOrigin.toLowerCase().trim();
            if (!["true", "1", "false", "0"].includes(normalized)) {
                violations.push({
                    type: "fatal",
                    code: "PIXEL_NULL_ORIGIN_INVALID",
                    message: "[P0-2 CONFIGURATION ERROR] PIXEL_ALLOW_NULL_ORIGIN has invalid value. " +
                        "Allowed values: 'true', '1', 'false', '0'. " +
                        `Current value: ${allowNullOrigin}`,
                });
            }
        }
        if (process.env.FEATURE_DEBUG_LOGGING === "true") {
            violations.push({
                type: "warning",
                code: "DEBUG_LOGGING_ENABLED",
                message: "[SECURITY] FEATURE_DEBUG_LOGGING=true in production. " +
                    "This may expose sensitive information in logs. Consider disabling.",
            });
        }
        if (process.env.DEFAULT_CONSENT_STRATEGY === "weak") {
            violations.push({
                type: "warning",
                code: "WEAK_CONSENT_DEFAULT",
                message: "[COMPLIANCE] DEFAULT_CONSENT_STRATEGY=weak in production. " +
                    "This may not comply with GDPR requirements. Consider using 'strict' or 'balanced'.",
            });
        }
        if (process.env.TRUST_PROXY !== "true") {
            violations.push({
                type: "fatal",
                code: "TRUST_PROXY_NOT_SET",
                message: "[P0-2 SECURITY] TRUST_PROXY must be 'true' in production. " +
                    "Without TRUST_PROXY=true, rate limiting will use a single shared key for all requests, " +
                    "causing potential self-DoS and incorrect rate limiting. " +
                    "Set TRUST_PROXY=true and configure RATE_LIMIT_TRUSTED_IP_HEADERS if needed.",
            });
        }
        if (!process.env.REDIS_URL) {
            const allowMemory = process.env.ALLOW_MEMORY_REDIS_IN_PROD === "true";
            violations.push({
                type: allowMemory ? "warning" : "fatal",
                code: "REDIS_URL_REQUIRED_IN_PRODUCTION",
                message: allowMemory
                    ? "[SECURITY] REDIS_URL is not set; using in-memory store (ALLOW_MEMORY_REDIS_IN_PROD=true). " +
                      "Rate limiting is not shared across instances. Add REDIS_URL when you scale to multiple instances."
                    : "[SECURITY] REDIS_URL is required in production for distributed rate limiting. " +
                      "Multi-instance deployments without Redis allow attackers to bypass rate limits by rotating across instances. " +
                      "Configure REDIS_URL to proceed. For single-instance only, you may set ALLOW_MEMORY_REDIS_IN_PROD=true to use in-memory (not recommended for multi-instance).",
            });
        }
        if (process.env.LOCAL_DEV === "true" || process.env.LOCAL_DEV === "1") {
            violations.push({
                type: "fatal",
                code: "LOCAL_DEV_FORBIDDEN_IN_PRODUCTION",
                message: "[SECURITY] LOCAL_DEV=true or LOCAL_DEV=1 is set in production. " +
                    "LOCAL_DEV must not be used in production or staging. " +
                    "It can allow unauthenticated cron access when CRON_SECRET is missing. " +
                    "Remove LOCAL_DEV from production and staging environment variables.",
            });
        }
    }
    const suspiciousPatterns = [
        /^(test|demo|example|placeholder|changeme|secret|password|xxx+|000+)$/i,
        /^INSECURE.*DEV/i,
    ];
    const secretsToCheck = ["ENCRYPTION_SECRET", "CRON_SECRET", "SHOPIFY_API_SECRET"];
    for (const secretName of secretsToCheck) {
        const value = process.env[secretName];
        if (value) {
            for (const pattern of suspiciousPatterns) {
                if (pattern.test(value)) {
                    violations.push({
                        type: isProduction ? "fatal" : "warning",
                        code: `SUSPICIOUS_SECRET_${secretName}`,
                        message: `[SECURITY] ${secretName} appears to be a placeholder or default value. ` +
                            "Use a properly generated random secret.",
                    });
                    break;
                }
            }
        }
    }
    return violations;
}
export async function checkLegacyPlaintextCredentials(): Promise<SecurityViolation[]> {
    const violations: SecurityViolation[] = [];
    if (!isProduction()) {
        return violations;
    }
    try {
        const configsWithLegacy = await prisma.pixelConfig.findMany({
            where: {
                credentials_legacy: { not: Prisma.DbNull },
            },
            select: {
                id: true,
                shopId: true,
                platform: true,
                credentials_legacy: true,
            },
            take: 100,
        });
        for (const config of configsWithLegacy) {
            if (config.credentials_legacy && typeof config.credentials_legacy === "object") {
                violations.push({
                    type: "fatal",
                    code: "LEGACY_PLAINTEXT_CREDENTIALS",
                    message: `[P0-3 SECURITY VIOLATION] Legacy plaintext credentials detected in production for PixelConfig ${config.id} (platform: ${config.platform}, shopId: ${config.shopId}). ` +
                        "Legacy plaintext credentials are not allowed in production. " +
                        "Please migrate to encrypted credentials using credentialsEncrypted field. " +
                        "Run a migration script to encrypt and move credentials, then clear credentials_legacy.",
                });
            }
        }
        if (violations.length > 0) {
            logger.error(`Found ${violations.length} PixelConfig(s) with legacy plaintext credentials in production`);
        }
    } catch (error) {
        // Handle column not found error (P2022) - credentials_legacy column may not exist in the database
        if (error && typeof error === "object" && "code" in error && error.code === "P2022") {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes("credentials_legacy") && errorMessage.includes("does not exist")) {
                logger.warn("PixelConfig.credentials_legacy column does not exist in database. This is expected if the column was removed or not yet created. Skipping legacy credentials check.", {
                    error: errorMessage,
                });
                return violations;
            }
        }
        logger.warn("Failed to check for legacy plaintext credentials during startup", { error: error instanceof Error ? error.message : String(error) });
    }
    return violations;
}

export async function enforceSecurityChecks(): Promise<void> {
    const violations = checkSecurityViolations();
    const legacyCredentialViolations = await checkLegacyPlaintextCredentials();
    const allViolations = [...violations, ...legacyCredentialViolations];
    const fatalViolations = allViolations.filter(v => v.type === "fatal");
    const warnings = allViolations.filter(v => v.type === "warning");
    for (const warning of warnings) {
        logger.warn(warning.message, { code: warning.code });
    }
    if (allViolations.length > 0) {
        const summary = [
            "\n" + "=".repeat(80),
            "SECURITY CHECK SUMMARY",
            "=".repeat(80),
            `Environment: ${process.env.NODE_ENV || "development"}`,
            `Fatal issues: ${fatalViolations.length}`,
            `Warnings: ${warnings.length}`,
            "=".repeat(80) + "\n"
        ].join("\n");
        logger.info(summary);
    }
    if (fatalViolations.length > 0) {
        const errorMessage = fatalViolations.map(v => `[${v.code}] ${v.message}`).join("\n\n");
        logger.error("FATAL SECURITY VIOLATION - Application startup aborted", undefined, {
            violations: fatalViolations.map(v => ({ code: v.code, message: v.message })),
        });
        throw new Error(`\n\n${"=".repeat(80)}\n` +
            `FATAL SECURITY VIOLATION - APPLICATION STARTUP ABORTED\n` +
            `${"=".repeat(80)}\n\n` +
            `${errorMessage}\n\n` +
            `${"=".repeat(80)}\n`);
    }
    if (allViolations.length === 0) {
        logger.info("Security checks passed - no violations detected");
    }
}

interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    missingRequired: string[];
    missingRecommended: string[];
}

export function validateSecrets(): ValidationResult {
    const isProduction = process.env.NODE_ENV === "production";
    const errors: string[] = [];
    const warnings: string[] = [];
    const missingRequired: string[] = [];
    const missingRecommended: string[] = [];
    for (const secret of REQUIRED_SECRETS) {
        const value = process.env[secret.envVar];
        if (!value) {
            if (secret.required) {
                missingRequired.push(secret.envVar);
                if (isProduction) {
                    errors.push(`${secret.name} (${secret.envVar}) is not set. ${secret.description || ""}`);
                } else {
                    warnings.push(`${secret.name} (${secret.envVar}) is not set - using insecure default`);
                }
            }
            continue;
        }
        if (secret.minLength && value.length < secret.minLength) {
            const message = `${secret.name} (${secret.envVar}) is shorter than recommended ${secret.minLength} characters`;
            warnings.push(message);
        }
        if (secret.pattern && !secret.pattern.test(value)) {
            const message = `${secret.name} (${secret.envVar}) does not match expected format`;
            if (isProduction) {
                errors.push(message);
            } else {
                warnings.push(message);
            }
        }
    }
    for (const secret of RECOMMENDED_SECRETS) {
        const value = process.env[secret.envVar];
        if (!value) {
            missingRecommended.push(secret.envVar);
            if (isProduction) {
                warnings.push(`${secret.name} (${secret.envVar}) is not set - ${secret.description || "recommended for production"}`);
            }
        } else if (secret.pattern && !secret.pattern.test(value)) {
            warnings.push(`${secret.name} (${secret.envVar}) does not match expected format`);
        }
    }
    for (const warning of warnings) {
        logger.warn(`Secret validation: ${warning}`);
    }
    for (const error of errors) {
        logger.error(`Secret validation: ${error}`);
    }
    return {
        valid: errors.length === 0,
        errors,
        warnings,
        missingRequired,
        missingRecommended,
    };
}

export function getSecretsSummary(): {
    configured: string[];
    missing: string[];
    recommended: { configured: string[]; missing: string[] };
} {
    const configured: string[] = [];
    const missing: string[] = [];
    const recommendedConfigured: string[] = [];
    const recommendedMissing: string[] = [];
    for (const secret of REQUIRED_SECRETS) {
        if (process.env[secret.envVar]) {
            configured.push(secret.envVar);
        } else {
            missing.push(secret.envVar);
        }
    }
    for (const secret of RECOMMENDED_SECRETS) {
        if (process.env[secret.envVar]) {
            recommendedConfigured.push(secret.envVar);
        } else {
            recommendedMissing.push(secret.envVar);
        }
    }
    return {
        configured,
        missing,
        recommended: {
            configured: recommendedConfigured,
            missing: recommendedMissing,
        },
    };
}
export function ensureSecretsValid(): void {
    const result = validateSecrets();
    if (!result.valid) {
        const message = `Missing or invalid secrets:\n${result.errors.join("\n")}`;
        if (process.env.NODE_ENV === "production") {
            throw new Error(message);
        }
        else {
            logger.error("Secrets validation failed (continuing in development mode)", undefined, {
                errors: result.errors,
            });
        }
    }
}
export function getRequiredSecret(envVar: string): string {
    const value = process.env[envVar];
    if (!value) {
        if (process.env.NODE_ENV === "production") {
            throw new Error(`Required secret ${envVar} is not set`);
        }
        logger.warn(`Required secret ${envVar} not set, using empty string in development`);
        return "";
    }
    return value;
}
export function getOptionalSecret(envVar: string, defaultValue: string): string {
    return process.env[envVar] || defaultValue;
}
