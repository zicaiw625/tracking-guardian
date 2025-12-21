import { logger } from "./logger";

/**
 * P0-2: Origin validation patterns for Shopify-owned domains.
 * 
 * IMPORTANT: These patterns are for strict Shopify-only validation (admin, webhooks, etc.)
 * For pixel events from storefronts, use isValidPixelOrigin() which allows custom domains.
 */
const ALLOWED_ORIGIN_PATTERNS: Array<{
  pattern: RegExp;
  description: string;
  example: string;
}> = [
  {
    pattern: /^https:\/\/[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/,
    description: "Shopify store domains",
    example: "https://my-store.myshopify.com",
  },
  {
    pattern: /^https:\/\/checkout\.shopify\.com$/,
    description: "Shopify checkout domain",
    example: "https://checkout.shopify.com",
  },
  {
    pattern: /^https:\/\/[a-zA-Z0-9\-]+\.shopify\.com$/,
    description: "Shopify internal domains",
    example: "https://apps.shopify.com",
  },
];

const DEV_ORIGIN_PATTERNS: Array<{
  pattern: RegExp;
  description: string;
}> = [
  {
    pattern: /^https?:\/\/localhost(:\d+)?$/,
    description: "Local development server",
  },
  {
    pattern: /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
    description: "Local IP development server",
  },
];

interface RejectedOriginTracker {
  count: number;
  firstSeen: number;
  lastSeen: number;
}

const rejectedOrigins = new Map<string, RejectedOriginTracker>();
const TRACKING_WINDOW_MS = 60 * 60 * 1000;
const ALERT_THRESHOLD = 10;

export function isDevMode(): boolean {
  const nodeEnv = process.env.NODE_ENV;
  return nodeEnv === "development" || nodeEnv === "test";
}

export function isValidShopifyOrigin(origin: string | null): boolean {
  if (origin === "null") {
    return true;
  }

  if (!origin) {
    return false;
  }

  return ALLOWED_ORIGIN_PATTERNS.some(({ pattern }) => pattern.test(origin));
}

/**
 * P0-2: Validate origin for pixel events endpoint.
 * 
 * Web Pixels run on storefronts which can use custom domains (e.g., https://brand.com).
 * We cannot whitelist only Shopify domains or we'd reject legitimate traffic.
 * 
 * Security model for pixel events:
 * - Allow any HTTPS origin (custom domains are valid storefronts)
 * - Reject HTTP origins (security risk)
 * - Allow "null" origin (sandboxed iframes/web workers)
 * - Authentication is via ingestion key + timestamp, NOT origin checking
 * 
 * @param origin The Origin header value
 * @returns Object with validation result and reason
 */
export function isValidPixelOrigin(origin: string | null): {
  valid: boolean;
  reason: string;
} {
  // Null origin is valid - Web Pixels may run in sandboxed contexts
  if (origin === "null" || origin === null) {
    return { valid: true, reason: "sandbox_or_null_origin" };
  }

  // No origin header at all - also acceptable for certain environments
  if (!origin) {
    return { valid: true, reason: "no_origin_header" };
  }

  try {
    const url = new URL(origin);
    
    // Reject HTTP - must be HTTPS for security
    if (url.protocol === "http:") {
      // Allow localhost in dev mode
      if (isDevMode() && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
        return { valid: true, reason: "dev_localhost_http" };
      }
      return { valid: false, reason: "http_not_allowed" };
    }

    // Accept any HTTPS origin - storefront can be on custom domain
    if (url.protocol === "https:") {
      return { valid: true, reason: "https_origin" };
    }

    return { valid: false, reason: "invalid_protocol" };
  } catch {
    return { valid: false, reason: "malformed_origin" };
  }
}

/**
 * P0-2: Validate origin against a shop's allowed storefront domains.
 * 
 * This provides stronger security than isValidPixelOrigin by checking
 * the origin against a known list of the shop's storefront domains.
 * 
 * Use this for strict origin validation when you have the shop context.
 * 
 * @param origin The Origin header value
 * @param allowedDomains List of allowed domains for this shop
 * @returns Object with validation result
 */
export function isOriginInAllowlist(
  origin: string | null,
  allowedDomains: string[]
): {
  valid: boolean;
  reason: string;
  matched?: string;
} {
  // Sandbox origin is always allowed
  if (origin === "null" || origin === null) {
    return { valid: true, reason: "sandbox_origin" };
  }

  if (!origin) {
    return { valid: true, reason: "no_origin_header" };
  }

  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();

    // Check protocol first
    if (url.protocol !== "https:" && !isDevMode()) {
      return { valid: false, reason: "https_required" };
    }

    // Check against allowlist
    for (const domain of allowedDomains) {
      const normalizedDomain = domain.toLowerCase();
      
      // Exact match
      if (hostname === normalizedDomain) {
        return { valid: true, reason: "exact_match", matched: domain };
      }
      
      // Subdomain match (e.g., www.example.com matches example.com)
      if (hostname.endsWith(`.${normalizedDomain}`)) {
        return { valid: true, reason: "subdomain_match", matched: domain };
      }
    }

    // Always allow Shopify checkout domain
    if (hostname === "checkout.shopify.com" || hostname.endsWith(".shopify.com")) {
      return { valid: true, reason: "shopify_domain" };
    }

    // Dev mode: allow localhost
    if (isDevMode() && (hostname === "localhost" || hostname === "127.0.0.1")) {
      return { valid: true, reason: "dev_localhost" };
    }

    return {
      valid: false,
      reason: `origin_not_in_allowlist:${hostname}`,
    };
  } catch {
    return { valid: false, reason: "malformed_origin" };
  }
}

