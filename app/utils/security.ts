import { z } from "zod";
import net from "net";

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
  const MAX_ARRAY_ITEMS = 50;
  const MAX_OBJECT_KEYS = 100;
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
      const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) =>
        sanitizeValue(item, depth + 1)
      );
      if (value.length > MAX_ARRAY_ITEMS) {
        items.push(`...(${value.length - MAX_ARRAY_ITEMS} more)`);
      }
      return items;
    }
    const sanitized: Record<string, unknown> = {};
    let processed = 0;
    let truncated = false;
    for (const key in value as Record<string, unknown>) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        continue;
      }
      if (processed < MAX_OBJECT_KEYS) {
        sanitized[key] = sanitizeValue(
          (value as Record<string, unknown>)[key],
          depth + 1
        );
        processed += 1;
      } else {
        truncated = true;
        break;
      }
    }
    if (truncated) {
      sanitized._truncated = "...(more keys)";
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


export { API_SECURITY_HEADERS, addSecurityHeaders as applySecurityHeaders } from "./security-headers";

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
  /* eslint-disable-next-line no-control-regex -- intentionally match control chars for validation */
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

/**
 * Validates an email string for use in mailto: links. Use when building mailto: from
 * config or future user input to avoid injection and oversize. Returns the normalized
 * email or null if invalid.
 */
export function validateEmailForMailto(value: string | null | undefined): string | null {
  if (value == null || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return null;
  if (trimmed.includes("..")) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

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
function isPrivateIPv4(ip: string): boolean {
  if (/^10\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^127\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  if (/^0\./.test(ip)) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  if (!ip.startsWith('[') || !ip.endsWith(']')) {
    return false;
  }
  const ipv6 = ip.slice(1, -1).toLowerCase();
  if (ipv6 === '::1' || ipv6 === '::') {
    return true;
  }
  if (ipv6.startsWith('fc00:') || ipv6.startsWith('fc01:') || ipv6.startsWith('fd00:')) {
    return true;
  }
  if (ipv6.startsWith('fe80:') || ipv6.startsWith('fe90:') || ipv6.startsWith('fea0:') || ipv6.startsWith('feb0:')) {
    return true;
  }
  if (ipv6.startsWith('ff00:') || ipv6.startsWith('ff01:') || ipv6.startsWith('ff02:') || ipv6.startsWith('ff03:') || 
      ipv6.startsWith('ff04:') || ipv6.startsWith('ff05:') || ipv6.startsWith('ff08:') || ipv6.startsWith('ff0e:')) {
    return true;
  }
  if (ipv6.startsWith('2001:db8:')) {
    return true;
  }
  if (ipv6.startsWith('::ffff:')) {
    const ipv4 = ipv6.substring(7);
    if (/^10\./.test(ipv4) || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ipv4) || /^192\.168\./.test(ipv4) || /^127\./.test(ipv4) || /^169\.254\./.test(ipv4) || /^0\./.test(ipv4)) {
      return true;
    }
  }
  if (ipv6.startsWith('2001:10:') || ipv6.startsWith('2001:20:')) {
    return true;
  }
  return false;
}

const DNS_VALIDATION_CACHE_TTL_MS = 15 * 60 * 1000;
const dnsValidationCache = new Map<string, { valid: boolean; checkedAt: number }>();

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
      const ipv6 = hostname.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
      if (ipv6 === "::1") return false;
      if (ipv6.startsWith("fc") || ipv6.startsWith("fd")) return false;
      if (ipv6.startsWith("fe80:")) return false;
      if (ipv6.startsWith("ff")) return false;
      if (ipv6 === "::") return false;
      if (ipv6.startsWith("2001:db8:")) return false;
      if (ipv6.startsWith("fec0:")) return false;
      if (ipv6.startsWith("::ffff:")) {
        const tail = ipv6.slice("::ffff:".length);
        if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(tail)) return false;
        if (tail.startsWith("0.")) return false;
        if (tail.startsWith("169.254.")) return false;
        const hexParts = tail.split(":");
        if (hexParts.length >= 2) {
          const hi = parseInt(hexParts[0], 16);
          const lo = parseInt(hexParts[1], 16);
          if (!isNaN(hi) && !isNaN(lo)) {
            const o1 = (hi >> 8) & 0xff, o2 = hi & 0xff;
            if (o1 === 127 || o1 === 10 || (o1 === 172 && o2 >= 16 && o2 <= 31) || (o1 === 192 && o2 === 168) || (o1 === 169 && o2 === 254) || o1 === 0) return false;
          }
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

export async function isPublicUrlWithDNS(urlStr: string): Promise<boolean> {
  if (!isPublicUrl(urlStr)) {
    return false;
  }
  try {
    const url = new URL(urlStr);
    const hostname = url.hostname;
    const ipType = net.isIP(hostname);
    if (ipType === 4 || ipType === 6) {
      return true;
    }
    const cacheKey = hostname.toLowerCase();
    const now = Date.now();
    const cached = dnsValidationCache.get(cacheKey);
    if (cached && (now - cached.checkedAt) < DNS_VALIDATION_CACHE_TTL_MS) {
      return cached.valid;
    }
    try {
      const dns = await import('dns');
      const { promisify } = await import('util');
      const lookup = promisify(dns.lookup);
      const resolved = await lookup(hostname, { family: 0, all: true });
      const records = Array.isArray(resolved) ? resolved : [resolved];
      for (const record of records) {
        const resolvedIp = record.address;
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(resolvedIp)) {
          if (isPrivateIPv4(resolvedIp)) {
            dnsValidationCache.set(cacheKey, { valid: false, checkedAt: now });
            return false;
          }
        } else if (resolvedIp.includes(':')) {
          const ipv6Formatted = resolvedIp.startsWith('[') && resolvedIp.endsWith(']') ? resolvedIp : `[${resolvedIp}]`;
          if (isPrivateIPv6(ipv6Formatted)) {
            dnsValidationCache.set(cacheKey, { valid: false, checkedAt: now });
            return false;
          }
        }
        if (resolvedIp === '127.0.0.1' || resolvedIp === '::1' || resolvedIp === 'localhost') {
          dnsValidationCache.set(cacheKey, { valid: false, checkedAt: now });
          return false;
        }
      }
      dnsValidationCache.set(cacheKey, { valid: true, checkedAt: now });
      return true;
    } catch {
      dnsValidationCache.set(cacheKey, { valid: false, checkedAt: now });
      return false;
    }
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
