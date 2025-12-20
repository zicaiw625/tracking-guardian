export type PlatformErrorType = 
  | "auth_error"           
  | "invalid_config"       
  | "rate_limited"         
  | "server_error"         
  | "timeout"              
  | "network_error"        
  | "validation_error"     
  | "quota_exceeded"       
  | "unknown";             

export interface PlatformError {
  type: PlatformErrorType;
  message: string;
  retryable: boolean;
  platformCode?: string;      
  platformMessage?: string;   
  traceId?: string;           
  retryAfter?: number;        
}

export interface PlatformResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: PlatformError;
}

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
        retryAfter: 60, 
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

export function classifyJsError(error: Error): PlatformError {
  const message = error.message.toLowerCase();

  if (message.includes("timeout") || message.includes("aborted") || error.name === "AbortError") {
    return {
      type: "timeout",
      message: "Request timeout",
      retryable: true,
    };
  }

  if (message.includes("network") || message.includes("fetch") || message.includes("econnrefused")) {
    return {
      type: "network_error",
      message: "Network error",
      retryable: true,
    };
  }

  return {
    type: "unknown",
    message: error.message,
    retryable: true,
  };
}

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

  switch (true) {
    case code === 190: 
    case code === 102: 
      return {
        type: "auth_error",
        message: "Access token expired or invalid",
        retryable: false,
        platformCode: String(code),
        platformMessage: message,
        traceId,
      };
      
    case code === 100: 
    case code === 803: 
      return {
        type: "invalid_config",
        message: "Invalid Pixel ID or parameter",
        retryable: false,
        platformCode: String(code),
        platformMessage: message,
        traceId,
      };
      
    case code === 4 || code === 17: 
      return {
        type: "rate_limited",
        message: "Meta API rate limit exceeded",
        retryable: true,
        platformCode: String(code),
        platformMessage: message,
        traceId,
        retryAfter: 60,
      };
      
    case code === 1 || code === 2: 
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

export function parseTikTokError(response: unknown): PlatformError {
  const data = response as { code?: number; message?: string };
  const code = data?.code;
  const message = data?.message || "Unknown error";

  switch (true) {
    case code === 40001: 
    case code === 40002: 
      return {
        type: "auth_error",
        message: "Access token invalid or expired",
        retryable: false,
        platformCode: String(code),
        platformMessage: message,
      };
      
    case code === 40100: 
      return {
        type: "invalid_config",
        message: "Invalid Pixel ID",
        retryable: false,
        platformCode: String(code),
        platformMessage: message,
      };
      
    case code === 40300: 
      return {
        type: "validation_error",
        message: "Invalid event data",
        retryable: false,
        platformCode: String(code),
        platformMessage: message,
      };
      
    case code === 42900: 
      return {
        type: "rate_limited",
        message: "TikTok API rate limit exceeded",
        retryable: true,
        platformCode: String(code),
        platformMessage: message,
        retryAfter: 60,
      };
      
    case code && code >= 50000: 
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

export function calculateBackoff(
  attempt: number,
  baseDelayMs = 1000,
  maxDelayMs = 300000 
): number {
  const exponentialDelay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
  const jitter = Math.random() * 0.3 * exponentialDelay; 
  return Math.floor(exponentialDelay + jitter);
}

export function shouldRetry(error: PlatformError, currentAttempt: number, maxAttempts: number): boolean {
  if (currentAttempt >= maxAttempts) {
    return false;
  }

  return error.retryable;
}

export function formatErrorForLog(error: PlatformError): Record<string, unknown> {
  return {
    type: error.type,
    message: error.message,
    retryable: error.retryable,
    platformCode: error.platformCode,
    platformMessage: error.platformMessage?.slice(0, 200),
    traceId: error.traceId,
    retryAfter: error.retryAfter,
  };
}
