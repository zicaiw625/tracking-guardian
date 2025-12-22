import { logger } from "./logger";

export const SHOPIFY_ALLOWLIST = [
  "checkout.shopify.com",
  "shopify.com",
  "myshopify.com",
  "shopifypreview.com",
] as const;

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

export function validatePixelOriginPreBody(origin: string | null): {
  valid: boolean;
  reason: string;
  shouldLog: boolean;
} {
  if (origin === "null" || origin === null) {
    return { valid: true, reason: "sandbox_origin", shouldLog: false };
  }

  if (!origin) {
    return { valid: true, reason: "no_origin_header", shouldLog: false };
  }

  try {
    const url = new URL(origin);
    
    if (url.protocol === "file:") {
      return { valid: false, reason: "file_protocol_blocked", shouldLog: true };
    }
    if (url.protocol === "chrome-extension:") {
      return { valid: false, reason: "chrome_extension_blocked", shouldLog: true };
    }
    if (url.protocol === "data:") {
      return { valid: false, reason: "data_protocol_blocked", shouldLog: true };
    }
    if (url.protocol === "blob:") {
      return { valid: false, reason: "blob_protocol_blocked", shouldLog: true };
    }
    
    if (url.protocol === "http:") {
      if (isDevMode() && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
        return { valid: true, reason: "dev_localhost_http", shouldLog: false };
      }
      return { valid: false, reason: "http_not_allowed", shouldLog: true };
    }

    if (url.protocol === "https:") {
      return { valid: true, reason: "https_origin", shouldLog: false };
    }

    return { valid: false, reason: "invalid_protocol", shouldLog: true };
  } catch {
    return { valid: false, reason: "malformed_origin", shouldLog: true };
  }
}

export function validatePixelOriginForShop(
  origin: string | null,
  shopAllowedDomains: string[]
): {
  valid: boolean;
  reason: string;
  matched?: string;
  shouldReject: boolean;
} {
  if (origin === "null" || origin === null) {
    return { valid: true, reason: "sandbox_origin", shouldReject: false };
  }

  if (!origin) {
    return { valid: true, reason: "no_origin_header", shouldReject: false };
  }

  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();

    if (url.protocol !== "https:" && !isDevMode()) {
      return { valid: false, reason: "https_required", shouldReject: true };
    }

    for (const domain of shopAllowedDomains) {
      const normalizedDomain = domain.toLowerCase();
      
      if (hostname === normalizedDomain) {
        return { valid: true, reason: "exact_match", matched: domain, shouldReject: false };
      }
      
      if (hostname.endsWith(`.${normalizedDomain}`)) {
        return { valid: true, reason: "subdomain_match", matched: domain, shouldReject: false };
      }
    }

    for (const shopifyDomain of SHOPIFY_ALLOWLIST) {
      if (hostname === shopifyDomain || hostname.endsWith(`.${shopifyDomain}`)) {
        return { valid: true, reason: "shopify_platform_domain", matched: shopifyDomain, shouldReject: false };
      }
    }

    if (isDevMode() && (hostname === "localhost" || hostname === "127.0.0.1")) {
      return { valid: true, reason: "dev_localhost", shouldReject: false };
    }

    trackRejectedOrigin(origin);
    return {
      valid: false,
      reason: `origin_not_allowlisted:${hostname}`,
      shouldReject: true,
    };
  } catch {
    return { valid: false, reason: "malformed_origin", shouldReject: true };
  }
}

/**
 * P1-3: Expand domain to include www variant
 * 
 * For a domain like "example.com", also allow "www.example.com"
 * For a domain like "www.example.com", also allow "example.com"
 */
function expandDomainVariants(domain: string): string[] {
  const normalized = domain.toLowerCase();
  const variants: string[] = [normalized];
  
  // Don't expand .myshopify.com domains (they don't have www)
  if (normalized.endsWith(".myshopify.com")) {
    return variants;
  }
  
  // Don't expand Shopify platform domains
  for (const shopifyDomain of SHOPIFY_ALLOWLIST) {
    if (normalized === shopifyDomain || normalized.endsWith(`.${shopifyDomain}`)) {
      return variants;
    }
  }
  
  // Add www variant
  if (normalized.startsWith("www.")) {
    // www.example.com -> also allow example.com
    variants.push(normalized.substring(4));
  } else if (!normalized.includes(".") || normalized.split(".").length === 2) {
    // example.com -> also allow www.example.com
    // But don't add www to subdomains like shop.example.com
    const parts = normalized.split(".");
    if (parts.length === 2) {
      variants.push(`www.${normalized}`);
    }
  }
  
  return variants;
}

export function buildShopAllowedDomains(options: {
  shopDomain: string;
  primaryDomain?: string | null;
  storefrontDomains?: string[];
}): string[] {
  const domains = new Set<string>();
  
  if (options.shopDomain) {
    // P1-3: Expand variants for shop domain
    for (const variant of expandDomainVariants(options.shopDomain)) {
      domains.add(variant);
    }
  }
  
  if (options.primaryDomain) {
    // P1-3: Expand variants for primary domain (the custom domain)
    for (const variant of expandDomainVariants(options.primaryDomain)) {
      domains.add(variant);
    }
  }
  
  if (options.storefrontDomains) {
    for (const domain of options.storefrontDomains) {
      if (domain) {
        // P1-3: Expand variants for each storefront domain
        for (const variant of expandDomainVariants(domain)) {
          domains.add(variant);
        }
      }
    }
  }
  
  // Add Shopify platform domains
  for (const shopifyDomain of SHOPIFY_ALLOWLIST) {
    domains.add(shopifyDomain);
  }
  
  return Array.from(domains);
}

export function isValidPixelOrigin(origin: string | null): {
  valid: boolean;
  reason: string;
} {
  const preBodyResult = validatePixelOriginPreBody(origin);
  return { valid: preBodyResult.valid, reason: preBodyResult.reason };
}

export function isOriginInAllowlist(
  origin: string | null,
  allowedDomains: string[]
): {
  valid: boolean;
  reason: string;
  matched?: string;
} {
  const result = validatePixelOriginForShop(origin, allowedDomains);
  return {
    valid: result.valid,
    reason: result.reason,
    matched: result.matched,
  };
}

export function buildDefaultAllowedDomains(
  myshopifyDomain: string,
  primaryDomain?: string | null,
  additionalDomains?: string[]
): string[] {
  return buildShopAllowedDomains({
    shopDomain: myshopifyDomain,
    primaryDomain,
    storefrontDomains: additionalDomains,
  });
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

export function extractOriginHost(origin: string | null): string | null {
  if (!origin || origin === "null") {
    return null;
  }

  try {
    const url = new URL(origin);
    return url.hostname;
  } catch {
    return null;
  }
}
