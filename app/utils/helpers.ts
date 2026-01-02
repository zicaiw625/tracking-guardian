

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
  if (maxLength <= 0) return suffix;
  if (str.length <= maxLength) return str;
  const safeMaxLength = Math.max(0, maxLength - suffix.length);
  return str.substring(0, safeMaxLength) + suffix;
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
  if (visibleChars <= 0) return "***";
  
  // 如果字符串太短，无法安全显示，直接返回掩码
  if (value.length <= 3) return "***";
  
  // 计算安全的可见字符数：确保前后都有足够的字符，中间有掩码
  // 最小需要：前visibleChars + "***" + 后visibleChars = visibleChars * 2 + 3
  const minRequiredLength = visibleChars * 2 + 3;
  if (value.length < minRequiredLength) {
    // 如果长度不足，显示尽可能多的字符，但至少前后各1个字符
    const safeVisibleChars = Math.max(1, Math.floor((value.length - 3) / 2));
    return (
      value.substring(0, safeVisibleChars) +
      "***" +
      value.substring(value.length - safeVisibleChars)
    );
  }
  
  // 长度足够，使用请求的visibleChars，但不超过字符串长度的一半
  const safeVisibleChars = Math.min(visibleChars, Math.floor((value.length - 3) / 2));
  return (
    value.substring(0, safeVisibleChars) +
    "***" +
    value.substring(value.length - safeVisibleChars)
  );
}

// 使用现有的isObject函数，避免重复定义

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
    if (!isObject(current)) {
      return fallback;
    }
    if (!(key in current)) {
      return fallback;
    }
    current = current[key];
  }

  // 类型断言在这里是安全的，因为我们已经验证了路径存在
  // 但返回类型允许undefined，所以如果类型不匹配会返回fallback
  return (current as T) ?? fallback;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function removeNullish<T extends Record<string, unknown>>(
  obj: T
): Partial<T> {
  const filtered = Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null)
  );

  return filtered as Partial<T>;
}

export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as T;
  }

  if (obj instanceof RegExp) {
    return new RegExp(obj.source, obj.flags) as T;
  }

  if (obj instanceof Map) {
    const clonedMap = new Map();
    obj.forEach((val, key) => {
      clonedMap.set(deepClone(key), deepClone(val));
    });
    return clonedMap as T;
  }

  if (obj instanceof Set) {
    const clonedSet = new Set();
    obj.forEach((val) => {
      clonedSet.add(deepClone(val));
    });
    return clonedSet as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item)) as T;
  }

  if (obj instanceof ArrayBuffer) {
    return obj.slice(0) as T;
  }

  if (obj instanceof Error) {
    const clonedError = new (obj.constructor as new (message: string) => Error)(obj.message);
    clonedError.name = obj.name;
    clonedError.stack = obj.stack;
    return clonedError as T;
  }

  const cloned = {} as T;
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      try {
        (cloned as Record<string, unknown>)[key] = deepClone((obj as Record<string, unknown>)[key]);
      } catch {
        (cloned as Record<string, unknown>)[key] = (obj as Record<string, unknown>)[key];
      }
    }
  }

  return cloned;
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
  const groups: Partial<Record<K, T[]>> = {};

  for (const item of array) {
    const key = keyFn(item);
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key]!.push(item);
  }

  return groups as Record<K, T[]>;
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

  // 确保至少执行一次
  const safeMaxAttempts = Math.max(1, maxAttempts);

  let lastError: unknown;

  for (let attempt = 1; attempt <= safeMaxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === safeMaxAttempts || !shouldRetry(error)) {
        throw error;
      }

      const delayMs = Math.min(
        initialDelayMs * Math.pow(2, attempt - 1),
        maxDelayMs
      );
      await delay(delayMs);
    }
  }

  // 如果循环结束但还没有返回或抛出，确保抛出最后一个错误
  if (lastError !== undefined) {
    throw lastError;
  }

  // 理论上不应该到达这里，但为了类型安全添加
  throw new Error("Retry function failed without capturing an error");
}

/**
 * 安全地执行一个 fire-and-forget Promise
 * 确保所有错误都被捕获和记录，避免未处理的 Promise 拒绝
 */
import { logger } from "./logger.server";

export function safeFireAndForget<T>(
  promise: Promise<T>,
  errorContext?: {
    operation?: string;
    metadata?: Record<string, unknown>;
  }
): void {
  promise.catch((error) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error(
      errorContext?.operation || "Fire-and-forget operation failed",
      error instanceof Error ? error : new Error(String(error)),
      {
        ...errorContext?.metadata,
        errorMessage,
        errorStack,
      }
    );
  });
}

export async function parallelLimit<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Array.isArray(items)) {
    throw new Error("parallelLimit: items must be an array");
  }
  if (items.length === 0) {
    return [];
  }
  if (concurrency <= 0) {
    throw new Error("parallelLimit: concurrency must be greater than 0");
  }

  const results: (R | undefined)[] = new Array(items.length);
  const errors: Array<{ index: number; error: unknown }> = [];

  const executing = new Map<number, Promise<{ index: number; result?: R; error?: unknown }>>();
  let nextIndex = 0;

  while (nextIndex < items.length && executing.size < concurrency) {
    const index = nextIndex++;
    const item = items[index];

    const promise = fn(item, index)
      .then((result) => ({ index, result }))
      .catch((error) => ({ index, error }));

    executing.set(index, promise);
  }

  while (executing.size > 0) {

    const settled = await Promise.race(
      Array.from(executing.values())
    );

    if (settled.error !== undefined) {
      errors.push({ index: settled.index, error: settled.error });
      results[settled.index] = undefined;
    } else {
      results[settled.index] = settled.result;
    }

    executing.delete(settled.index);

    if (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index];

      const promise = fn(item, index)
        .then((result) => ({ index, result }))
        .catch((error) => ({ index, error }));

      executing.set(index, promise);
    }
  }

  if (errors.length > 0) {
    const errorMessages = errors.map(
      (e) => `Item ${e.index}: ${e.error instanceof Error ? e.error.message : String(e.error)}`
    );
    throw new Error(
      `parallelLimit failed for ${errors.length} item(s):\n${errorMessages.join("\n")}`
    );
  }

  const validResults = results.filter((r): r is R => r !== undefined);

  if (validResults.length !== items.length) {
    throw new Error(
      `parallelLimit: Expected ${items.length} results but got ${validResults.length}. This indicates an internal error.`
    );
  }

  return validResults;
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
  if (gid.startsWith("gid://")) {
    const parts = gid.split("/");
    return parts[parts.length - 1];
  }
  return gid;
}

