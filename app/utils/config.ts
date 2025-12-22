interface EnvConfig {
    DATABASE_URL: string;
    SHOPIFY_API_KEY?: string;
    SHOPIFY_API_SECRET?: string;
    SHOPIFY_APP_URL?: string;
    ENCRYPTION_SECRET?: string;
    CRON_SECRET?: string;
    NODE_ENV: "development" | "production" | "test";
    ENCRYPTION_SALT?: string;
    RESEND_API_KEY?: string;
    EMAIL_SENDER?: string;
    REDIS_URL?: string;
    RATE_LIMIT_MAX_KEYS?: string;
}
const REQUIRED_IN_PRODUCTION = [
    "DATABASE_URL",
    "SHOPIFY_API_KEY",
    "SHOPIFY_API_SECRET",
    "SHOPIFY_APP_URL",
    "ENCRYPTION_SECRET",
    "CRON_SECRET",
] as const;
const RECOMMENDED = [
    { key: "ENCRYPTION_SALT", reason: "for consistent encryption across deployments" },
    { key: "RESEND_API_KEY", reason: "for email notifications" },
    { key: "REDIS_URL", reason: "for shared rate limiting in multi-instance deployments" },
] as const;
export interface ConfigValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}
export function validateConfig(): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const isProduction = process.env.NODE_ENV === "production";
    for (const key of REQUIRED_IN_PRODUCTION) {
        if (!process.env[key]) {
            if (isProduction) {
                errors.push(`Missing required environment variable: ${key}`);
            }
            else {
                warnings.push(`${key} not set (required in production)`);
            }
        }
    }
    for (const { key, reason } of RECOMMENDED) {
        if (!process.env[key]) {
            warnings.push(`${key} not set - ${reason}`);
        }
    }
    if (process.env.ENCRYPTION_SECRET && process.env.ENCRYPTION_SECRET.length < 32) {
        warnings.push("ENCRYPTION_SECRET should be at least 32 characters");
    }
    if (process.env.CRON_SECRET && process.env.CRON_SECRET.length < 32) {
        warnings.push("CRON_SECRET should be at least 32 characters");
    }
    if (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith("postgres")) {
        errors.push("DATABASE_URL must be a PostgreSQL connection string");
    }
    if (process.env.SHOPIFY_APP_URL) {
        try {
            new URL(process.env.SHOPIFY_APP_URL);
        }
        catch {
            errors.push("SHOPIFY_APP_URL must be a valid URL");
        }
    }
    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}
export function getRequiredEnv(key: string): string {
    const value = process.env[key];
    if (!value && process.env.NODE_ENV === "production") {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value || "";
}
export function getEnv(key: string, defaultValue: string = ""): string {
    return process.env[key] || defaultValue;
}
export function getBoolEnv(key: string, defaultValue: boolean = false): boolean {
    const value = process.env[key];
    if (!value)
        return defaultValue;
    return value.toLowerCase() === "true" || value === "1";
}
export function getNumEnv(key: string, defaultValue: number): number {
    const value = process.env[key];
    if (!value)
        return defaultValue;
    const num = parseInt(value, 10);
    return isNaN(num) ? defaultValue : num;
}
export function isProduction(): boolean {
    return process.env.NODE_ENV === "production";
}
export function isDevelopment(): boolean {
    return process.env.NODE_ENV !== "production";
}
export function logConfigStatus(): void {
    const result = validateConfig();
    console.log("\n=== Configuration Status ===");
    console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
    if (result.errors.length > 0) {
        console.error("\n❌ Configuration Errors:");
        for (const error of result.errors) {
            console.error(`   - ${error}`);
        }
    }
    if (result.warnings.length > 0) {
        console.warn("\n⚠️ Configuration Warnings:");
        for (const warning of result.warnings) {
            console.warn(`   - ${warning}`);
        }
    }
    if (result.valid && result.warnings.length === 0) {
        console.log("\n✅ All configuration checks passed");
    }
    console.log("============================\n");
    if (!result.valid && isProduction()) {
        throw new Error("Invalid configuration - cannot start in production");
    }
}
