import { logger } from "./logger.server";
interface SecretConfig {
    name: string;
    envVar: string;
    required: boolean;
    minLength?: number;
    pattern?: RegExp;
}
const REQUIRED_SECRETS: SecretConfig[] = [
    {
        name: "Encryption Secret",
        envVar: "ENCRYPTION_SECRET",
        required: true,
        minLength: 32,
    },
    {
        name: "Cron Secret",
        envVar: "CRON_SECRET",
        required: true,
        minLength: 32,
    },
    {
        name: "Shopify API Secret",
        envVar: "SHOPIFY_API_SECRET",
        required: true,
        minLength: 16,
    },
    {
        name: "Database URL",
        envVar: "DATABASE_URL",
        required: true,
        pattern: /^postgres(ql)?:\/\/.+/,
    },
];
interface SecurityViolation {
    type: "fatal" | "warning";
    message: string;
}
export function checkSecurityViolations(): SecurityViolation[] {
    const isProduction = process.env.NODE_ENV === "production";
    const violations: SecurityViolation[] = [];
    if (isProduction && process.env.ALLOW_UNSIGNED_PIXEL_EVENTS === "true") {
        violations.push({
            type: "fatal",
            message: "[P0-04 SECURITY VIOLATION] ALLOW_UNSIGNED_PIXEL_EVENTS=true is set in production! " +
                "This allows unsigned requests and completely defeats signature security. " +
                "The application MUST NOT start with this configuration. " +
                "Remove this environment variable immediately to proceed.",
        });
    }
    if (!isProduction && process.env.ALLOW_UNSIGNED_PIXEL_EVENTS === "true") {
        violations.push({
            type: "warning",
            message: "[P0-04] ALLOW_UNSIGNED_PIXEL_EVENTS=true is set (development mode). " +
                "This is acceptable for development but MUST be removed before production deployment.",
        });
    }
    return violations;
}
export function enforceSecurityChecks(): void {
    const violations = checkSecurityViolations();
    const fatalViolations = violations.filter(v => v.type === "fatal");
    const warnings = violations.filter(v => v.type === "warning");
    for (const warning of warnings) {
        logger.warn(warning.message);
    }
    if (fatalViolations.length > 0) {
        const errorMessage = fatalViolations.map(v => v.message).join("\n");
        logger.error("FATAL SECURITY VIOLATION - Application startup aborted", undefined, {
            violations: fatalViolations.map(v => v.message),
        });
        throw new Error(`\n\n${"=".repeat(80)}\n` +
            `FATAL SECURITY VIOLATION - APPLICATION STARTUP ABORTED\n` +
            `${"=".repeat(80)}\n\n` +
            `${errorMessage}\n\n` +
            `${"=".repeat(80)}\n`);
    }
}
interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}
export function validateSecrets(): ValidationResult {
    const isProduction = process.env.NODE_ENV === "production";
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const secret of REQUIRED_SECRETS) {
        const value = process.env[secret.envVar];
        if (!value) {
            if (secret.required) {
                if (isProduction) {
                    errors.push(`${secret.name} (${secret.envVar}) is not set`);
                }
                else {
                    warnings.push(`${secret.name} (${secret.envVar}) is not set - using insecure default`);
                }
            }
            continue;
        }
        if (secret.minLength && value.length < secret.minLength) {
            const message = `${secret.name} (${secret.envVar}) is shorter than recommended ${secret.minLength} characters`;
            if (isProduction) {
                warnings.push(message);
            }
            else {
                warnings.push(message);
            }
        }
        if (secret.pattern && !secret.pattern.test(value)) {
            const message = `${secret.name} (${secret.envVar}) does not match expected format`;
            if (isProduction) {
                errors.push(message);
            }
            else {
                warnings.push(message);
            }
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
