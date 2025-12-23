/**
 * Platform Service Interface
 *
 * Unified interface for all advertising platform CAPI integrations.
 * This abstraction allows consistent handling across Google, Meta, and TikTok.
 */

import type {
  ConversionData,
  ConversionApiResponse,
  PlatformCredentials,
  PlatformError,
  Result,
} from "../../types";
import type { PlatformType } from "../../types/enums";
import type { AppError } from "../../utils/errors";

// =============================================================================
// Result Types
// =============================================================================

/**
 * Result of a conversion send operation.
 * Uses the unified Result type for type-safe error handling.
 */
export interface PlatformSendResult {
  success: boolean;
  response?: ConversionApiResponse;
  error?: PlatformError;
  duration?: number;
}

/**
 * Type-safe send result using Result pattern
 */
export type SendResult = Result<
  { response: ConversionApiResponse; duration: number },
  AppError
>;

/**
 * Result of credentials validation.
 */
export interface CredentialsValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Platform health status.
 */
export interface PlatformHealthStatus {
  healthy: boolean;
  lastError?: string;
  lastSuccessAt?: Date;
  errorRate?: number;
}

// =============================================================================
// Platform Service Interface
// =============================================================================

/**
 * Unified interface for platform CAPI services.
 *
 * Each platform (Google, Meta, TikTok) implements this interface
 * to provide consistent behavior for:
 * - Sending conversion events
 * - Validating credentials
 * - Parsing platform-specific errors
 */
export interface IPlatformService {
  /**
   * The platform identifier.
   */
  readonly platform: PlatformType;

  /**
   * Human-readable platform name.
   */
  readonly displayName: string;

  /**
   * Send a conversion event to the platform.
   *
   * @param credentials - Platform-specific credentials (discriminated union)
   * @param data - Conversion data to send
   * @param eventId - Unique event ID for deduplication
   * @returns Promise resolving to send result
   */
  sendConversion(
    credentials: PlatformCredentials,
    data: ConversionData,
    eventId: string
  ): Promise<PlatformSendResult>;

  /**
   * Validate platform credentials format.
   * Does NOT verify with the platform API (use testCredentials for that).
   *
   * @param credentials - Credentials to validate
   * @returns Validation result
   */
  validateCredentials(credentials: unknown): CredentialsValidationResult;

  /**
   * Parse platform-specific error into standardized format.
   *
   * @param error - Raw error from platform API
   * @returns Standardized platform error
   */
  parseError(error: unknown): PlatformError;

  /**
   * Build the event payload for this platform.
   * Useful for debugging and logging.
   *
   * @param data - Conversion data
   * @param eventId - Event ID
   * @returns Platform-specific payload object
   */
  buildPayload(
    data: ConversionData,
    eventId: string
  ): Promise<Record<string, unknown>>;
}

// =============================================================================
// Re-export type guards from types/platform.ts
// =============================================================================

export {
  isGoogleCredentials,
  isMetaCredentials,
  isTikTokCredentials,
} from "../../types/platform";

// =============================================================================
// Constants
// =============================================================================

/**
 * Default API timeout in milliseconds.
 */
export const DEFAULT_API_TIMEOUT_MS = 30000;

/**
 * Maximum retry attempts for transient errors.
 */
export const MAX_RETRY_ATTEMPTS = 3;

/**
 * Retry delay multiplier for exponential backoff.
 */
export const RETRY_DELAY_MULTIPLIER = 2;

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Fetch with timeout support.
 *
 * @param url - Request URL
 * @param options - Fetch options
 * @param timeoutMs - Timeout in milliseconds
 * @returns Promise resolving to Response
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = DEFAULT_API_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Generate a deduplication event ID.
 *
 * @param orderId - Order identifier
 * @param eventType - Event type (e.g., 'purchase')
 * @param timestamp - Optional timestamp (defaults to now)
 * @returns Deduplication event ID
 */
export function generateDedupeEventId(
  orderId: string,
  eventType: string = "purchase",
  timestamp: number = Date.now()
): string {
  return `${orderId}_${eventType}_${timestamp}`;
}

/**
 * Measure execution duration.
 *
 * @param fn - Async function to measure
 * @returns Promise resolving to [result, durationMs]
 */
export async function measureDuration<T>(
  fn: () => Promise<T>
): Promise<[T, number]> {
  const start = performance.now();
  const result = await fn();
  const duration = Math.round(performance.now() - start);
  return [result, duration];
}
