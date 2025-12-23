/**
 * Security Utilities
 *
 * Centralized security utilities for input validation, sanitization,
 * and protection against common vulnerabilities.
 */

import { z } from "zod";
import crypto from "crypto";

// =============================================================================
// Input Validation Constants
// =============================================================================

/**
 * Maximum request body sizes by endpoint type
 */
export const MAX_BODY_SIZE = {
  PIXEL_EVENT: 10 * 1024, // 10KB
  WEBHOOK: 100 * 1024, // 100KB
  API: 50 * 1024, // 50KB
  FORM: 100 * 1024, // 100KB
} as const;

/**
 * Rate limit tiers
 */
export const RATE_LIMITS = {
  PIXEL_EVENTS: { windowMs: 60_000, maxRequests: 100 },
  API: { windowMs: 60_000, maxRequests: 60 },
  WEBHOOK: { windowMs: 60_000, maxRequests: 200 },
  AUTH: { windowMs: 60_000, maxRequests: 10 },
} as const;

// =============================================================================
// Input Sanitization
// =============================================================================

/**
 * Sanitize string input by removing potentially dangerous characters
 */
export function sanitizeString(input: unknown): string {
  if (typeof input !== "string") {
    return "";
  }
  
  // Remove null bytes
  let sanitized = input.replace(/\0/g, "");
  
  // Trim whitespace
  sanitized = sanitized.trim();
  
  // Limit length
  if (sanitized.length > 10000) {
    sanitized = sanitized.substring(0, 10000);
  }
  
  return sanitized;
}

/**
 * Sanitize object by recursively sanitizing string values
 */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const sanitized: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      sanitized[key] = sanitizeString(value);
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      sanitized[key] = sanitizeObject(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map((item) =>
        typeof item === "string"
          ? sanitizeString(item)
          : item && typeof item === "object"
            ? sanitizeObject(item as Record<string, unknown>)
            : item
      );
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized as T;
}

/**
 * Sanitize HTML by escaping special characters
 */
export function escapeHtml(input: string): string {
  const htmlEntities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#x27;",
    "/": "&#x2F;",
  };
  
  return input.replace(/[&<>"'/]/g, (char) => htmlEntities[char] || char);
}

/**
 * Sanitize URL by validating and normalizing
 */
export function sanitizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    
    // Only allow http and https protocols
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    
    // Prevent javascript: URLs that might slip through
    if (url.toLowerCase().includes("javascript:")) {
      return null;
    }
    
    return parsed.toString();
  } catch {
    return null;
  }
}

// =============================================================================
// HMAC Validation
// =============================================================================

/**
 * Compute HMAC-SHA256 signature
 */
export function computeHmac(
  message: string | Buffer,
  secret: string,
  encoding: "hex" | "base64" = "hex"
): string {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(message);
  return hmac.digest(encoding);
}

/**
 * Verify HMAC signature with timing-safe comparison
 */
export function verifyHmac(
  message: string | Buffer,
  signature: string,
  secret: string,
  encoding: "hex" | "base64" = "hex"
): boolean {
  const computed = computeHmac(message, secret, encoding);
  return timingSafeEqual(computed, signature);
}

/**
 * Timing-safe string comparison
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to prevent timing attacks
    const buffer = Buffer.from(a);
    crypto.timingSafeEqual(buffer, buffer);
    return false;
  }
  
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

// =============================================================================
// Request Validation
// =============================================================================

/**
 * Validate request body size
 */
export function validateBodySize(
  contentLength: string | null,
  maxSize: number
): { valid: boolean; error?: string } {
  if (!contentLength) {
    return { valid: true };
  }
  
  const size = parseInt(contentLength, 10);
  if (isNaN(size)) {
    return { valid: false, error: "Invalid content-length header" };
  }
  
  if (size > maxSize) {
    return {
      valid: false,
      error: `Request body too large: ${size} bytes (max: ${maxSize})`,
    };
  }
  
  return { valid: true };
}

/**
 * Validate request content type
 */
export function validateContentType(
  contentType: string | null,
  allowedTypes: string[]
): { valid: boolean; error?: string } {
  if (!contentType) {
    return { valid: false, error: "Missing content-type header" };
  }
  
  const type = contentType.split(";")[0].trim().toLowerCase();
  
  if (!allowedTypes.includes(type)) {
    return {
      valid: false,
      error: `Invalid content-type: ${type}. Allowed: ${allowedTypes.join(", ")}`,
    };
  }
  
  return { valid: true };
}

/**
 * Validate request origin
 */
