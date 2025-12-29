

import { z } from "zod";
import crypto from "crypto";

export const MAX_BODY_SIZE = {
  PIXEL_EVENT: 10 * 1024,
  WEBHOOK: 100 * 1024,
  API: 50 * 1024,
  FORM: 100 * 1024,
} as const;

export const RATE_LIMITS = {
  PIXEL_EVENTS: { windowMs: 60_000, maxRequests: 100 },
  API: { windowMs: 60_000, maxRequests: 60 },
  WEBHOOK: { windowMs: 60_000, maxRequests: 200 },
  AUTH: { windowMs: 60_000, maxRequests: 10 },
} as const;

export function sanitizeString(input: unknown): string {
  if (typeof input !== "string") {
    return "";
  }

  let sanitized = input.replace(/\0/g, "");

  sanitized = sanitized.trim();

  if (sanitized.length > 10000) {
    sanitized = sanitized.substring(0, 10000);
  }

  return sanitized;
}

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

export function sanitizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }

    if (url.toLowerCase().includes("javascript:")) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export function computeHmac(
  message: string | Buffer,
  secret: string,
  encoding: "hex" | "base64" = "hex"
): string {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(message);
  return hmac.digest(encoding);
}

export function verifyHmac(
  message: string | Buffer,
  signature: string,
  secret: string,
  encoding: "hex" | "base64" = "hex"
): boolean {
  const computed = computeHmac(message, secret, encoding);
  return timingSafeEqual(computed, signature);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {

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

export function validateOrigin(
  origin: string | null,
  allowedOrigins: string[]
): { valid: boolean; error?: string } {

  if (!origin) {
    return { valid: true };
  }

  const normalizedOrigin = origin.toLowerCase();

  for (const allowed of allowedOrigins) {
    if (allowed === "*") {
      return { valid: true };
    }

    if (normalizedOrigin === allowed.toLowerCase()) {
      return { valid: true };
    }

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

export const API_SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "no-store, max-age=0",
};

export const HTML_SECURITY_HEADERS: Record<string, string> = {
  ...API_SECURITY_HEADERS,
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline' https:
};

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

export function validateDatabaseInput(input: unknown): boolean {
  if (typeof input !== "string") {
    return true;
  }

  return !containsSqlInjectionPattern(input);
}

export const SafeStringSchema = z
  .string()
  .max(10000, "String too long")

  .refine((s) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(s), {
    message: "String contains invalid control characters",
  });

export const SecureShopDomainSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i, {
    message: "Invalid Shopify domain format",
  });

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

export const SecureOrderIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_:-]+$/, {
    message: "Invalid order ID format",
  });

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
  })
  .refine((url) => isPublicUrl(url), {
    message: "Internal or private URLs are not allowed",
  });

export function isPublicUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    const hostname = url.hostname.toLowerCase();

    if (hostname === "localhost") return false;

    if (hostname === "::1" || hostname === "[::1]") return false;

    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = hostname.match(ipv4Regex);

    if (match) {
      const octet1 = parseInt(match[1], 10);
      const octet2 = parseInt(match[2], 10);

      if (octet1 === 127) return false;

      if (octet1 === 10) return false;

      if (octet1 === 172 && octet2 >= 16 && octet2 <= 31) return false;

      if (octet1 === 192 && octet2 === 168) return false;

      if (octet1 === 169 && octet2 === 254) return false;

      if (octet1 === 0) return false;
    }

    return true;
  } catch {
    return false;
  }
}

export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString("hex");
}

export function generateUrlSafeToken(length: number = 32): string {
  return crypto.randomBytes(length).toString("base64url");
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hashForStorage(value: string, salt?: string): string {
  if (process.env.NODE_ENV === "production" && !process.env.HASH_SALT && !salt) {
    throw new Error("Security Error: HASH_SALT is not defined in production environment. This is a critical security misconfiguration.");
  }
  const actualSalt = salt || process.env.HASH_SALT || "default_salt";
  return sha256(`${actualSalt}:${value}`);
}

export function containsSensitiveInfo(text: string): boolean {
  if (typeof text !== "string" || text.length === 0) {
    return false;
  }

  const sensitivePatterns = [

    /(?:api[_-]?key|apikey)[\s:=]+['"]?([a-zA-Z0-9_-]{20,})['"]?/gi,

    /(?:access[_-]?token|token|bearer)[\s:=]+['"]?([a-zA-Z0-9_-]{20,})['"]?/gi,

    /(?:secret|password|pwd|passwd)[\s:=]+['"]?([^\s'"]{10,})['"]?/gi,

    /(?:email|mailto)[\s:=]+['"]?([^\s'"]+@[^\s'"]+\.[a-z]{2,})['"]?/gi,

    /(?:phone|tel|mobile)[\s:=]+['"]?(\+?[0-9]{10,})['"]?/gi,

    /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/gi,

    /AKIA[0-9A-Z]{16}/gi,

    /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/gi,

    /oauth[_-]?token[\s:=]+['"]?([a-zA-Z0-9_-]{20,})['"]?/gi,
  ];

  return sensitivePatterns.some((pattern) => pattern.test(text));
}

export function sanitizeSensitiveInfo(text: string): string {
  if (typeof text !== "string" || text.length === 0) {
    return text;
  }

  let sanitized = text;

  const replacementPatterns = [
    {
      pattern: /(?:api[_-]?key|apikey)[\s:=]+['"]?[^'"]+['"]?/gi,
      replacement: "[API_KEY_REDACTED]",
    },
    {
      pattern: /(?:access[_-]?token|token|bearer)[\s:=]+['"]?[^'"]+['"]?/gi,
      replacement: "[TOKEN_REDACTED]",
    },
    {
      pattern: /(?:secret|password|pwd|passwd)[\s:=]+['"]?[^'"]+['"]?/gi,
      replacement: "[SECRET_REDACTED]",
    },
    {
      pattern: /(?:email|mailto)[\s:=]+['"]?[^\s'"]+@[^\s'"]+\.[a-z]{2,}['"]?/gi,
      replacement: "[EMAIL_REDACTED]",
    },
    {
      pattern: /(?:phone|tel|mobile)[\s:=]+['"]?\+?[0-9]{10,}['"]?/gi,
      replacement: "[PHONE_REDACTED]",
    },
    {
      pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/gi,
      replacement: "[CARD_REDACTED]",
    },
    {
      pattern: /AKIA[0-9A-Z]{16}/gi,
      replacement: "[AWS_KEY_REDACTED]",
    },
    {
      pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/gi,
      replacement: "[PRIVATE_KEY_REDACTED]",
    },
  ];

  for (const { pattern, replacement } of replacementPatterns) {
    sanitized = sanitized.replace(pattern, replacement);
  }

  return sanitized;
}

