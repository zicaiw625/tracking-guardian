

export function safeJsonParse<T>(
  json: string | null | undefined,
  defaultValue: T
): T {
  if (!json) return defaultValue;

  try {
    return JSON.parse(json) as T;
  } catch {
    return defaultValue;
  }
}

export function safeJsonStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function deepClone<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }

  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags) as T;
  }

  if (value instanceof Map) {
    const clonedMap = new Map();
    value.forEach((val, key) => {
      clonedMap.set(deepClone(key), deepClone(val));
    });
    return clonedMap as T;
  }

  if (value instanceof Set) {
    const clonedSet = new Set();
    value.forEach((val) => {
      clonedSet.add(deepClone(val));
    });
    return clonedSet as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as T;
  }

  if (value instanceof ArrayBuffer) {
    return value.slice(0) as T;
  }

  if (value instanceof Error) {
    const clonedError = new (value.constructor as new (message: string) => Error)(value.message);
    clonedError.name = value.name;
    clonedError.stack = value.stack;
    return clonedError as T;
  }

  const cloned = {} as T;
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      try {
        (cloned as Record<string, unknown>)[key] = deepClone((value as Record<string, unknown>)[key]);
      } catch {
        (cloned as Record<string, unknown>)[key] = (value as Record<string, unknown>)[key];
      }
    }
  }

  return cloned;
}

export function truncate(str: string, maxLength: number): string {
  if (!str) return "";
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + "...";
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function camelToKebab(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

export function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

export function maskString(str: string, visibleChars: number = 4): string {
  if (str.length <= visibleChars * 2) {
    return "*".repeat(str.length);
  }
  return str.slice(0, visibleChars) + "***" + str.slice(-visibleChars);
}

export function formatNumber(num: number, locale: string = "zh-CN"): string {
  return num.toLocaleString(locale);
}

export function formatCurrency(
  amount: number,
  currency: string = "USD",
  locale: string = "en-US"
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(amount);
}

export function formatPercentage(value: number, decimals: number = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

export function clamp(num: number, min: number, max: number): number {
  return Math.min(Math.max(num, min), max);
}

export function roundTo(num: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
}

export function formatDate(
  date: Date | string,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
  },
  locale: string = "zh-CN"
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) {
    return "Invalid Date";
  }
  return d.toLocaleDateString(locale, options);
}

export function formatDateTime(
  date: Date | string,
  locale: string = "zh-CN"
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) {
    return "Invalid Date";
  }
  return d.toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getRelativeTime(date: Date | string, locale: string = "zh-CN"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) {
    return "Invalid Date";
  }
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (diffDays > 0) {
    return rtf.format(-diffDays, "day");
  }
  if (diffHours > 0) {
    return rtf.format(-diffHours, "hour");
  }
  if (diffMinutes > 0) {
    return rtf.format(-diffMinutes, "minute");
  }
  return rtf.format(-diffSeconds, "second");
}

export function isDateInRange(
  date: Date,
  start: Date,
  end: Date
): boolean {
  return date >= start && date <= end;
}

export function getDayBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

export function getUTCDayBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);

  return { start, end };
}

export function getMonthBounds(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

export function unique<T>(array: T[]): T[] {
  return [...new Set(array)];
}

export function uniqueBy<T, K>(array: T[], keyFn: (item: T) => K): T[] {
  const seen = new Set<K>();
  return array.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function groupBy<T, K extends string | number>(
  array: T[],
  keyFn: (item: T) => K
): Record<K, T[]> {
  return array.reduce((groups, item) => {
    const key = keyFn(item);
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(item);
    return groups;
  }, {} as Record<K, T[]>);
}

export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export function flatten<T>(arrays: T[][]): T[] {
  return arrays.reduce((flat, arr) => [...flat, ...arr], []);
}

export function sum(numbers: number[]): number {
  return numbers.reduce((total, n) => total + n, 0);
}

export function average(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  return sum(numbers) / numbers.length;
}

export function pick<T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

export function omit<T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Omit<T, K> {
  const result = { ...obj } as Omit<T, K>;
  for (const key of keys) {
    delete (result as Record<string, unknown>)[key as string];
  }
  return result;
}

export function isEmpty(obj: object): boolean {
  return Object.keys(obj).length === 0;
}

export function deepMerge<T extends object>(...objects: Partial<T>[]): T {
  const result = {} as T;

  for (const obj of objects) {
    for (const key in obj) {
      const value = obj[key];
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        result[key] &&
        typeof result[key] === "object" &&
        !Array.isArray(result[key])
      ) {
        result[key] = deepMerge(
          result[key] as object,
          value as object
        ) as T[Extract<keyof T, string>];
      } else {
        result[key] = value as T[Extract<keyof T, string>];
      }
    }
  }

  return result;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    shouldRetry?: (error: unknown) => boolean;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    shouldRetry = () => true,
  } = options;

  // 确保至少执行一次
  const safeMaxAttempts = Math.max(1, maxAttempts);

  let lastError: unknown;

  for (let attempt = 1; attempt <= safeMaxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // 如果是最后一次尝试或不应该重试，直接抛出错误
      if (attempt === safeMaxAttempts || !shouldRetry(error)) {
        throw error;
      }

      // 计算延迟时间（指数退避）
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      await sleep(delay);
    }
  }

  // 理论上不应该到达这里，因为循环中已经处理了所有情况
  // 但为了类型安全，如果到达这里，抛出最后一个错误
  throw lastError ?? new Error("Retry function failed without capturing an error");
}

import { parallelLimit as parallelLimitWithIndex } from "./helpers";

export async function parallelLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {

  return parallelLimitWithIndex(items, limit, (item, _index) => fn(item));
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delayMs: number
): ((...args: Parameters<T>) => void) & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const debouncedFn = (...args: Parameters<T>) => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => fn(...args), delayMs);
  };

  debouncedFn.cancel = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
  };

  return debouncedFn;
}

export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limitMs: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;

  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCall >= limitMs) {
      lastCall = now;
      fn(...args);
    }
  };
}

export function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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

export function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function getEnvBoolean(key: string, defaultValue: boolean = false): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === "true" || value === "1";
}

export function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const num = parseInt(value, 10);
  return isNaN(num) ? defaultValue : num;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}

export function isTest(): boolean {
  return process.env.NODE_ENV === "test";
}