export function validateOrigin(
  origin: string | null,
  allowedOrigins: string[]
): { valid: boolean; error?: string } {
  // No origin header (e.g., same-origin or non-browser)
  if (!origin) {
    return { valid: true };
  }
  
  // Normalize origin
  const normalizedOrigin = origin.toLowerCase();
  
  // Check against allowed origins
  for (const allowed of allowedOrigins) {
    if (allowed === "*") {
      return { valid: true };
    }
    
    if (normalizedOrigin === allowed.toLowerCase()) {
      return { valid: true };
    }
    
    // Support wildcard subdomains
    if (allowed.startsWith("*.")) {
      const domain = allowed.substring(2);
      if (
        normalizedOrigin.endsWith(domain) ||
        normalizedOrigin === domain.substring(1)
      ) {
        return { valid: true };
      }
    }
  }
  
  return {
    valid: false,
    error: `Origin ${origin} not allowed`,
  };
}

// =============================================================================
// Security Headers
// =============================================================================

/**
 * Standard security headers for API responses
 */
export const API_SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "no-store, max-age=0",
};

/**
 * Security headers for HTML responses
 */
export const HTML_SECURITY_HEADERS: Record<string, string> = {
  ...API_SECURITY_HEADERS,
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.shopify.com; style-src 'self' 'unsafe-inline' https://cdn.shopify.com; img-src 'self' data: https:; connect-src 'self' https://*.shopify.com https://*.myshopify.com",
};

/**
 * Apply security headers to a response
 */
export function applySecurityHeaders(
  response: Response,
  headers: Record<string, string> = API_SECURITY_HEADERS
): Response {
  const newHeaders = new Headers(response.headers);
  
  for (const [key, value] of Object.entries(headers)) {
    newHeaders.set(key, value);
  }
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

// =============================================================================
// SQL Injection Prevention
// =============================================================================

/**
 * Check if a string contains SQL injection patterns
 * Note: This is a defense-in-depth measure. Always use parameterized queries.
 */
export function containsSqlInjectionPattern(input: string): boolean {
  const patterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|UNION|INTO|FROM|WHERE|OR|AND)\b.*\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|UNION|FROM|WHERE)\b)/i,
    /(['"];\s*(DROP|DELETE|INSERT|UPDATE|CREATE))/i,
    /(\b(OR|AND)\s*['"]?\s*\d+\s*=\s*\d+)/i,
    /(--\s*$)/i,
    /(;\s*--)/i,
    /(\bEXEC\s*\()/i,
  ];
  
  return patterns.some((pattern) => pattern.test(input));
}

/**
 * Validate that input is safe for database queries
 */
export function validateDatabaseInput(input: unknown): boolean {
  if (typeof input !== "string") {
    return true;
  }
  
  return !containsSqlInjectionPattern(input);
}

// =============================================================================
// Zod Schemas for Common Security Validations
// =============================================================================

/**
 * Safe string schema (no control characters, reasonable length)
 */
export const SafeStringSchema = z
  .string()
  .max(10000, "String too long")
  .refine((s) => !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(s), {
    message: "String contains invalid control characters",
  });

/**
 * Shop domain schema
 */
export const SecureShopDomainSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i, {
    message: "Invalid Shopify domain format",
  });

/**
 * Email schema with additional security checks
 */
export const SecureEmailSchema = z
  .string()
  .email()
  .max(254)
  .refine((email) => !email.includes(".."), {
    message: "Invalid email format",
  })
  .refine((email) => !containsSqlInjectionPattern(email), {
    message: "Invalid email format",
  })
  .transform((email) => email.toLowerCase().trim());

/**
 * Order ID schema
 */
export const SecureOrderIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_:-]+$/, {
    message: "Invalid order ID format",
  });

/**
 * URL schema with protocol validation
 */
export const SecureUrlSchema = z
  .string()
  .url()
  .max(2000)
  .refine((url) => {
    try {
      const parsed = new URL(url);
      return ["http:", "https:"].includes(parsed.protocol);
    } catch {
      return false;
    }
  }, {
    message: "Only HTTP and HTTPS URLs are allowed",
  });

// =============================================================================
// Token Generation
// =============================================================================

/**
 * Generate a cryptographically secure random token
 */
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString("hex");
}

/**
 * Generate a URL-safe random token
 */
export function generateUrlSafeToken(length: number = 32): string {
  return crypto.randomBytes(length).toString("base64url");
}

/**
 * Hash a value with SHA-256
 */
export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/**
 * Hash a value for storage (not for passwords - use bcrypt for those)
 */
export function hashForStorage(value: string, salt?: string): string {
  const actualSalt = salt || process.env.HASH_SALT || "default_salt";
  return sha256(`${actualSalt}:${value}`);
}

