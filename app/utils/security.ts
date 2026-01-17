import { z } from "zod";
import { buildCspHeader, CSP_DIRECTIVES, API_SECURITY_HEADERS, addSecurityHeaders } from "./security-headers";

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
  const visited = new WeakSet<object>();
  const sanitizeValue = (value: unknown, depth: number): unknown => {
    if (depth > 5) {
      return "[TRUNCATED]";
    }
    if (typeof value === "string") {
      return sanitizeString(value);
    }
    if (!value || typeof value !== "object") {
      return value;
    }
    if (visited.has(value)) {
      return "[CIRCULAR]";
    }
    visited.add(value);
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeValue(item, depth + 1));
    }
    const sanitized: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      sanitized[key] = sanitizeValue(entryValue, depth + 1);
    }
    return sanitized;
  };
  return sanitizeValue(obj, 0) as T;
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
    if (allowedOrigins.some((allowed) => allowed.trim() === "*")) {
      return { valid: true };
    }
    return { valid: false, error: "Missing origin header" };
  }
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return { valid: false, error: `Origin ${origin} not allowed` };
  }
  const originHost = parsedOrigin.hostname.toLowerCase();
  const originValue = parsedOrigin.origin.toLowerCase();
  for (const allowed of allowedOrigins) {
    const normalizedAllowed = allowed.toLowerCase();
    if (normalizedAllowed === "*") {
      return { valid: true };
    }
    if (normalizedAllowed.includes("://") && normalizedAllowed.includes("*.")) {
      const [, hostPart] = normalizedAllowed.split("://");
      const wildcardHost = hostPart.split("/")[0];
      if (wildcardHost.startsWith("*.")) {
        const domain = wildcardHost.slice(2);
        if (originHost === domain || originHost.endsWith(`.${domain}`)) {
          return { valid: true };
        }
      }
      continue;
    }
    if (normalizedAllowed.startsWith("*.")) {
      const domain = normalizedAllowed.slice(2);
      if (originHost === domain || originHost.endsWith(`.${domain}`)) {
        return { valid: true };
      }
      continue;
    }
    if (normalizedAllowed.includes("://")) {
      try {
        const allowedUrl = new URL(normalizedAllowed);
        if (allowedUrl.origin.toLowerCase() === originValue) {
          return { valid: true };
        }
      } catch {
        continue;
      }
    } else if (originHost === normalizedAllowed) {
      return { valid: true };
    }
  }
  return {
    valid: false,
    error: `Origin ${origin} not allowed`,
  };
}

export { API_SECURITY_HEADERS, addSecurityHeaders as applySecurityHeaders } from "./security-headers";

export const HTML_SECURITY_HEADERS: Record<string, string> = {
  ...API_SECURITY_HEADERS,
  "Content-Security-Policy": buildCspHeader(CSP_DIRECTIVES),
};

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
    if (url.protocol !== "https:") {
      return false;
    }
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
    
    if (hostname.includes(":")) {
      const ipv6Match = hostname.match(/^\[([0-9a-f:]+)\]$/i);
      if (ipv6Match) {
        const ipv6 = ipv6Match[1].toLowerCase();
        if (ipv6 === "::1" || 
            ipv6.startsWith("::ffff:127.") || 
            ipv6.startsWith("::ffff:10.") || 
            ipv6.startsWith("::ffff:172.16.") || 
            ipv6.startsWith("::ffff:172.17.") ||
            ipv6.startsWith("::ffff:172.18.") ||
            ipv6.startsWith("::ffff:172.19.") ||
            ipv6.startsWith("::ffff:172.20.") ||
            ipv6.startsWith("::ffff:172.21.") ||
            ipv6.startsWith("::ffff:172.22.") ||
            ipv6.startsWith("::ffff:172.23.") ||
            ipv6.startsWith("::ffff:172.24.") ||
            ipv6.startsWith("::ffff:172.25.") ||
            ipv6.startsWith("::ffff:172.26.") ||
            ipv6.startsWith("::ffff:172.27.") ||
            ipv6.startsWith("::ffff:172.28.") ||
            ipv6.startsWith("::ffff:172.29.") ||
            ipv6.startsWith("::ffff:172.30.") ||
            ipv6.startsWith("::ffff:172.31.") ||
            ipv6.startsWith("::ffff:192.168.") ||
            ipv6.startsWith("fc00:") || 
            ipv6.startsWith("fd00:") || 
            ipv6.startsWith("fe80:") ||
            ipv6.startsWith("fec0:") ||
            ipv6.startsWith("ff00:") ||
            ipv6 === "::" ||
            ipv6.startsWith("2001:db8:")) {
          return false;
        }
      }
    }
    
    if (hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".lan")) {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
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
