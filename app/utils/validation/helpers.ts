/**
 * Validation Helpers
 *
 * Additional validation utility functions.
 */

import { AppError, ErrorCode } from "../errors/index";
import type { Result } from "../../types/result";
import { ok, err } from "../../types/result";

// =============================================================================
// Required Field Validation
// =============================================================================

/**
 * Require a value is present (not null/undefined)
 */
export function require<T>(
  value: T | null | undefined,
  fieldName: string
): Result<T, AppError> {
  if (value === null || value === undefined) {
    return err(
      new AppError(
        ErrorCode.VALIDATION_MISSING_FIELD,
        `Missing required field: ${fieldName}`,
        false,
        { field: fieldName }
      )
    );
  }
  return ok(value);
}

/**
 * Require a string is not empty
 */
export function requireNonEmpty(
  value: string | null | undefined,
  fieldName: string
): Result<string, AppError> {
  if (!value || value.trim() === "") {
    return err(
      new AppError(
        ErrorCode.VALIDATION_MISSING_FIELD,
        `${fieldName} cannot be empty`,
        false,
        { field: fieldName }
      )
    );
  }
  return ok(value.trim());
}

// =============================================================================
// Format Validation
// =============================================================================

/**
 * Validate email format
 */
export function validateEmail(email: string): Result<string, AppError> {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return err(
      new AppError(
        ErrorCode.VALIDATION_INVALID_FORMAT,
        "Invalid email format",
        false,
        { field: "email", expected: "valid email address" }
      )
    );
  }
  return ok(email.toLowerCase());
}

/**
 * Validate URL format
 */
export function validateUrl(url: string): Result<URL, AppError> {
  try {
    return ok(new URL(url));
  } catch {
    return err(
      new AppError(
        ErrorCode.VALIDATION_INVALID_FORMAT,
        "Invalid URL format",
        false,
        { field: "url", expected: "valid URL" }
      )
    );
  }
}

/**
 * Validate numeric value in range
 */
export function validateRange(
  value: number,
  min: number,
  max: number,
  fieldName: string
): Result<number, AppError> {
  if (value < min || value > max) {
    return err(
      new AppError(
        ErrorCode.VALIDATION_INVALID_FORMAT,
        `${fieldName} must be between ${min} and ${max}`,
        false,
        { field: fieldName, min, max, received: value }
      )
    );
  }
  return ok(value);
}

/**
 * Validate Shopify domain format
 */
export function validateShopDomain(
  domain: string
): Result<string, AppError> {
  const normalized = domain.toLowerCase().trim();
  
  // Must end with .myshopify.com
  if (!normalized.endsWith(".myshopify.com")) {
    return err(
      new AppError(
        ErrorCode.VALIDATION_INVALID_FORMAT,
        "Invalid shop domain format",
        false,
        { field: "shopDomain", expected: "*.myshopify.com" }
      )
    );
  }

  // Extract shop name and validate
  const shopName = normalized.replace(".myshopify.com", "");
  if (!shopName || !/^[a-z0-9-]+$/.test(shopName)) {
    return err(
      new AppError(
        ErrorCode.VALIDATION_INVALID_FORMAT,
        "Invalid shop domain format",
        false,
        { field: "shopDomain", expected: "alphanumeric with hyphens" }
      )
    );
  }

  return ok(normalized);
}

/**
 * Validate Shopify Order ID format
 */
export function validateOrderId(
  orderId: string
): Result<string, AppError> {
  const trimmed = orderId.trim();

  // Allow numeric IDs
  if (/^\d+$/.test(trimmed)) {
    return ok(trimmed);
  }

  // Allow GID format: gid://shopify/Order/123456
  if (trimmed.startsWith("gid://shopify/Order/")) {
    const id = trimmed.replace("gid://shopify/Order/", "");
    if (/^\d+$/.test(id)) {
      return ok(trimmed);
    }
  }

  return err(
    new AppError(
      ErrorCode.VALIDATION_INVALID_FORMAT,
      "Invalid order ID format",
      false,
      { field: "orderId", expected: "numeric or GID format" }
    )
  );
}

