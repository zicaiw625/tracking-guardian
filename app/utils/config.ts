/**
 * Environment configuration validation and access
 * 
 * This module provides type-safe access to environment variables
 * and validates that required configuration is present on startup.
 */

/**
 * Environment variable configuration schema
 */
interface EnvConfig {
  // Required in all environments
  DATABASE_URL: string;
  
  // Required in production
  SHOPIFY_API_KEY?: string;
  SHOPIFY_API_SECRET?: string;
  SHOPIFY_APP_URL?: string;
  ENCRYPTION_SECRET?: string;
  CRON_SECRET?: string;
  
  // Optional with defaults
  NODE_ENV: "development" | "production" | "test";
  ENCRYPTION_SALT?: string;
  RESEND_API_KEY?: string;
  EMAIL_SENDER?: string;
  REDIS_URL?: string;
  RATE_LIMIT_MAX_KEYS?: string;
}

/**
 * Required environment variables for production
 */
const REQUIRED_IN_PRODUCTION = [
  "DATABASE_URL",
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "ENCRYPTION_SECRET",
  "CRON_SECRET",
] as const;

/**
 * Recommended environment variables (warnings if missing)
 */
const RECOMMENDED = [
  { key: "ENCRYPTION_SALT", reason: "for consistent encryption across deployments" },
  { key: "RESEND_API_KEY", reason: "for email notifications" },
  { key: "REDIS_URL", reason: "for shared rate limiting in multi-instance deployments" },
] as const;

/**
 * Validation result
 */
export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate environment configuration
 * Call this during app startup to catch configuration issues early
 */
export function validateConfig(): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isProduction = process.env.NODE_ENV === "production";

  // Check required variables
  for (const key of REQUIRED_IN_PRODUCTION) {
    if (!process.env[key]) {
      if (isProduction) {
        errors.push(`Missing required environment variable: ${key}`);
      } else {
        warnings.push(`${key} not set (required in production)`);
      }
    }
  }

  // Check recommended variables
  for (const { key, reason } of RECOMMENDED) {
    if (!process.env[key]) {
      warnings.push(`${key} not set - ${reason}`);
    }
  }

  // Validate specific values
  if (process.env.ENCRYPTION_SECRET && process.env.ENCRYPTION_SECRET.length < 32) {
    warnings.push("ENCRYPTION_SECRET should be at least 32 characters");
  }

  if (process.env.CRON_SECRET && process.env.CRON_SECRET.length < 32) {
    warnings.push("CRON_SECRET should be at least 32 characters");
  }

  // Validate DATABASE_URL format
  if (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith("postgres")) {
    errors.push("DATABASE_URL must be a PostgreSQL connection string");
  }

  // Validate SHOPIFY_APP_URL format
  if (process.env.SHOPIFY_APP_URL) {
    try {
      new URL(process.env.SHOPIFY_APP_URL);
    } catch {
      errors.push("SHOPIFY_APP_URL must be a valid URL");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Get a required environment variable
 * Throws if not set in production
 */
export function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value || "";
}

/**
 * Get an optional environment variable with default
 */
export function getEnv(key: string, defaultValue: string = ""): string {
  return process.env[key] || defaultValue;
}

/**
 * Get environment variable as boolean
 */
export function getBoolEnv(key: string, defaultValue: boolean = false): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.toLowerCase() === "true" || value === "1";
}

/**
 * Get environment variable as number
 */
export function getNumEnv(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const num = parseInt(value, 10);
  return isNaN(num) ? defaultValue : num;
}

/**
 * Check if running in production
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Check if running in development
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * Log configuration status on startup
 */
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
  
  // In production, fail fast on errors
  if (!result.valid && isProduction()) {
    throw new Error("Invalid configuration - cannot start in production");
  }
}

/**
 * Environment variables documentation
 * 
 * Required Variables:
 * - DATABASE_URL: PostgreSQL connection string
 * - SHOPIFY_API_KEY: Shopify app API key
 * - SHOPIFY_API_SECRET: Shopify app API secret
 * - SHOPIFY_APP_URL: Public URL of your app
 * - ENCRYPTION_SECRET: Secret for encrypting credentials (min 32 chars)
 * - CRON_SECRET: Secret for authenticating cron requests (min 32 chars)
 * 
 * Optional Variables:
 * - ENCRYPTION_SALT: Salt for key derivation (recommended)
 * - RESEND_API_KEY: API key for Resend email service
 * - EMAIL_SENDER: Email sender address for notifications
 * - REDIS_URL: Redis connection string for distributed rate limiting
 * - RATE_LIMIT_MAX_KEYS: Maximum keys in rate limit store (default: 10000)
 * 
 * Generate secrets with:
 * - openssl rand -base64 32
 */
