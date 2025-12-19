/**
 * Base Platform Service
 * 
 * P1-5: Provides standardized error handling for all platform CAPI integrations
 * 
 * Error Classification:
 * - Retryable: Transient errors that may succeed on retry (timeouts, 5xx, rate limits)
 * - Non-retryable: Permanent errors that won't succeed on retry (auth errors, invalid config)
 */

// ==========================================
// Error Types
// ==========================================

export type PlatformErrorType = 
  | "auth_error"           // Invalid credentials (401/403) - non-retryable
  | "invalid_config"       // Invalid pixel ID, measurement ID etc - non-retryable
  | "rate_limited"         // Platform rate limit hit - retryable with backoff
  | "server_error"         // Platform 5xx error - retryable
  | "timeout"              // Request timeout - retryable
  | "network_error"        // Network connectivity issues - retryable
  | "validation_error"     // Invalid event data - non-retryable
  | "quota_exceeded"       // Account quota exceeded - non-retryable until reset
  | "unknown";             // Unknown error - treat as retryable

export interface PlatformError {
  type: PlatformErrorType;
  message: string;
  retryable: boolean;
  platformCode?: string;      // Platform-specific error code
  platformMessage?: string;   // Platform-specific error message
  traceId?: string;           // Platform trace ID (e.g., fbtrace_id)
  retryAfter?: number;        // Seconds to wait before retry (for rate limits)
}

export interface PlatformResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: PlatformError;
}

// ==========================================
// Error Classification
// ==========================================

/**
 * Classify HTTP status codes into error types
 */
export function classifyHttpError(status: number, body?: unknown): PlatformError {
  const bodyStr = typeof body === "string" ? body : JSON.stringify(body || {});
  
  switch (true) {
    case status === 401:
      return {
        type: "auth_error",
        message: "Invalid or expired access token",
        retryable: false,
        platformCode: String(status),
      };
      
    case status === 403:
      return {
        type: "auth_error",
        message: "Access denied - check permissions",
        retryable: false,
        platformCode: String(status),
      };
      
    case status === 400:
      return {
        type: "validation_error",
        message: "Invalid request data",
        retryable: false,
        platformCode: String(status),
        platformMessage: bodyStr.slice(0, 500),
      };
      
    case status === 429:
      return {
        type: "rate_limited",
        message: "Rate limit exceeded",
        retryable: true,
        platformCode: String(status),
        retryAfter: 60, // Default 1 minute
      };
      
    case status >= 500 && status < 600:
      return {
        type: "server_error",
        message: `Platform server error (${status})`,
        retryable: true,
        platformCode: String(status),
      };
      
    default:
      return {
        type: "unknown",
        message: `Unexpected status code: ${status}`,
        retryable: true,
        platformCode: String(status),
      };
  }
}

/**
 * Classify JavaScript errors into platform errors
 */
export function classifyJsError(error: Error): PlatformError {
  const message = error.message.toLowerCase();
  
  // Timeout errors
  if (message.includes("timeout") || message.includes("aborted") || error.name === "AbortError") {
    return {
      type: "timeout",
      message: "Request timeout",
      retryable: true,
    };
  }
  
  // Network errors
  if (message.includes("network") || message.includes("fetch") || message.includes("econnrefused")) {
    return {
      type: "network_error",
      message: "Network error",
      retryable: true,
    };
  }
  
  // Default to unknown (retryable)
  return {
    type: "unknown",
    message: error.message,
    retryable: true,
  };
}

// ==========================================
// Platform-Specific Error Parsers
// ==========================================

/**
 * Parse Meta (Facebook) API error response
 */
export function parseMetaError(response: unknown): PlatformError {
  const data = response as { error?: { message?: string; code?: number; fbtrace_id?: string } };
  const error = data?.error;
  
  if (!error) {
    return {
      type: "unknown",
      message: "Unknown Meta API error",
      retryable: true,
    };
  }
  
  const code = error.code;
  const message = error.message || "Unknown error";
  const traceId = error.fbtrace_id;
  
  // Meta error code classification
  // https://developers.facebook.com/docs/marketing-api/error-reference
  switch (true) {
    case code === 190: // Invalid OAuth access token
    case code === 102: // Login status or access token has expired
      return {
        type: "auth_error",
        message: "Access token expired or invalid",
        retryable: false,
        platformCode: String(code),
        platformMessage: message,
        traceId,
      };
      
    case code === 100: // Invalid parameter
    case code === 803: // Invalid Pixel ID
      return {
        type: "invalid_config",
        message: "Invalid Pixel ID or parameter",
        retryable: false,
        platformCode: String(code),
        platformMessage: message,
        traceId,
      };
      
    case code === 4 || code === 17: // Rate limit
      return {
        type: "rate_limited",
        message: "Meta API rate limit exceeded",
        retryable: true,
        platformCode: String(code),
        platformMessage: message,
        traceId,
        retryAfter: 60,
      };
      
    case code === 1 || code === 2: // API service error
      return {
        type: "server_error",
        message: "Meta API service error",
        retryable: true,
        platformCode: String(code),
        platformMessage: message,
        traceId,
      };
      
    default:
      return {
        type: "unknown",
        message,
        retryable: true,
        platformCode: String(code),
        traceId,
      };
  }
}

