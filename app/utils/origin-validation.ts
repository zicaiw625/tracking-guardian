/**
 * P1-06: Origin Validation for Pixel Events API
 * 
 * This module centralizes origin validation logic for better auditability
 * and maintainability. All allowed origins are explicitly documented.
 * 
 * SECURITY MODEL:
 * ================
 * Origin validation is one layer of defense-in-depth:
 * 1. TLS encryption (all traffic is HTTPS)
 * 2. Origin validation (this module) - only Shopify domains accepted
 * 3. Rate limiting - prevents abuse
 * 4. Ingestion key validation - filters misconfigured requests
 * 5. Order verification - orderId must match webhook for CAPI
 * 
 * ALLOWED ORIGINS:
 * ================
 * - "null" (string) - Web Pixel sandbox (expected for App Pixel)
 * - *.myshopify.com - Shopify store domains
 * - checkout.*.com - Shopify checkout domains
 * - *.shopify.com - Shopify internal domains
 * - localhost/127.0.0.1 - Development only (when NODE_ENV=development)
 */

import { logger } from "./logger";

/**
 * Allowed origin patterns for production
 * Each pattern includes documentation for audit purposes
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
    pattern: /^https:\/\/checkout\.[a-zA-Z0-9][a-zA-Z0-9\-]*\.com$/,
    description: "Shopify checkout domains",
    example: "https://checkout.shopify.com",
  },
  {
    pattern: /^https:\/\/[a-zA-Z0-9\-]+\.shopify\.com$/,
    description: "Shopify internal domains",
    example: "https://apps.shopify.com",
  },
];

/**
 * Allowed origin patterns for development (NODE_ENV=development or test)
 */
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

/**
 * Track rejected origins for monitoring (no PII)
 */
interface RejectedOriginTracker {
  count: number;
  firstSeen: number;
  lastSeen: number;
}

const rejectedOrigins = new Map<string, RejectedOriginTracker>();
const TRACKING_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const ALERT_THRESHOLD = 10;

/**
 * Check if the request is running in development mode
 */
export function isDevMode(): boolean {
  const nodeEnv = process.env.NODE_ENV;
  return nodeEnv === "development" || nodeEnv === "test";
}

/**
 * Validate if an origin is from Shopify domains
 * 
 * @param origin - The Origin header value
 * @returns true if the origin is valid Shopify origin
 * 
 * Note: "null" (the string) is valid - this is sent by Web Pixel sandbox
 */
export function isValidShopifyOrigin(origin: string | null): boolean {
  // Web Pixel sandbox sends Origin: "null" (the literal string)
  // This is expected behavior for sandboxed iframes
  if (origin === "null") {
    return true;
  }

  // Missing Origin header is rejected
  // This prevents server-to-server requests from bypassing validation
  if (!origin) {
    return false;
  }

  // Check against allowed Shopify patterns
  return ALLOWED_ORIGIN_PATTERNS.some(({ pattern }) => pattern.test(origin));
}

/**
 * Validate if an origin is from development servers
 * Only applicable when isDevMode() returns true
 */
export function isValidDevOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return DEV_ORIGIN_PATTERNS.some(({ pattern }) => pattern.test(origin));
}

/**
 * Validate origin with full logging and tracking
 * Returns validation result with reason for debugging
 */
export function validateOrigin(origin: string | null): {
  valid: boolean;
  reason: string;
  shouldLog: boolean;
} {
  // Web Pixel sandbox
  if (origin === "null") {
    return { valid: true, reason: "sandbox_origin", shouldLog: false };
  }

  // Missing origin
  if (!origin) {
    return { valid: false, reason: "missing_origin", shouldLog: true };
  }

  // Check production patterns
  for (const { pattern, description } of ALLOWED_ORIGIN_PATTERNS) {
    if (pattern.test(origin)) {
      return { valid: true, reason: description, shouldLog: false };
    }
  }

  // Check dev patterns in dev mode
  if (isDevMode()) {
    for (const { pattern, description } of DEV_ORIGIN_PATTERNS) {
      if (pattern.test(origin)) {
        return { valid: true, reason: `dev:${description}`, shouldLog: false };
      }
    }
  }

  // Track and potentially alert on rejected origins
  trackRejectedOrigin(origin);

  return { valid: false, reason: "unknown_origin", shouldLog: true };
}

/**
 * Track rejected origins for monitoring
 * Only stores origin pattern, not full URL to avoid PII
 */
function trackRejectedOrigin(origin: string): void {
  const now = Date.now();
  
  // Sanitize origin: only keep protocol and domain (no path/query)
  const sanitizedOrigin = sanitizeOriginForLogging(origin);
  
  const existing = rejectedOrigins.get(sanitizedOrigin);
  
  if (!existing || (now - existing.firstSeen) > TRACKING_WINDOW_MS) {
    // Start new tracking window
    rejectedOrigins.set(sanitizedOrigin, {
      count: 1,
      firstSeen: now,
      lastSeen: now,
    });
  } else {
    existing.count++;
    existing.lastSeen = now;
    
    // Alert on threshold
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

/**
 * Sanitize origin for logging (remove potential PII/paths)
 */
function sanitizeOriginForLogging(origin: string): string {
  try {
    const url = new URL(origin);
    // Only return protocol + hostname (no port for simplicity)
    return `${url.protocol}//${url.hostname}`;
  } catch {
    // Invalid URL - truncate and return
    return origin.substring(0, 50);
  }
}

/**
 * Get rejection statistics for monitoring dashboard
 */
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
    // Only include recent data
    if ((now - tracker.lastSeen) <= TRACKING_WINDOW_MS) {
      stats.push({
        origin,
        count: tracker.count,
        firstSeen: new Date(tracker.firstSeen),
        lastSeen: new Date(tracker.lastSeen),
      });
    }
  });

  // Sort by count descending
  return stats.sort((a, b) => b.count - a.count);
}

/**
 * Clean up old rejection tracking data
 * Call periodically to prevent memory growth
 */
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

/**
 * Export allowed patterns for documentation/testing
 */
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

