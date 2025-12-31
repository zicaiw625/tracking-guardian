

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
  const results: (R | undefined)[] = new Array(items.length);
  const executing: Array<{ promise: Promise<void>; index: number }> = [];
  const errors: Array<{ index: number; error: unknown }> = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const index = i;

    // 创建包装的 promise，捕获结果或错误
    const promise = fn(item, index)
      .then((result) => {
        results[index] = result;
      })
      .catch((error) => {
        // 收集错误而不是抛出，以便继续处理其他项
        errors.push({ index, error });
        results[index] = undefined;
      })
      .then(() => {
        // 返回 void 以匹配 Promise<void> 类型
      });

    executing.push({ promise, index });

    if (executing.length >= concurrency) {
      // 等待至少一个 promise 完成
      await Promise.race(executing.map((e) => e.promise));

      // 移除已完成的 promise（使用allSettled确保所有promise状态都已确定）
      const settled = await Promise.allSettled(
        executing.map((e) => e.promise)
      );
      
      // 从后往前移除已完成的promise，避免索引问题
      const toRemove: number[] = [];
      for (let j = settled.length - 1; j >= 0; j--) {
        if (settled[j].status === "fulfilled") {
          toRemove.push(j);
        }
      }
      
      // 按降序移除，确保索引正确
      for (const idx of toRemove.sort((a, b) => b - a)) {
        executing.splice(idx, 1);
      }
    }
  }

  // 等待所有剩余的 promise 完成
  const finalSettled = await Promise.allSettled(
    executing.map((e) => e.promise)
  );
  
  // 检查是否有未处理的错误（注意：finalSettled 和 executing 的索引是对应的）
  for (let j = 0; j < finalSettled.length; j++) {
    if (finalSettled[j].status === "rejected") {
      const executingItem = executing[j];
      if (executingItem) {
        errors.push({ index: executingItem.index, error: finalSettled[j].reason });
        // 确保结果数组中也标记为 undefined（虽然 catch 中已经处理了，但为了安全起见）
        results[executingItem.index] = undefined;
      }
    }
  }

  // 如果有错误，抛出聚合错误
  if (errors.length > 0) {
    const errorMessages = errors.map(
      (e) => `Item ${e.index}: ${e.error instanceof Error ? e.error.message : String(e.error)}`
    );
    throw new Error(
      `parallelLimit failed for ${errors.length} item(s):\n${errorMessages.join("\n")}`
    );
  }

  // 确保所有结果都已设置（类型断言是安全的，因为我们已经检查了错误）
  return results as R[];
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

