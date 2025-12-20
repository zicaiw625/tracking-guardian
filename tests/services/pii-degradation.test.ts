/**
 * P0-01: Protected Customer Data Degradation Tests
 * 
 * These tests verify that the system handles missing/null PII gracefully.
 * This is critical for compliance when Protected Customer Data scope is not granted.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ConversionData } from "../../app/types";

// Mock fetch for API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("P0-01: PII Degradation Handling", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("ConversionData with null PII", () => {
    it("should accept ConversionData with all PII fields as null", () => {
      const data: ConversionData = {
        orderId: "12345",
        orderNumber: "#1001",
        value: 99.99,
        currency: "USD",
        // All PII fields are null/undefined
        email: null,
        phone: null,
        firstName: null,
        lastName: null,
        city: null,
        state: null,
        country: null,
        zip: null,
      };

      // Type check passes - this is valid ConversionData
      expect(data.orderId).toBe("12345");
      expect(data.email).toBeNull();
      expect(data.phone).toBeNull();
    });

    it("should accept ConversionData with undefined PII fields", () => {
      const data: ConversionData = {
        orderId: "12345",
        orderNumber: null,
        value: 99.99,
        currency: "USD",
        // PII fields not provided at all
      };

      expect(data.orderId).toBe("12345");
      expect(data.email).toBeUndefined();
      expect(data.phone).toBeUndefined();
    });

    it("should accept ConversionData with partial PII", () => {
      const data: ConversionData = {
        orderId: "12345",
        orderNumber: "#1001",
        value: 99.99,
        currency: "USD",
        // Only email available, rest is null/undefined
        email: "test@example.com",
        phone: null,
      };

      expect(data.email).toBe("test@example.com");
      expect(data.phone).toBeNull();
      expect(data.firstName).toBeUndefined();
    });
  });

  describe("Meta CAPI with degraded PII", () => {
    it("should build user data with no PII without throwing", async () => {
      // Import the buildHashedUserData indirectly through the module
      const { sendConversionToMeta } = await import(
        "../../app/services/platforms/meta.server"
      );

      const conversionData: ConversionData = {
        orderId: "test-order-123",
        orderNumber: "#1001",
        value: 100.0,
        currency: "USD",
        // No PII
      };

      // Mock successful Meta API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ events_received: 1, fbtrace_id: "trace123" }),
      });

      const credentials = {
        pixelId: "1234567890123456",
        accessToken: "test-token",
      };

      // Should not throw even with no PII
      const result = await sendConversionToMeta(credentials, conversionData);
      expect(result.success).toBe(true);
    });

    it("should send conversion with partial PII", async () => {
      const { sendConversionToMeta } = await import(
        "../../app/services/platforms/meta.server"
      );

      const conversionData: ConversionData = {
        orderId: "test-order-456",
        orderNumber: "#1002",
        value: 150.0,
        currency: "USD",
        // Only email, no phone
        email: "customer@example.com",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ events_received: 1, fbtrace_id: "trace456" }),
      });

      const credentials = {
        pixelId: "1234567890123456",
        accessToken: "test-token",
      };

      const result = await sendConversionToMeta(credentials, conversionData);
      expect(result.success).toBe(true);

      // Verify the request was made with hashed email
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, requestInit] = mockFetch.mock.calls[0];
      const body = JSON.parse(requestInit.body);

      // Email should be hashed (64 char hex string)
      expect(body.data[0].user_data.em[0]).toMatch(/^[a-f0-9]{64}$/);
      // Phone should not be present
      expect(body.data[0].user_data.ph).toBeUndefined();
    });
  });

  describe("TikTok Events API with degraded PII", () => {
    it("should send conversion with no PII without throwing", async () => {
      const { sendConversionToTikTok } = await import(
        "../../app/services/platforms/tiktok.server"
      );

      const conversionData: ConversionData = {
        orderId: "tiktok-order-123",
        orderNumber: "#2001",
        value: 75.0,
        currency: "USD",
        // No PII
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, message: "OK" }),
      });

      const credentials = {
        pixelId: "ABCDEFGHIJ1234567890",
        accessToken: "test-tiktok-token",
      };

      // Should not throw even with no PII
      const result = await sendConversionToTikTok(credentials, conversionData);
      expect(result.success).toBe(true);
    });
  });

  describe("Error handling with degraded data", () => {
    it("should handle API errors gracefully with degraded PII", async () => {
      const { sendConversionToMeta } = await import(
        "../../app/services/platforms/meta.server"
      );

      const conversionData: ConversionData = {
        orderId: "error-test-order",
        orderNumber: null,
        value: 50.0,
        currency: "USD",
        // No PII
      };

      // Mock API error
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message: "Invalid parameter",
            type: "OAuthException",
            code: 100,
          },
        }),
      });

      const credentials = {
        pixelId: "1234567890123456",
        accessToken: "test-token",
      };

      // Should throw the API error, not a PII-related error
      await expect(
        sendConversionToMeta(credentials, conversionData)
      ).rejects.toThrow("Meta API error");
    });
  });

  describe("Required fields validation", () => {
    it("should require orderId even when PII is absent", () => {
      // TypeScript should enforce orderId is required
      const validData: ConversionData = {
        orderId: "required-order-id",
        orderNumber: null,
        value: 10.0,
        currency: "USD",
      };

      expect(validData.orderId).toBeDefined();
    });

    it("should require value and currency even when PII is absent", () => {
      const validData: ConversionData = {
        orderId: "order-123",
        orderNumber: null,
        value: 0, // Can be 0 but must be defined
        currency: "USD", // Must be defined
      };

      expect(validData.value).toBe(0);
      expect(validData.currency).toBe("USD");
    });
  });
});

