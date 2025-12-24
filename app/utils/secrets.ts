import { logger } from "./logger.server";

// =============================================================================
// Types
// =============================================================================

interface SecretConfig {
    name: string;
    envVar: string;
    required: boolean;
    minLength?: number;
    pattern?: RegExp;
    description?: string;
}

// =============================================================================
// Required Secrets Configuration
// =============================================================================

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
        required: false,
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

// Optional but recommended secrets
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
// =============================================================================
// Security Violation Types
// =============================================================================

interface SecurityViolation {
    type: "fatal" | "warning";
    message: string;
    code: string;
}

// =============================================================================
// Security Violation Checks
// =============================================================================

export function checkSecurityViolations(): SecurityViolation[] {
    const isProduction = process.env.NODE_ENV === "production";
    const violations: SecurityViolation[] = [];

    // P0-04: Check for unsigned pixel events in production
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

    // Check for insecure development defaults in production
    if (isProduction) {
        // Check ENCRYPTION_SECRET is set
        if (!process.env.ENCRYPTION_SECRET) {
            violations.push({
                type: "fatal",
                code: "MISSING_ENCRYPTION_SECRET",
                message: "[SECURITY] ENCRYPTION_SECRET is not set in production. " +
                    "This is required for encrypting sensitive data. " +
                    "Generate with: openssl rand -base64 32",
            });
        }

        // Check CRON_SECRET is set
        if (!process.env.CRON_SECRET) {
            violations.push({
                type: "fatal",
                code: "MISSING_CRON_SECRET",
                message: "[SECURITY] CRON_SECRET is not set in production. " +
                    "This is required for cron endpoint authentication. " +
                    "Generate with: openssl rand -base64 32",
            });
        }

        // Check SHOPIFY_APP_URL is HTTPS
        const appUrl = process.env.SHOPIFY_APP_URL;
        if (appUrl && !appUrl.startsWith("https://")) {
            violations.push({
                type: "fatal",
                code: "INSECURE_APP_URL",
                message: "[SECURITY] SHOPIFY_APP_URL must use HTTPS in production. " +
                    `Current value starts with: ${appUrl.substring(0, 10)}...`,
            });
        }

        // Check for debug flags that shouldn't be enabled in production
        if (process.env.FEATURE_DEBUG_LOGGING === "true") {
            violations.push({
                type: "warning",
                code: "DEBUG_LOGGING_ENABLED",
                message: "[SECURITY] FEATURE_DEBUG_LOGGING=true in production. " +
                    "This may expose sensitive information in logs. Consider disabling.",
            });
        }

        // Check for weak consent mode in production (warning only)
        if (process.env.DEFAULT_CONSENT_STRATEGY === "weak") {
            violations.push({
                type: "warning",
                code: "WEAK_CONSENT_DEFAULT",
                message: "[COMPLIANCE] DEFAULT_CONSENT_STRATEGY=weak in production. " +
                    "This may not comply with GDPR requirements. Consider using 'strict' or 'balanced'.",
            });
        }
    }

    // Check for secrets that look like defaults or placeholders
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
export function enforceSecurityChecks(): void {
    const violations = checkSecurityViolations();
    const fatalViolations = violations.filter(v => v.type === "fatal");
    const warnings = violations.filter(v => v.type === "warning");

    // Log warnings
    for (const warning of warnings) {
        logger.warn(warning.message, { code: warning.code });
    }

    // Print security summary to console for visibility
    if (violations.length > 0) {
        // Using console intentionally for startup visibility
        // eslint-disable-next-line no-console
        console.log("\n" + "=".repeat(80));
        // eslint-disable-next-line no-console
        console.log("SECURITY CHECK SUMMARY");
        // eslint-disable-next-line no-console
        console.log("=".repeat(80));
        // eslint-disable-next-line no-console
        console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
        // eslint-disable-next-line no-console
        console.log(`Fatal issues: ${fatalViolations.length}`);
        // eslint-disable-next-line no-console
        console.log(`Warnings: ${warnings.length}`);
        // eslint-disable-next-line no-console
        console.log("=".repeat(80) + "\n");
    }

    // Abort on fatal violations
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

    // Log success if no issues
    if (violations.length === 0) {
        logger.info("Security checks passed - no violations detected");
    }
}
// =============================================================================
// Validation
// =============================================================================

interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    missingRequired: string[];
    missingRecommended: string[];
}

/**
 * Validate all required and recommended secrets.
 */
export function validateSecrets(): ValidationResult {
    const isProduction = process.env.NODE_ENV === "production";
    const errors: string[] = [];
    const warnings: string[] = [];
    const missingRequired: string[] = [];
    const missingRecommended: string[] = [];

    // Check required secrets
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

        // Check minimum length
        if (secret.minLength && value.length < secret.minLength) {
            const message = `${secret.name} (${secret.envVar}) is shorter than recommended ${secret.minLength} characters`;
            warnings.push(message);
        }

        // Check pattern
        if (secret.pattern && !secret.pattern.test(value)) {
            const message = `${secret.name} (${secret.envVar}) does not match expected format`;
            if (isProduction) {
                errors.push(message);
            } else {
                warnings.push(message);
            }
        }
    }

    // Check recommended secrets
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

    // Log results
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

/**
 * Get a summary of secret configuration for diagnostics.
 */
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
