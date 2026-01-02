

import { AppError, ErrorCode } from "../errors/index";
import type { Result } from "../../types/result";
import { ok, err } from "../../types/result";

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

export function validateShopDomain(
  domain: string
): Result<string, AppError> {
  const normalized = domain.toLowerCase().trim();

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

export function validateOrderId(
  orderId: string
): Result<string, AppError> {
  const trimmed = orderId.trim();

  if (/^\d+$/.test(trimmed)) {
    return ok(trimmed);
  }

  if (trimmed.startsWith("gid://")) {
    const id = trimmed.replace(/^gid:\/\/shopify\/\w+\//, "");
    if (/^\d+$/.test(id)) {
      return ok(trimmed);
    }
  }

  return err(
    new AppError(
      ErrorCode.VALIDATION_INVALID_FORMAT,
      "Invalid order ID format",
      false,
      { field: "orderId", expected: "numeric or gid://shopify/Order/123" }
    )
  );
}

