/**
 * Common Helper Functions
 *
 * Utility functions for common operations throughout the codebase.
 * Consolidates repeated patterns into reusable functions.
 */

// =============================================================================
// Safe Parsing
// =============================================================================

/**
 * Safely parse a float value with fallback.
 * Handles undefined, null, empty strings, and invalid numbers.
 *
 * @example
 * safeParseFloat("123.45") // 123.45
 * safeParseFloat(null) // 0
 * safeParseFloat("invalid") // 0
 * safeParseFloat("", 10) // 10
 */
export function safeParseFloat(
  value: string | number | undefined | null,
  fallback: number = 0
): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "number") {
    return isNaN(value) ? fallback : value;
  }
  const parsed = parseFloat(value);
  return isNaN(parsed) ? fallback : parsed;
}

/**
 * Safely parse an integer value with fallback.
 */
export function safeParseInt(
  value: string | number | undefined | null,
  fallback: number = 0
): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "number") {
    return isNaN(value) ? fallback : Math.floor(value);
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
}

/**
 * Safely parse a boolean value.
 */
export function safeParseBool(
  value: string | boolean | undefined | null,
  fallback: boolean = false
): boolean {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const lower = value.toLowerCase().trim();
  if (lower === "true" || lower === "1" || lower === "yes") {
    return true;
  }
  if (lower === "false" || lower === "0" || lower === "no") {
    return false;
  }
  return fallback;
}

// =============================================================================
// String Utilities
// =============================================================================

/**
 * Truncate a string to a maximum length with ellipsis.
 */
export function truncate(
  str: string | undefined | null,
  maxLength: number = 50,
  suffix: string = "..."
): string {
  if (!str) return "";
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * Normalize a shop domain (lowercase, trim).
 */
export function normalizeShopDomain(domain: string): string {
  return domain.toLowerCase().trim();
}

/**
 * Safely get error message from any error type.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "An unknown error occurred";
}

/**
 * Mask sensitive data for logging (show first/last n chars).
 */
export function maskSensitive(
  value: string | undefined | null,
  visibleChars: number = 4
): string {
  if (!value) return "***";
  if (value.length <= visibleChars * 2) return "***";
  return (
    value.substring(0, visibleChars) +
    "***" +
    value.substring(value.length - visibleChars)
  );
}

// =============================================================================
// Object Utilities
// =============================================================================

/**
 * Safely access nested object property.
 */
export function getNestedValue<T>(
  obj: unknown,
  path: string,
  fallback?: T
): T | undefined {
  const keys = path.split(".");
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return fallback;
    }
    if (typeof current !== "object") {
      return fallback;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return (current as T) ?? fallback;
}

/**
 * Check if a value is a non-null object.
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Remove undefined and null values from an object.
 */
export function removeNullish<T extends Record<string, unknown>>(
  obj: T
): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null)
  ) as Partial<T>;
}

/**
 * Deep clone an object (JSON-safe).
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// =============================================================================
// Array Utilities
// =============================================================================

/**
 * Split array into chunks of specified size.
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Remove duplicates from an array.
 */
export function unique<T>(array: T[]): T[] {
  return [...new Set(array)];
}

/**
 * Group array items by a key.
 */
export function groupBy<T, K extends string | number>(
  array: T[],
  keyFn: (item: T) => K
): Record<K, T[]> {
  return array.reduce(
    (groups, item) => {
      const key = keyFn(item);
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(item);
      return groups;
    },
    {} as Record<K, T[]>
  );
}

// =============================================================================
// Date Utilities
// =============================================================================

/**
 * Check if a date is within a certain time window from now.
 */
export function isWithinTimeWindow(date: Date, windowMs: number): boolean {
  const now = Date.now();
  const dateMs = date.getTime();
  return Math.abs(now - dateMs) <= windowMs;
}

/**
 * Get current year-month string (e.g., "2024-12").
 */
export function getCurrentYearMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Calculate days ago from now (local timezone).
 * 
 * @deprecated Use daysAgoUTC for server-side statistics to ensure timezone consistency.
 */
export function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

/**
 * P0-3: Calculate days ago from now using UTC.
 * Use this for server-side statistics to ensure consistent results across timezones.
 */
export function daysAgoUTC(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

// =============================================================================
// Async Utilities
// =============================================================================

/**
 * Delay execution for specified milliseconds.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an async function with exponential backoff.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    shouldRetry?: (error: unknown) => boolean;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    shouldRetry = () => true,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts || !shouldRetry(error)) {
        throw error;
      }

      const delayMs = Math.min(
        initialDelayMs * Math.pow(2, attempt - 1),
        maxDelayMs
      );
      await delay(delayMs);
    }
  }

  throw lastError;
}

/**
 * Execute async functions with concurrency limit.
 */
export async function parallelLimit<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    const promise = fn(item, i).then((result) => {
      results[i] = result;
    });

    executing.push(promise as unknown as Promise<void>);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      // Remove completed promises
      for (let j = executing.length - 1; j >= 0; j--) {
        const p = executing[j];
        // Check if promise is settled
        const settled = await Promise.race([
          p.then(() => true),
          Promise.resolve(false),
        ]);
        if (settled) {
          executing.splice(j, 1);
        }
      }
    }
  }

  await Promise.all(executing);
  return results;
}

// =============================================================================
// Validation Utilities
// =============================================================================

/**
 * Check if a string is a valid email format.
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Check if a string is a valid URL.
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a string looks like a Shopify domain.
 */
export function isShopifyDomain(domain: string): boolean {
  return domain.endsWith(".myshopify.com");
}

// =============================================================================
// ID Utilities
// =============================================================================

/**
 * Generate a simple unique ID (for non-security purposes).
 */
export function generateSimpleId(prefix: string = ""): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return prefix ? `${prefix}_${timestamp}${random}` : `${timestamp}${random}`;
}

/**
 * Extract numeric ID from Shopify GID.
 * e.g., "gid://shopify/Order/12345" -> "12345"
 */
export function extractShopifyId(gid: string | number): string {
  if (typeof gid === "number") {
    return String(gid);
  }
  if (gid.startsWith("gid://")) {
    const parts = gid.split("/");
    return parts[parts.length - 1];
  }
  return gid;
}

