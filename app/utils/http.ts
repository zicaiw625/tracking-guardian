/**
 * Unified HTTP Utilities
 *
 * Provides standardized HTTP request handling with:
 * - Timeout support
 * - Retry logic with exponential backoff
 * - Error classification
 * - Request/response logging
 */

import { logger } from "./logger.server";

// =============================================================================
// Constants
// =============================================================================

export const DEFAULT_TIMEOUT_MS = 10000;
export const DEFAULT_RETRY_ATTEMPTS = 3;
export const DEFAULT_BASE_DELAY_MS = 1000;
export const DEFAULT_MAX_DELAY_MS = 30000;

// =============================================================================
// Types
// =============================================================================

export interface HttpRequestOptions extends RequestInit {
  /** Timeout in milliseconds */
  timeout?: number;
  /** Number of retry attempts */
  retries?: number;
  /** Base delay for retry backoff */
  baseDelayMs?: number;
  /** Maximum delay between retries */
  maxDelayMs?: number;
  /** Whether to retry on specific error types */
  retryOn?: Array<"timeout" | "network" | "5xx" | "429">;
}

export interface HttpResponse<T = unknown> {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  data: T;
  duration: number;
}

export interface HttpError {
  type: "timeout" | "network" | "http" | "parse" | "unknown";
  message: string;
  status?: number;
  retryable: boolean;
  retryAfter?: number;
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Fetch with timeout support.
 * This is a low-level function - prefer httpRequest for most cases.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Calculate exponential backoff delay with jitter.
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelayMs: number = DEFAULT_BASE_DELAY_MS,
  maxDelayMs: number = DEFAULT_MAX_DELAY_MS
): number {
  const exponentialDelay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
  const jitter = Math.random() * 0.3 * exponentialDelay;
  return Math.floor(exponentialDelay + jitter);
}

/**
 * Classify HTTP response into error type.
 */
export function classifyHttpResponse(status: number): HttpError["type"] {
  if (status >= 200 && status < 300) return "http";
  if (status === 429) return "http";
  if (status >= 500) return "http";
  return "http";
}

/**
 * Determine if an error/response is retryable.
 */
export function isRetryableStatus(
  status: number,
  retryOn: HttpRequestOptions["retryOn"] = ["timeout", "network", "5xx", "429"]
): boolean {
  if (retryOn.includes("5xx") && status >= 500) return true;
  if (retryOn.includes("429") && status === 429) return true;
  return false;
}

/**
 * Extract retry-after header value in milliseconds.
 */
export function extractRetryAfter(response: Response): number | undefined {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) return undefined;

  // Could be seconds or HTTP date
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000;
  }

  // Try parsing as date
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }

  return undefined;
}

/**
 * Sleep for a specified duration.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// High-Level HTTP Client
// =============================================================================

/**
 * Make an HTTP request with timeout, retries, and error handling.
 *
 * @example
 * ```typescript
 * const response = await httpRequest<{ data: string }>('/api/endpoint', {
 *   method: 'POST',
 *   body: JSON.stringify({ key: 'value' }),
 *   headers: { 'Content-Type': 'application/json' },
 *   timeout: 5000,
 *   retries: 3,
 * });
 *
 * if (response.ok) {
 *   console.log(response.data);
 * }
 * ```
 */
export async function httpRequest<T = unknown>(
  url: string,
  options: HttpRequestOptions = {}
): Promise<HttpResponse<T>> {
  const {
    timeout = DEFAULT_TIMEOUT_MS,
    retries = 0,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    retryOn = ["timeout", "network", "5xx"],
    ...fetchOptions
  } = options;

  let lastError: Error | undefined;
  const startTime = Date.now();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, fetchOptions, timeout);
      const duration = Date.now() - startTime;

      // Check if we should retry based on status
      if (!response.ok && isRetryableStatus(response.status, retryOn) && attempt < retries) {
        const retryAfter = extractRetryAfter(response) || calculateBackoffDelay(attempt + 1, baseDelayMs, maxDelayMs);
        logger.debug(`HTTP ${response.status} from ${url}, retrying in ${retryAfter}ms`, {
          attempt: attempt + 1,
          maxAttempts: retries + 1,
        });
        await sleep(retryAfter);
        continue;
      }

      // Parse response body
      let data: T;
      const contentType = response.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        data = await response.json();
      } else {
        data = (await response.text()) as unknown as T;
      }

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        data,
        duration,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const duration = Date.now() - startTime;

      // Check if retryable
      const isTimeout = lastError.name === "AbortError";
      const isNetwork = lastError.message.includes("fetch") || lastError.message.includes("network");
      const shouldRetry =
        attempt < retries &&
        ((isTimeout && retryOn.includes("timeout")) || (isNetwork && retryOn.includes("network")));

      if (shouldRetry) {
        const delay = calculateBackoffDelay(attempt + 1, baseDelayMs, maxDelayMs);
        logger.debug(`HTTP error: ${lastError.message}, retrying in ${delay}ms`, {
          url,
          attempt: attempt + 1,
          maxAttempts: retries + 1,
          isTimeout,
          isNetwork,
        });
        await sleep(delay);
        continue;
      }

      // Build error response
      const httpError: HttpError = {
        type: isTimeout ? "timeout" : isNetwork ? "network" : "unknown",
        message: lastError.message,
        retryable: false,
      };

      return {
        ok: false,
        status: isTimeout ? 408 : 0,
        statusText: httpError.type,
        headers: new Headers(),
        data: httpError as unknown as T,
        duration,
      };
    }
  }

  // Should not reach here, but handle just in case
  const duration = Date.now() - startTime;
  return {
    ok: false,
    status: 0,
    statusText: "unknown",
    headers: new Headers(),
    data: {
      type: "unknown",
      message: lastError?.message || "Unknown error",
      retryable: false,
    } as unknown as T,
    duration,
  };
}

// =============================================================================
// JSON Helpers
// =============================================================================

/**
 * POST JSON to a URL with standard headers.
 */
export async function postJson<T = unknown>(
  url: string,
  body: unknown,
  options: Omit<HttpRequestOptions, "method" | "body"> = {}
): Promise<HttpResponse<T>> {
  return httpRequest<T>(url, {
    ...options,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: JSON.stringify(body),
  });
}

/**
 * GET JSON from a URL.
 */
export async function getJson<T = unknown>(
  url: string,
  options: Omit<HttpRequestOptions, "method" | "body"> = {}
): Promise<HttpResponse<T>> {
  return httpRequest<T>(url, {
    ...options,
    method: "GET",
    headers: {
      Accept: "application/json",
      ...options.headers,
    },
  });
}

// =============================================================================
// Utility Exports
// =============================================================================

/**
 * Generate a unique request ID for tracing.
 */
export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Build URL with query parameters.
 */
export function buildUrl(base: string, params: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * Measure the duration of an async operation.
 */
export async function measureDuration<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = Date.now();
  const result = await fn();
  return [result, Date.now() - start];
}

