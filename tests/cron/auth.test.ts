/**
 * Cron Authentication Tests
 *
 * Tests for cron endpoint authentication and replay protection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest } from "../setup";

// Mock dependencies
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

import { validateCronAuth, verifyReplayProtection } from "../../app/cron/auth";
import { logger } from "../../app/utils/logger.server";

describe("Cron Authentication", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.CRON_SECRET = "test-cron-secret-12345678901234567890";
    process.env.NODE_ENV = "production";
    process.env.CRON_STRICT_REPLAY = "true";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("validateCronAuth", () => {
    it("should return null for valid Bearer token", () => {
      const request = createMockRequest("https://app.example.com/api/cron", {
        headers: {
          Authorization: "Bearer test-cron-secret-12345678901234567890",
          "X-Cron-Timestamp": String(Math.floor(Date.now() / 1000)),
        },
      });

      const result = validateCronAuth(request);
      expect(result).toBeNull();
    });

    it("should return error for invalid Bearer token", () => {
      const request = createMockRequest("https://app.example.com/api/cron", {
        headers: {
          Authorization: "Bearer wrong-secret",
        },
      });

      const result = validateCronAuth(request);
      expect(result).toBeInstanceOf(Response);
      expect(result?.status).toBe(401);
    });

    it("should return error for missing Bearer token", () => {
      const request = createMockRequest("https://app.example.com/api/cron");

      const result = validateCronAuth(request);
      expect(result).toBeInstanceOf(Response);
      expect(result?.status).toBe(401);
    });

    it("should allow unauthenticated access in development when CRON_SECRET not set", () => {
      process.env.CRON_SECRET = "";
      process.env.NODE_ENV = "development";

      const request = createMockRequest("https://app.example.com/api/cron");

      const result = validateCronAuth(request);
      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("should return 503 when CRON_SECRET not set in production", () => {
      process.env.CRON_SECRET = "";
      process.env.NODE_ENV = "production";

      const request = createMockRequest("https://app.example.com/api/cron");

      const result = validateCronAuth(request);
      expect(result).toBeInstanceOf(Response);
      expect(result?.status).toBe(503);
    });

    it("should warn if CRON_SECRET is too short", () => {
      process.env.CRON_SECRET = "short";

      const request = createMockRequest("https://app.example.com/api/cron", {
        headers: {
          Authorization: "Bearer short",
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

    it("should accept request with valid timestamp", () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const request = createMockRequest("https://app.example.com/api/cron", {
        headers: {
          "X-Cron-Timestamp": String(timestamp),
        },
      });

      const result = verifyReplayProtection(request, cronSecret);
      expect(result.valid).toBe(true);
    });

    it("should reject request with expired timestamp", () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      const request = createMockRequest("https://app.example.com/api/cron", {
        headers: {
          "X-Cron-Timestamp": String(oldTimestamp),
        },
      });

      const result = verifyReplayProtection(request, cronSecret);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("out of range");
    });

    it("should reject request with future timestamp", () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 600; // 10 minutes in future
      const request = createMockRequest("https://app.example.com/api/cron", {
        headers: {
          "X-Cron-Timestamp": String(futureTimestamp),
        },
      });

      const result = verifyReplayProtection(request, cronSecret);
      expect(result.valid).toBe(false);
    });

    it("should reject request with invalid timestamp format", () => {
      const request = createMockRequest("https://app.example.com/api/cron", {
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

      const request = createMockRequest("https://app.example.com/api/cron");

      const result = verifyReplayProtection(request, cronSecret);
      expect(result.valid).toBe(true);
    });

    it("should accept valid HMAC signature", async () => {
      const { createHmac } = await import("crypto");
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac("sha256", cronSecret).update(timestamp).digest("hex");

      const request = createMockRequest("https://app.example.com/api/cron", {
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

      const request = createMockRequest("https://app.example.com/api/cron", {
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
});

