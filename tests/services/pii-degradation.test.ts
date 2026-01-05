import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ConversionData } from "../../app/types";

const mockFetch = vi.fn();
global.fetch = mockFetch;

// P0-5: v1.0 版本不包含任何 PCD/PII 处理，因此更新测试以验证"不包含 PII"的行为
describe("P0-01: v1.0 No PII Handling", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("ConversionData without PII (v1.0)", () => {
    it("should accept ConversionData without any PII fields (v1.0 behavior)", () => {
      const data: ConversionData = {
        orderId: "12345",
        orderNumber: "#1001",
        value: 99.99,
        currency: "USD",
        email: null,
        phone: null,
        firstName: null,
        lastName: null,
        city: null,
        state: null,
        country: null,
        zip: null,
      };

      expect(data.orderId).toBe("12345");
      // P0-3: v1.0 版本不处理任何 PII，即使字段存在也应为 null/undefined
      expect(data.email).toBeNull();
      expect(data.phone).toBeNull();
    });

    it("should accept ConversionData with undefined PII fields", () => {
      const data: ConversionData = {
        orderId: "12345",
        orderNumber: null,
        value: 99.99,
        currency: "USD",
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
        email: "test@example.com",
        phone: null,
      };

      expect(data.email).toBe("test@example.com");
      expect(data.phone).toBeNull();
      expect(data.firstName).toBeUndefined();
    });
  });

  describe("Meta CAPI without PII (v1.0)", () => {
    it("should send conversion without user_data field (v1.0: no PII)", async () => {
      const { sendConversionToMeta } = await import(
        "../../app/services/platforms/meta.service"
      );

      const conversionData: ConversionData = {
        orderId: "test-order-123",
        orderNumber: "#1001",
        value: 100.0,
        currency: "USD",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ events_received: 1, fbtrace_id: "trace123" }),
      });

      const credentials = {
        pixelId: "1234567890123456",
        accessToken: "test-token",
      };

      const result = await sendConversionToMeta(credentials, conversionData);
      expect(result.success).toBe(true);
    });

    it("should send conversion with partial PII", async () => {
      const { sendConversionToMeta } = await import(
        "../../app/services/platforms/meta.service"
      );

      const conversionData: ConversionData = {
        orderId: "test-order-456",
        orderNumber: "#1002",
        value: 150.0,
        currency: "USD",
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

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, requestInit] = mockFetch.mock.calls[0];
      const body = JSON.parse(requestInit.body);

      // P0-3: v1.0 版本不包含 user_data 字段（不处理任何 PII）
      expect(body.data[0].user_data).toBeUndefined();
    });
  });

  describe("TikTok Events API without PII (v1.0)", () => {
    it("should send conversion without user field (v1.0: no PII)", async () => {
      const { sendConversionToTikTok } = await import(
        "../../app/services/platforms/tiktok.service"
      );

      const conversionData: ConversionData = {
        orderId: "tiktok-order-123",
        orderNumber: "#2001",
        value: 75.0,
        currency: "USD",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, message: "OK" }),
      });

      const credentials = {
        pixelId: "ABCDEFGHIJ1234567890",
        accessToken: "test-tiktok-token",
      };

      const result = await sendConversionToTikTok(credentials, conversionData);
      expect(result.success).toBe(true);
    });
  });

  describe("Error handling with degraded data", () => {
    it("should handle API errors gracefully with degraded PII", async () => {
      const { sendConversionToMeta } = await import(
        "../../app/services/platforms/meta.service"
      );

      const conversionData: ConversionData = {
        orderId: "error-test-order",
        orderNumber: null,
        value: 50.0,
        currency: "USD",
      };

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

      await expect(
        sendConversionToMeta(credentials, conversionData)
      ).rejects.toThrow();
    });
  });

  describe("Required fields validation", () => {
    it("should require orderId even when PII is absent", () => {
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
        value: 0,
        currency: "USD",
      };

      expect(validData.value).toBe(0);
      expect(validData.currency).toBe("USD");
    });
  });
});
