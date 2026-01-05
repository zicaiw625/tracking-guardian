

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";
import { createMockRequest } from "../setup";

vi.mock("../../app/utils/logger.server", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../app/utils/responses", () => ({
  unauthorizedResponse: vi.fn((msg) => new Response(msg, { status: 401 })),
  serviceUnavailableResponse: vi.fn((msg) => new Response(msg, { status: 503 })),
}));

import {
  validateCronAuth,
  verifyReplayProtection,
  isSecretRotationActive,
  getRotationStatus,
} from "../../app/cron/auth";
import { logger } from "../../app/utils/logger.server";

describe("Cron Authentication", () => {
  const originalEnv = process.env;
  const testSecret = "test-cron-secret-12345678901234567890";

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.CRON_SECRET = testSecret;
    process.env.CRON_SECRET_PREVIOUS = "";
    process.env.NODE_ENV = "production";
    process.env.CRON_STRICT_REPLAY = "true";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function createAuthenticatedRequest(
    secret: string = testSecret,
    overrideHeaders?: Record<string, string>
  ) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", secret).update(timestamp).digest("hex");

    return createMockRequest("https://example.com/cron", {
      headers: {
        Authorization: `Bearer ${secret}`,
        "X-Cron-Timestamp": timestamp,
        "X-Cron-Signature": signature,
        ...overrideHeaders,
      },
    });
  }

  describe("validateCronAuth", () => {
    it("should return null for valid Bearer token with signature", () => {
      const request = createAuthenticatedRequest();
      const result = validateCronAuth(request);
      expect(result).toBeNull();
    });

    it("should return error for invalid Bearer token", () => {
      const request = createAuthenticatedRequest("wrong-secret");
      const result = validateCronAuth(request);
      expect(result).toBeInstanceOf(Response);
      expect(result?.status).toBe(401);
    });

    it("should return error for missing Bearer token", () => {
      const request = createMockRequest("https://example.com/cron");
      const result = validateCronAuth(request);
      expect(result).toBeInstanceOf(Response);
      expect(result?.status).toBe(401);
    });

    it("should allow unauthenticated access in development when CRON_SECRET not set", () => {
      process.env.CRON_SECRET = "";
      process.env.NODE_ENV = "development";

      const request = createMockRequest("https://example.com/cron");
      const result = validateCronAuth(request);
      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("should return 503 when CRON_SECRET not set in production", () => {
      process.env.CRON_SECRET = "";
      process.env.NODE_ENV = "production";

      const request = createMockRequest("https://example.com/cron");
      const result = validateCronAuth(request);
      expect(result).toBeInstanceOf(Response);
      expect(result?.status).toBe(503);
    });

    it("should warn if CRON_SECRET is too short", () => {
      const shortSecret = "short";
      process.env.CRON_SECRET = shortSecret;

      process.env.CRON_STRICT_REPLAY = "false";

      const request = createMockRequest("https://example.com/cron", {
        headers: {
          Authorization: `Bearer ${shortSecret}`,
        },
      });

      validateCronAuth(request);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("shorter than recommended")
      );
    });
  });

  describe("verifyReplayProtection", () => {
    const cronSecret = "test-secret-for-hmac";

    it("should accept request with valid timestamp and signature in production", () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac("sha256", cronSecret).update(timestamp).digest("hex");

      const request = createMockRequest("https://example.com/cron", {
        headers: {
          "X-Cron-Timestamp": timestamp,
          "X-Cron-Signature": signature,
        },
      });

      const result = verifyReplayProtection(request, cronSecret);
      expect(result.valid).toBe(true);
    });

    it("should reject request with expired timestamp", () => {
      const oldTimestamp = String(Math.floor(Date.now() / 1000) - 600);
      const signature = createHmac("sha256", cronSecret).update(oldTimestamp).digest("hex");

      const request = createMockRequest("https://example.com/cron", {
        headers: {
          "X-Cron-Timestamp": oldTimestamp,
          "X-Cron-Signature": signature,
        },
      });

      const result = verifyReplayProtection(request, cronSecret);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("out of range");
    });

    it("should reject request with future timestamp", () => {
      const futureTimestamp = String(Math.floor(Date.now() / 1000) + 600);
      const signature = createHmac("sha256", cronSecret).update(futureTimestamp).digest("hex");

      const request = createMockRequest("https://example.com/cron", {
        headers: {
          "X-Cron-Timestamp": futureTimestamp,
          "X-Cron-Signature": signature,
        },
      });

      const result = verifyReplayProtection(request, cronSecret);
      expect(result.valid).toBe(false);
    });

    it("should reject request with invalid timestamp format", () => {
      const request = createMockRequest("https://example.com/cron", {
        headers: {
          "X-Cron-Timestamp": "not-a-number",
        },
      });

      const result = verifyReplayProtection(request, cronSecret);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid timestamp format");
    });

    it("should allow missing timestamp in development", () => {
      process.env.NODE_ENV = "development";

      const request = createMockRequest("https://example.com/cron");

      const result = verifyReplayProtection(request, cronSecret);
      expect(result.valid).toBe(true);
    });

    it("should reject request with timestamp but missing signature in production", () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const request = createMockRequest("https://example.com/cron", {
        headers: {
          "X-Cron-Timestamp": timestamp,
        },
      });

      const result = verifyReplayProtection(request, cronSecret);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Missing signature");
    });

    it("should accept valid HMAC signature", () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac("sha256", cronSecret).update(timestamp).digest("hex");

      const request = createMockRequest("https://example.com/cron", {
        headers: {
          "X-Cron-Timestamp": timestamp,
          "X-Cron-Signature": signature,
        },
      });

      const result = verifyReplayProtection(request, cronSecret);
      expect(result.valid).toBe(true);
    });

    it("should reject invalid HMAC signature", () => {
      const timestamp = String(Math.floor(Date.now() / 1000));

      const request = createMockRequest("https://example.com/cron", {
        headers: {
          "X-Cron-Timestamp": timestamp,
          "X-Cron-Signature": "invalidsignature",
        },
      });

      const result = verifyReplayProtection(request, cronSecret);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid signature");
    });
  });

  describe("P1-5: Secret Rotation", () => {
    const newSecret = "new-cron-secret-12345678901234567890";
    const previousSecret = "old-cron-secret-12345678901234567890";

    it("should accept authentication with primary secret", () => {
      process.env.CRON_SECRET = newSecret;
      process.env.CRON_SECRET_PREVIOUS = previousSecret;

      const request = createAuthenticatedRequest(newSecret);
      const result = validateCronAuth(request);
      expect(result).toBeNull();
    });

    it("should accept authentication with previous secret during rotation", () => {
      process.env.CRON_SECRET = newSecret;
      process.env.CRON_SECRET_PREVIOUS = previousSecret;

      const request = createAuthenticatedRequest(previousSecret);
      const result = validateCronAuth(request);
      expect(result).toBeNull();

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("CRON_SECRET_PREVIOUS")
      );
    });

    it("should reject invalid secret even when rotation is active", () => {
      process.env.CRON_SECRET = newSecret;
      process.env.CRON_SECRET_PREVIOUS = previousSecret;

      const request = createAuthenticatedRequest("completely-wrong-secret");
      const result = validateCronAuth(request);
      expect(result).toBeInstanceOf(Response);
      expect(result?.status).toBe(401);
    });

    it("should report rotation is active when both secrets are set", () => {
      process.env.CRON_SECRET = newSecret;
      process.env.CRON_SECRET_PREVIOUS = previousSecret;

      expect(isSecretRotationActive()).toBe(true);
    });

    it("should report rotation is not active when only primary secret is set", () => {
      process.env.CRON_SECRET = newSecret;
      process.env.CRON_SECRET_PREVIOUS = "";

      expect(isSecretRotationActive()).toBe(false);
    });

    it("should provide correct rotation status", () => {
      process.env.CRON_SECRET = newSecret;
      process.env.CRON_SECRET_PREVIOUS = previousSecret;

      const status = getRotationStatus();
      expect(status.rotationActive).toBe(true);
      expect(status.hasPrimarySecret).toBe(true);
      expect(status.hasPreviousSecret).toBe(true);
      expect(status.primarySecretLength).toBe(newSecret.length);
      expect(status.previousSecretLength).toBe(previousSecret.length);
    });
  });
});