/**
 * Parse Google Analytics 4 Measurement Protocol error
 */
export function parseGoogleError(response: unknown): PlatformError {
  const data = response as { validationMessages?: Array<{ description?: string; validationCode?: string }> };
  const messages = data?.validationMessages;
  
  if (!messages || messages.length === 0) {
    return {
      type: "unknown",
      message: "Unknown Google Analytics error",
      retryable: true,
    };
  }
  
  const firstError = messages[0];
  const code = firstError.validationCode || "UNKNOWN";
  const message = firstError.description || "Validation error";
  
  // GA4 validation code classification
  switch (code) {
    case "INVALID_API_SECRET":
    case "INVALID_MEASUREMENT_ID":
      return {
        type: "auth_error",
        message: "Invalid API secret or Measurement ID",
        retryable: false,
        platformCode: code,
        platformMessage: message,
      };
      
    case "INVALID_EVENT_NAME":
    case "INVALID_PARAMETER":
      return {
        type: "validation_error",
        message: "Invalid event data",
        retryable: false,
        platformCode: code,
        platformMessage: message,
      };
      
    default:
      return {
        type: "unknown",
        message,
        retryable: true,
        platformCode: code,
      };
  }
}

/**
 * Parse TikTok Events API error
 */
export function parseTikTokError(response: unknown): PlatformError {
  const data = response as { code?: number; message?: string };
  const code = data?.code;
  const message = data?.message || "Unknown error";
  
  // TikTok error code classification
  switch (true) {
    case code === 40001: // Invalid access token
    case code === 40002: // Access token expired
      return {
        type: "auth_error",
        message: "Access token invalid or expired",
        retryable: false,
        platformCode: String(code),
        platformMessage: message,
      };
      
    case code === 40100: // Invalid pixel ID
      return {
        type: "invalid_config",
        message: "Invalid Pixel ID",
        retryable: false,
        platformCode: String(code),
        platformMessage: message,
      };
      
    case code === 40300: // Invalid event data
      return {
        type: "validation_error",
        message: "Invalid event data",
        retryable: false,
        platformCode: String(code),
        platformMessage: message,
      };
      
    case code === 42900: // Rate limit
      return {
        type: "rate_limited",
        message: "TikTok API rate limit exceeded",
        retryable: true,
        platformCode: String(code),
        platformMessage: message,
        retryAfter: 60,
      };
      
    case code && code >= 50000: // Server errors
      return {
        type: "server_error",
        message: "TikTok server error",
        retryable: true,
        platformCode: String(code),
        platformMessage: message,
      };
      
    default:
      return {
        type: "unknown",
        message,
        retryable: true,
        platformCode: String(code),
      };
  }
}

// ==========================================
// Retry Logic Helpers
// ==========================================

/**
 * Calculate exponential backoff delay
 * @param attempt - Current attempt number (1-based)
 * @param baseDelayMs - Base delay in milliseconds
 * @param maxDelayMs - Maximum delay in milliseconds
 */
export function calculateBackoff(
  attempt: number,
  baseDelayMs = 1000,
  maxDelayMs = 300000 // 5 minutes
): number {
  // Exponential backoff with jitter
  const exponentialDelay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
  return Math.floor(exponentialDelay + jitter);
}

/**
 * Determine if an error should trigger a retry
 */
export function shouldRetry(error: PlatformError, currentAttempt: number, maxAttempts: number): boolean {
  // Never retry if already at max attempts
  if (currentAttempt >= maxAttempts) {
    return false;
  }
  
  // Only retry retryable errors
  return error.retryable;
}

/**
 * Format error for logging (redacts sensitive info)
 */
export function formatErrorForLog(error: PlatformError): Record<string, unknown> {
  return {
    type: error.type,
    message: error.message,
    retryable: error.retryable,
    platformCode: error.platformCode,
    // Truncate platform message to avoid log spam
    platformMessage: error.platformMessage?.slice(0, 200),
    traceId: error.traceId,
    retryAfter: error.retryAfter,
  };
}
