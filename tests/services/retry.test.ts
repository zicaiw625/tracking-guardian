import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  platformErrorToFailureReason,
  classifyFailureReason,
  shouldNotifyImmediately,
  shouldRetryFromPlatformError,
  getRetryDelay,
  type FailureReason,
} from "../../app/services/retry.server";
import type { PlatformError } from "../../app/services/platforms/base.server";

describe("Retry Service", () => {
  describe("platformErrorToFailureReason", () => {
    it("should map auth_error to token_expired", () => {
      const error: PlatformError = {
        type: "auth_error",
        message: "Invalid token",
        isRetryable: false,
      };
      expect(platformErrorToFailureReason(error)).toBe("token_expired");
    });

    it("should map rate_limited to rate_limited", () => {
      const error: PlatformError = {
        type: "rate_limited",
        message: "Too many requests",
        isRetryable: true,
        retryAfter: 60,
      };
      expect(platformErrorToFailureReason(error)).toBe("rate_limited");
    });

    it("should map server_error to platform_error", () => {
      const error: PlatformError = {
        type: "server_error",
        message: "Internal error",
        isRetryable: true,
      };
      expect(platformErrorToFailureReason(error)).toBe("platform_error");
    });

    it("should map validation_error to validation_error", () => {
      const error: PlatformError = {
        type: "validation_error",
        message: "Invalid payload",
        isRetryable: false,
      };
      expect(platformErrorToFailureReason(error)).toBe("validation_error");
    });

    it("should map timeout to network_error", () => {
      const error: PlatformError = {
        type: "timeout",
        message: "Request timeout",
        isRetryable: true,
      };
      expect(platformErrorToFailureReason(error)).toBe("network_error");
    });

    it("should map network_error to network_error", () => {
      const error: PlatformError = {
        type: "network_error",
        message: "Connection failed",
        isRetryable: true,
      };
      expect(platformErrorToFailureReason(error)).toBe("network_error");
    });

    it("should map invalid_config to config_error", () => {
      const error: PlatformError = {
        type: "invalid_config",
        message: "Missing API key",
        isRetryable: false,
      };
      expect(platformErrorToFailureReason(error)).toBe("config_error");
    });

    it("should map quota_exceeded to config_error", () => {
      const error: PlatformError = {
        type: "quota_exceeded",
        message: "Quota exceeded",
        isRetryable: false,
      };
      expect(platformErrorToFailureReason(error)).toBe("config_error");
    });

    it("should map unknown to unknown", () => {
      const error: PlatformError = {
        type: "unknown",
        message: "Unknown error",
        isRetryable: false,
      };
      expect(platformErrorToFailureReason(error)).toBe("unknown");
    });
  });

  describe("classifyFailureReason", () => {
    it("should return unknown for null message", () => {
      expect(classifyFailureReason(null)).toBe("unknown");
    });

    it("should classify 401 as token_expired", () => {
      expect(classifyFailureReason("HTTP 401 Unauthorized")).toBe("token_expired");
      expect(classifyFailureReason("401 error")).toBe("token_expired");
    });

    it("should classify unauthorized as token_expired", () => {
      expect(classifyFailureReason("Unauthorized access")).toBe("token_expired");
      expect(classifyFailureReason("Token expired")).toBe("token_expired");
    });

    it("should classify 429 as rate_limited", () => {
      expect(classifyFailureReason("HTTP 429 Too Many Requests")).toBe("rate_limited");
      expect(classifyFailureReason("Rate limit exceeded")).toBe("rate_limited");
    });

    it("should classify 5xx as platform_error", () => {
      expect(classifyFailureReason("HTTP 500 Internal Server Error")).toBe("platform_error");
      expect(classifyFailureReason("502 Bad Gateway")).toBe("platform_error");
      expect(classifyFailureReason("503 Service Unavailable")).toBe("platform_error");
      expect(classifyFailureReason("504 Gateway Timeout")).toBe("platform_error");
    });

    it("should classify timeout as network_error", () => {
      expect(classifyFailureReason("Request timeout after 30s")).toBe("network_error");
      expect(classifyFailureReason("Connection timeout")).toBe("network_error");
    });

    it("should classify network issues as network_error", () => {
      expect(classifyFailureReason("Network error occurred")).toBe("network_error");
      expect(classifyFailureReason("ECONNREFUSED")).toBe("network_error");
      expect(classifyFailureReason("ENOTFOUND")).toBe("network_error");
      expect(classifyFailureReason("Fetch failed")).toBe("network_error");
    });

    it("should classify 400 as validation_error", () => {
      expect(classifyFailureReason("HTTP 400 Bad Request")).toBe("validation_error");
      expect(classifyFailureReason("Invalid parameter")).toBe("validation_error");
    });

    it("should classify credential issues as config_error", () => {
      expect(classifyFailureReason("Credential not found")).toBe("config_error");
      expect(classifyFailureReason("Failed to decrypt")).toBe("config_error");
      expect(classifyFailureReason("API secret not configured")).toBe("config_error");
    });

    it("should return unknown for unrecognized errors", () => {
      expect(classifyFailureReason("Some random error")).toBe("unknown");
      expect(classifyFailureReason("")).toBe("unknown");
    });
  });

  describe("shouldNotifyImmediately", () => {
    it("should return true for token_expired", () => {
      expect(shouldNotifyImmediately("token_expired")).toBe(true);
    });

    it("should return true for config_error", () => {
      expect(shouldNotifyImmediately("config_error")).toBe(true);
    });

    it("should return false for other failure reasons", () => {
      expect(shouldNotifyImmediately("rate_limited")).toBe(false);
      expect(shouldNotifyImmediately("platform_error")).toBe(false);
      expect(shouldNotifyImmediately("network_error")).toBe(false);
      expect(shouldNotifyImmediately("validation_error")).toBe(false);
      expect(shouldNotifyImmediately("unknown")).toBe(false);
    });
  });

  describe("getRetryDelay", () => {
    it("should use retryAfter when provided", () => {
      const error: PlatformError = {
        type: "rate_limited",
        message: "Rate limited",
        isRetryable: true,
        retryAfter: 120,
      };

      const delay = getRetryDelay(error, 1);
      expect(delay).toBe(120000);
    });

    it("should calculate exponential backoff when no retryAfter", () => {
      const error: PlatformError = {
        type: "server_error",
        message: "Server error",
        isRetryable: true,
      };

      const delay1 = getRetryDelay(error, 1);
      const delay2 = getRetryDelay(error, 2);
      const delay3 = getRetryDelay(error, 3);

      expect(delay2).toBeGreaterThan(delay1);
      expect(delay3).toBeGreaterThan(delay2);
    });
  });

  describe("shouldRetryFromPlatformError", () => {
    it("should not retry non-retryable errors", () => {
      const error: PlatformError = {
        type: "auth_error",
        message: "Invalid token",
        isRetryable: false,
      };

      expect(shouldRetryFromPlatformError(error, 1, 5)).toBe(false);
    });

    it("should not retry when max attempts reached", () => {
      const error: PlatformError = {
        type: "server_error",
        message: "Server error",
        isRetryable: true,
      };

      expect(shouldRetryFromPlatformError(error, 5, 5)).toBe(false);
      expect(shouldRetryFromPlatformError(error, 6, 5)).toBe(false);
    });

    it("should retry retryable errors within attempt limit", () => {
      const error: PlatformError = {
        type: "server_error",
        message: "Server error",
        isRetryable: true,
      };

      expect(shouldRetryFromPlatformError(error, 1, 5)).toBe(true);
      expect(shouldRetryFromPlatformError(error, 4, 5)).toBe(true);
    });
  });
});
