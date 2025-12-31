

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

export function truncate(
  str: string | undefined | null,
  maxLength: number = 50,
  suffix: string = "..."
): string {
  if (!str) return "";
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - suffix.length) + suffix;
}

export function normalizeShopDomain(domain: string): string {
  return domain.toLowerCase().trim();
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "An unknown error occurred";
}

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

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function removeNullish<T extends Record<string, unknown>>(
  obj: T
): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null)
  ) as Partial<T>;
}

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export function unique<T>(array: T[]): T[] {
  return [...new Set(array)];
}

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

export function isWithinTimeWindow(date: Date, windowMs: number): boolean {
  const now = Date.now();
  const dateMs = date.getTime();
  return Math.abs(now - dateMs) <= windowMs;
}

export function getCurrentYearMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

export function daysAgoUTC(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

      for (let j = executing.length - 1; j >= 0; j--) {
        const p = executing[j];

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

export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function isShopifyDomain(domain: string): boolean {
  return domain.endsWith(".myshopify.com");
}

export function generateSimpleId(prefix: string = ""): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return prefix ? `${prefix}_${timestamp}${random}` : `${timestamp}${random}`;
}

export function extractShopifyId(gid: string | number): string {
  if (typeof gid === "number") {
    return String(gid);
  }
  if (gid.startsWith("gid://shopify/WebPixel/")) {
    const parts = gid.split("/");
    return parts[parts.length - 1];
  }
  return gid;
}