/**
 * P0-2: Build the default allowed domains list for a shop.
 * 
 * This should be called when a shop is installed or updated to populate
 * the storefrontDomains field.
 * 
 * @param myshopifyDomain The shop's .myshopify.com domain
 * @param primaryDomain Optional primary custom domain
 * @param additionalDomains Optional additional custom domains
 */
export function buildDefaultAllowedDomains(
  myshopifyDomain: string,
  primaryDomain?: string | null,
  additionalDomains?: string[]
): string[] {
  const domains = new Set<string>();
  
  // Always add myshopify domain
  if (myshopifyDomain) {
    domains.add(myshopifyDomain.toLowerCase());
  }
  
  // Add primary domain if set
  if (primaryDomain) {
    domains.add(primaryDomain.toLowerCase());
  }
  
  // Add any additional domains
  if (additionalDomains) {
    for (const domain of additionalDomains) {
      if (domain) {
        domains.add(domain.toLowerCase());
      }
    }
  }
  
  return Array.from(domains);
}

export function isValidDevOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return DEV_ORIGIN_PATTERNS.some(({ pattern }) => pattern.test(origin));
}

export function validateOrigin(origin: string | null): {
  valid: boolean;
  reason: string;
  shouldLog: boolean;
} {
  if (origin === "null") {
    return { valid: true, reason: "sandbox_origin", shouldLog: false };
  }

  if (!origin) {
    return { valid: false, reason: "missing_origin", shouldLog: true };
  }

  for (const { pattern, description } of ALLOWED_ORIGIN_PATTERNS) {
    if (pattern.test(origin)) {
      return { valid: true, reason: description, shouldLog: false };
    }
  }

  if (isDevMode()) {
    for (const { pattern, description } of DEV_ORIGIN_PATTERNS) {
      if (pattern.test(origin)) {
        return { valid: true, reason: `dev:${description}`, shouldLog: false };
      }
    }
  }

  trackRejectedOrigin(origin);

  return { valid: false, reason: "unknown_origin", shouldLog: true };
}

function trackRejectedOrigin(origin: string): void {
  const now = Date.now();
  
  const sanitizedOrigin = sanitizeOriginForLogging(origin);
  
  const existing = rejectedOrigins.get(sanitizedOrigin);
  
  if (!existing || (now - existing.firstSeen) > TRACKING_WINDOW_MS) {
    rejectedOrigins.set(sanitizedOrigin, {
      count: 1,
      firstSeen: now,
      lastSeen: now,
    });
  } else {
    existing.count++;
    existing.lastSeen = now;
    
    if (existing.count === ALERT_THRESHOLD) {
      logger.warn(`[P1-06 SECURITY] Repeated requests from non-Shopify origin`, {
        origin: sanitizedOrigin,
        count: existing.count,
        windowMinutes: Math.round((now - existing.firstSeen) / 60000),
        securityAlert: "rejected_origin_abuse",
      });
    }
  }
}

function sanitizeOriginForLogging(origin: string): string {
  try {
    const url = new URL(origin);
    return `${url.protocol}//${url.hostname}`;
  } catch {
    return origin.substring(0, 50);
  }
}

export function getRejectionStats(): Array<{
  origin: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
}> {
  const now = Date.now();
  const stats: Array<{
    origin: string;
    count: number;
    firstSeen: Date;
    lastSeen: Date;
  }> = [];

  rejectedOrigins.forEach((tracker, origin) => {
    if ((now - tracker.lastSeen) <= TRACKING_WINDOW_MS) {
      stats.push({
        origin,
        count: tracker.count,
        firstSeen: new Date(tracker.firstSeen),
        lastSeen: new Date(tracker.lastSeen),
      });
    }
  });

  return stats.sort((a, b) => b.count - a.count);
}

export function cleanupRejectionTracking(): number {
  const now = Date.now();
  let cleaned = 0;

  rejectedOrigins.forEach((tracker, origin) => {
    if ((now - tracker.lastSeen) > TRACKING_WINDOW_MS) {
      rejectedOrigins.delete(origin);
      cleaned++;
    }
  });

  return cleaned;
}

export function getAllowedPatterns(): Array<{
  pattern: string;
  description: string;
  example?: string;
}> {
  return [
    { 
      pattern: 'Origin: "null"', 
      description: "Web Pixel sandbox (expected)", 
      example: 'Origin: null',
    },
    ...ALLOWED_ORIGIN_PATTERNS.map(p => ({
      pattern: p.pattern.toString(),
      description: p.description,
      example: p.example,
    })),
    ...(isDevMode() ? DEV_ORIGIN_PATTERNS.map(p => ({
      pattern: p.pattern.toString(),
      description: `[DEV] ${p.description}`,
    })) : []),
  ];
}
