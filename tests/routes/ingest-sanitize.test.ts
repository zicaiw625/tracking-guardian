import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../app/db.server", () => ({
  default: {
    shop: {
      findFirst: vi.fn(),
    },
    pixelEventReceipt: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
    eventNonce: {
      create: vi.fn(),
    },
    verificationRun: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("../../app/utils/redis-client", () => ({
  getRedisClient: vi.fn(),
}));

vi.mock("../../app/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  metrics: {
    pixelEvent: vi.fn(),
    pixelRejection: vi.fn(),
    silentDrop: vi.fn(),
    trustVerification: vi.fn(),
  },
}));

import prisma from "../../app/db.server";
import { generateOrderMatchKey , createEventNonce } from "../../app/lib/pixel-events/receipt-handler";
import { validateRequest } from "../../app/lib/pixel-events/validation";
import { getRedisClient } from "../../app/utils/redis-client";

describe("P0 Fix: checkoutToken and nonce preservation after sanitizePII removal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("checkoutToken fallback when orderId is null", () => {
    it("should preserve checkoutToken after validation and use it as fallback", () => {
      const eventPayload = {
        eventName: "checkout_completed",
        timestamp: Date.now(),
        shopDomain: "test-shop.myshopify.com",
        data: {
          orderId: null,
          checkoutToken: "checkout_token_abc123",
          value: 99.99,
          currency: "USD",
        },
      };

      const validationResult = validateRequest(eventPayload);
      expect(validationResult.valid).toBe(true);
      if (validationResult.valid) {
        expect(validationResult.payload.data.checkoutToken).toBe("checkout_token_abc123");
        expect(validationResult.payload.data.orderId).toBeNull();

        const matchKeyResult = generateOrderMatchKey(
          validationResult.payload.data.orderId,
          validationResult.payload.data.checkoutToken,
          "test-shop.myshopify.com"
        );

        expect(matchKeyResult.usedCheckoutTokenAsFallback).toBe(true);
        expect(matchKeyResult.orderId).toBeTruthy();
        expect(matchKeyResult.orderId).toContain("checkout");
        expect(matchKeyResult.altOrderKey).toBeNull();
      }
    });

    it("should generate eventId using checkoutToken when orderId is null", () => {
      const eventPayload = {
        eventName: "checkout_completed",
        timestamp: Date.now(),
        shopDomain: "test-shop.myshopify.com",
        data: {
          orderId: null,
          checkoutToken: "checkout_token_xyz789",
          value: 50.00,
          currency: "USD",
        },
      };

      const validationResult = validateRequest(eventPayload);
      expect(validationResult.valid).toBe(true);
      if (validationResult.valid) {
        const payload = validationResult.payload;
        expect(payload.data.checkoutToken).toBe("checkout_token_xyz789");

        const matchKeyResult = generateOrderMatchKey(
          payload.data.orderId,
          payload.data.checkoutToken,
          payload.shopDomain
        );

        expect(matchKeyResult.usedCheckoutTokenAsFallback).toBe(true);
        expect(matchKeyResult.orderId).toBeTruthy();
        expect(matchKeyResult.altOrderKey).toBeNull();
      }
    });
  });

  describe("dual key when both orderId and checkoutToken exist", () => {
    it("should set orderId as primary key and altOrderKey as checkout hash", () => {
      const matchKeyResult = generateOrderMatchKey(
        "gid://shopify/Order/99999",
        "token_dual_key_abc",
        "test-shop.myshopify.com"
      );
      expect(matchKeyResult.usedCheckoutTokenAsFallback).toBe(false);
      expect(matchKeyResult.orderId).toBe("99999");
      expect(matchKeyResult.altOrderKey).toBeTruthy();
      expect(matchKeyResult.altOrderKey).toMatch(/^checkout_[a-f0-9]+$/);
    });

    it("should have altOrderKey null when only orderId", () => {
      const matchKeyResult = generateOrderMatchKey("12345", null, "test-shop.myshopify.com");
      expect(matchKeyResult.orderId).toBe("12345");
      expect(matchKeyResult.altOrderKey).toBeNull();
      expect(matchKeyResult.usedCheckoutTokenAsFallback).toBe(false);
    });
  });

  describe("nonce preservation and replay protection", () => {
    it("should preserve nonce after validation", () => {
      const eventPayload = {
        eventName: "checkout_completed",
        timestamp: Date.now(),
        shopDomain: "test-shop.myshopify.com",
        nonce: "unique-nonce-12345",
        data: {
          orderId: "gid://shopify/Order/12345",
          value: 99.99,
          currency: "USD",
        },
      };

      const validationResult = validateRequest(eventPayload);
      expect(validationResult.valid).toBe(true);
      if (validationResult.valid) {
        expect(validationResult.payload.nonce).toBe("unique-nonce-12345");
      }
    });

    it("should detect replay when same nonce is used twice", async () => {
      const shopId = "shop-123";
      const orderId = "order-123";
      const timestamp = Date.now();
      const nonce = "replay-test-nonce-67890";
      const eventType = "purchase";

      const mockRedis = {
        setNX: vi.fn(),
      };
      vi.mocked(getRedisClient).mockResolvedValue(mockRedis as any);

      mockRedis.setNX.mockResolvedValueOnce(true);
      mockRedis.setNX.mockResolvedValueOnce(false);

      const firstResult = await createEventNonce(shopId, orderId, timestamp, nonce, eventType);
      expect(firstResult.isReplay).toBe(false);

      const secondResult = await createEventNonce(shopId, orderId, timestamp, nonce, eventType);
      expect(secondResult.isReplay).toBe(true);

      expect(mockRedis.setNX).toHaveBeenCalledTimes(2);
      const expectedKey = `tg:nonce:${shopId}:${eventType}:${nonce}`;
      expect(mockRedis.setNX).toHaveBeenCalledWith(expectedKey, "1", expect.any(Number));
    });

    it("should fallback to database when Redis fails and detect replay via unique constraint", async () => {
      const shopId = "shop-123";
      const orderId = "order-123";
      const timestamp = Date.now();
      const nonce = "db-fallback-nonce-11111";
      const eventType = "purchase";

      const mockRedis = {
        setNX: vi.fn().mockRejectedValue(new Error("Redis unavailable")),
      };
      vi.mocked(getRedisClient).mockResolvedValue(mockRedis as any);

      vi.mocked(prisma.eventNonce.create).mockResolvedValueOnce({
        id: "nonce-1",
        shopId,
        nonce,
        eventType,
        expiresAt: new Date(timestamp + 3600000),
        createdAt: new Date(),
      } as any);

      vi.mocked(prisma.eventNonce.create).mockRejectedValueOnce({
        code: "P2002",
      } as any);

      const firstResult = await createEventNonce(shopId, orderId, timestamp, nonce, eventType);
      expect(firstResult.isReplay).toBe(false);

      const secondResult = await createEventNonce(shopId, orderId, timestamp, nonce, eventType);
      expect(secondResult.isReplay).toBe(true);

      expect(prisma.eventNonce.create).toHaveBeenCalledTimes(2);
    });

    it("should allow different nonces for same order", async () => {
      const shopId = "shop-123";
      const orderId = "order-123";
      const timestamp = Date.now();
      const eventType = "purchase";

      const mockRedis = {
        setNX: vi.fn().mockResolvedValue(true),
      };
      vi.mocked(getRedisClient).mockResolvedValue(mockRedis as any);

      const firstResult = await createEventNonce(shopId, orderId, timestamp, "nonce-1", eventType);
      expect(firstResult.isReplay).toBe(false);

      const secondResult = await createEventNonce(shopId, orderId, timestamp, "nonce-2", eventType);
      expect(secondResult.isReplay).toBe(false);

      expect(mockRedis.setNX).toHaveBeenCalledTimes(2);
    });
  });

  describe("integration: checkoutToken and nonce together", () => {
    it("should preserve both checkoutToken and nonce in validated payload", () => {
      const eventPayload = {
        eventName: "checkout_completed",
        timestamp: Date.now(),
        shopDomain: "test-shop.myshopify.com",
        nonce: "integration-nonce-99999",
        data: {
          orderId: null,
          checkoutToken: "integration-token-99999",
          value: 75.00,
          currency: "USD",
        },
      };

      const validationResult = validateRequest(eventPayload);
      expect(validationResult.valid).toBe(true);
      if (validationResult.valid) {
        const payload = validationResult.payload;
        expect(payload.nonce).toBe("integration-nonce-99999");
        expect(payload.data.checkoutToken).toBe("integration-token-99999");
        expect(payload.data.orderId).toBeNull();

        const matchKeyResult = generateOrderMatchKey(
          payload.data.orderId,
          payload.data.checkoutToken,
          payload.shopDomain
        );

        expect(matchKeyResult.usedCheckoutTokenAsFallback).toBe(true);
        expect(matchKeyResult.orderId).toBeTruthy();
        expect(matchKeyResult.altOrderKey).toBeNull();
      }
    });
  });
});
