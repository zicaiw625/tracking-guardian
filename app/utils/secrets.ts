/**
 * Secrets validation utility
 * 
 * Validates that required secrets are configured properly.
 * Should be called during app startup.
 */

import { logger } from "./logger";

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

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate all required secrets
 * 
 * In production: Throws error if required secrets are missing
 * In development: Logs warnings but continues
 */
export function validateSecrets(): ValidationResult {
  const isProduction = process.env.NODE_ENV === "production";
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const secret of REQUIRED_SECRETS) {
    const value = process.env[secret.envVar];

    // Check if set
    if (!value) {
      if (secret.required) {
        if (isProduction) {
          errors.push(`${secret.name} (${secret.envVar}) is not set`);
        } else {
          warnings.push(`${secret.name} (${secret.envVar}) is not set - using insecure default`);
        }
      }
      continue;
    }

    // Check minimum length
    if (secret.minLength && value.length < secret.minLength) {
      const message = `${secret.name} (${secret.envVar}) is shorter than recommended ${secret.minLength} characters`;
      if (isProduction) {
        warnings.push(message);
      } else {
        warnings.push(message);
      }
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
  };
}

/**
 * Validate secrets and throw if invalid in production
 */
export function ensureSecretsValid(): void {
  const result = validateSecrets();

  if (!result.valid) {
    const message = `Missing or invalid secrets:\n${result.errors.join("\n")}`;
    
    if (process.env.NODE_ENV === "production") {
      throw new Error(message);
    } else {
      logger.error("Secrets validation failed (continuing in development mode)", undefined, {
        errors: result.errors,
      });
    }
  }
}

/**
 * Get a required secret value, throwing if not set in production
 */
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

/**
 * Get an optional secret value with a default
 */
export function getOptionalSecret(envVar: string, defaultValue: string): string {
  return process.env[envVar] || defaultValue;
}
