import { logger } from "./logger";

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
