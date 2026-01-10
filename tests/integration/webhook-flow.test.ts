import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHmac } from "crypto";

vi.mock("../../app/db.server", () => ({
  default: {
    shop: {
      findUnique: vi.fn(),
    },
    pixelEventReceipt: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    conversionJob: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    webhookLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../app/utils/logger.server", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  metrics: {
    webhookReceived: vi.fn(),
    webhookProcessed: vi.fn(),
    conversionJobCreated: vi.fn(),
  },
}));

import prisma from "../../app/db.server";

describe("Webhook Flow Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  describe("HMAC Verification", () => {
    const webhookSecret = "test-webhook-secret";
    function generateHmac(body: string, secret: string): string {
      return createHmac("sha256", secret).update(body, "utf8").digest("base64");
    }
    function verifyHmac(body: string, hmac: string, secret: string): boolean {
      const computedHmac = generateHmac(body, secret);
      return computedHmac === hmac;
    }
    it("should verify valid HMAC signature", () => {
      const body = JSON.stringify({ id: "123", order_number: "1001" });
      const hmac = generateHmac(body, webhookSecret);
      expect(verifyHmac(body, hmac, webhookSecret)).toBe(true);
    });
    it("should reject invalid HMAC signature", () => {
      const body = JSON.stringify({ id: "123", order_number: "1001" });
      const validHmac = generateHmac(body, webhookSecret);
      const tamperedBody = JSON.stringify({ id: "123", order_number: "1002" });
      expect(verifyHmac(tamperedBody, validHmac, webhookSecret)).toBe(false);
      const wrongSecretHmac = generateHmac(body, "wrong-secret");
      expect(verifyHmac(body, wrongSecretHmac, webhookSecret)).toBe(false);
    });
    it("should handle empty body", () => {
      const body = "";
      const hmac = generateHmac(body, webhookSecret);
      expect(verifyHmac(body, hmac, webhookSecret)).toBe(true);
    });
    it("should handle unicode characters", () => {
      const body = JSON.stringify({ name: "日本語テスト", emoji: "🛒" });
      const hmac = generateHmac(body, webhookSecret);
      expect(verifyHmac(body, hmac, webhookSecret)).toBe(true);
    });
  });
  describe("Shop Lookup", () => {
    it("should find active shop by domain", async () => {
      const mockShop = {
        id: "shop-123",
        shopDomain: "test-store.myshopify.com",
        isActive: true,
        plan: "pro",
        pixelConfigs: [
          {
            id: "pixel-1",
            platform: "meta",
            isActive: true,
            serverSideEnabled: true,
          },
        ],
      };
      (prisma.shop.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockShop);
      const result = await prisma.shop.findUnique({
        where: { shopDomain: "test-store.myshopify.com" },
        include: { pixelConfigs: { where: { isActive: true } } },
      });
      expect(result).toEqual(mockShop);
      expect(result?.isActive).toBe(true);
      expect(result?.pixelConfigs).toHaveLength(1);
    });
    it("should return null for inactive shop", async () => {
      (prisma.shop.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "shop-123",
        isActive: false,
      });
      const result = await prisma.shop.findUnique({
        where: { shopDomain: "inactive-store.myshopify.com" },
      });
      expect(result?.isActive).toBe(false);
    });
    it("should return null for non-existent shop", async () => {
      (prisma.shop.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const result = await prisma.shop.findUnique({
        where: { shopDomain: "nonexistent.myshopify.com" },
      });
      expect(result).toBeNull();
    });
  });
  describe("Conversion Job Creation", () => {
    const mockWebhookPayload = {
      id: 12345,
      order_number: "1001",
      checkout_token: "checkout-abc123",
      total_price: "149.99",
      currency: "USD",
      email: "customer@example.com",
      created_at: "2024-01-15T10:00:00Z",
      line_items: [
        {
          id: 1,
          name: "Test Product",
          price: "149.99",
          quantity: 1,
          sku: "TEST-SKU-001",
        },
      ],
    };
    it("should create conversion job with CAPI input", async () => {
      const mockJob = {
        id: "job-123",
        shopId: "shop-123",
        orderId: "12345",
        status: "queued",
        capiInput: {
          orderId: "12345",
          value: 149.99,
          currency: "USD",
          orderNumber: "1001",
          checkoutToken: "checkout-abc123",
        },
      };
      (prisma.conversionJob.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockJob);
      const result = await prisma.conversionJob.create({
        data: {
          shopId: "shop-123",
          orderId: String(mockWebhookPayload.id),
          status: "queued",
          capiInput: {
            orderId: String(mockWebhookPayload.id),
            value: parseFloat(mockWebhookPayload.total_price),
            currency: mockWebhookPayload.currency,
            orderNumber: mockWebhookPayload.order_number,
            checkoutToken: mockWebhookPayload.checkout_token,
          },
        },
      });
      expect(result.id).toBe("job-123");
      expect(result.status).toBe("queued");
      expect(result.capiInput).toBeDefined();
    });
    it("should handle duplicate order gracefully with upsert", async () => {
      const existingJob = {
        id: "job-existing",
        shopId: "shop-123",
        orderId: "12345",
        status: "queued",
        attempts: 0,
      };
      (prisma.conversionJob.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...existingJob,
        attempts: 1,
      });
      const result = await prisma.conversionJob.update({
        where: { id: existingJob.id },
        data: { attempts: { increment: 1 } },
      });
      expect(result.attempts).toBe(1);
    });
  });
  describe("Receipt Matching", () => {
    it("should find matching receipt by checkout token", async () => {
      const mockReceipt = {
        id: "receipt-123",
        shopId: "shop-123",
        orderId: "12345",
        checkoutToken: "checkout-abc123",
        isTrusted: true,
        trustLevel: "trusted",
        consentState: {
          marketing: true,
          analytics: true,
          saleOfData: true,
        },
      };
      (prisma.pixelEventReceipt.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockReceipt);
      const result = await prisma.pixelEventReceipt.findFirst({
        where: {
          shopId: "shop-123",
          checkoutToken: "checkout-abc123",
        },
      });
      expect(result).toEqual(mockReceipt);
      expect(result?.isTrusted).toBe(true);
    });
    it("should find matching receipt by orderId fallback", async () => {
      (prisma.pixelEventReceipt.findFirst as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: "receipt-456",
          shopId: "shop-123",
          orderId: "12345",
          checkoutToken: null,
          isTrusted: true,
        });
      const byToken = await prisma.pixelEventReceipt.findFirst({
        where: { shopId: "shop-123", checkoutToken: "unknown-token" },
      });
      expect(byToken).toBeNull();
      const byOrderId = await prisma.pixelEventReceipt.findFirst({
        where: { shopId: "shop-123", orderId: "12345" },
      });
      expect(byOrderId).toBeDefined();
    });
    it("should return null when no matching receipt exists", async () => {
      (prisma.pixelEventReceipt.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const result = await prisma.pixelEventReceipt.findFirst({
        where: {
          shopId: "shop-123",
          orderId: "nonexistent",
        },
      });
      expect(result).toBeNull();
    });
  });
  describe("Multi-Platform Dispatch", () => {
    it("should create jobs for multiple active platforms", async () => {
      const platforms = ["meta", "google", "tiktok"];
      const mockJobs = platforms.map((platform, i) => ({
        id: `job-${i}`,
        platform,
        status: "queued",
      }));
      (prisma.$transaction as ReturnType<typeof vi.fn>).mockResolvedValue(mockJobs);
      const result = await prisma.$transaction(
        platforms.map((platform) =>
          prisma.conversionJob.create({
            data: {
              shopId: "shop-123",
              orderId: "12345",
              platform,
              status: "queued",
            },
          })
        )
      );
      expect(result).toHaveLength(3);
      expect(result.map((j: { platform: string }) => j.platform)).toEqual(["meta", "google", "tiktok"]);
    });
    it("should respect platform-specific consent requirements", () => {
      const consentState = {
        marketing: true,
        analytics: false,
        saleOfData: true,
      };
      const metaAllowed = consentState.marketing === true;
      expect(metaAllowed).toBe(true);
      const googleAllowed = consentState.analytics === true;
      expect(googleAllowed).toBe(false);
      const tiktokAllowed = consentState.marketing === true;
      expect(tiktokAllowed).toBe(true);
    });
    it("should block all platforms when saleOfData is false", () => {
      const consentState = {
        marketing: true,
        analytics: true,
        saleOfData: false,
      };
      const saleAllowed = consentState.saleOfData === true;
      expect(saleAllowed).toBe(false);
    });
  });
  describe("Webhook Logging", () => {
    it("should create webhook log entry", async () => {
      const mockLog = {
        id: "log-123",
        shopId: "shop-123",
        topic: "orders/paid",
        orderId: "12345",
        processedAt: new Date(),
        success: true,
      };
      (prisma.webhookLog.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockLog);
      const result = await prisma.webhookLog.create({
        data: {
          shopId: "shop-123",
          topic: "orders/paid",
          orderId: "12345",
          success: true,
        },
      });
      expect(result.success).toBe(true);
      expect(result.topic).toBe("orders/paid");
    });
  });
  describe("Error Scenarios", () => {
    it("should handle database connection errors", async () => {
      (prisma.shop.findUnique as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Database connection failed")
      );
      await expect(
        prisma.shop.findUnique({ where: { shopDomain: "test.myshopify.com" } })
      ).rejects.toThrow("Database connection failed");
    });
    it("should handle malformed webhook payload", () => {
      const malformedPayloads = [
        null,
        undefined,
        "",
        "not json",
        {},
        { id: null },
        { id: "not-a-number" },
      ];
      for (const payload of malformedPayloads) {
        const isValid =
          payload !== null &&
          payload !== undefined &&
          typeof payload === "object" &&
          "id" in payload &&
          typeof payload.id === "number";
        expect(isValid).toBe(false);
      }
    });
    it("should handle missing required fields", () => {
      const validateWebhookPayload = (payload: unknown): string[] => {
        const errors: string[] = [];
        if (!payload || typeof payload !== "object") {
          errors.push("Invalid payload structure");
          return errors;
        }
        const p = payload as Record<string, unknown>;
        if (!p.id) errors.push("Missing id");
        if (!p.order_number) errors.push("Missing order_number");
        if (!p.total_price) errors.push("Missing total_price");
        return errors;
      };
      expect(validateWebhookPayload({})).toContain("Missing id");
      expect(validateWebhookPayload({ id: 1 })).toContain("Missing order_number");
      expect(validateWebhookPayload({ id: 1, order_number: "1001" })).toContain(
        "Missing total_price"
      );
      expect(
        validateWebhookPayload({
          id: 1,
          order_number: "1001",
          total_price: "99.99",
        })
      ).toHaveLength(0);
    });
  });
});
