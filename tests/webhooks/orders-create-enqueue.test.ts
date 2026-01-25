import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/db.server", () => ({
  default: {
    shop: {
      findUnique: vi.fn(),
    },
    shopifyOrderSnapshot: {
      upsert: vi.fn(),
    },
    pixelEventReceipt: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../../app/utils/logger.server", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../app/services/db/conversion-repository.server", () => ({
  createConversionJob: vi.fn(),
}));

import prisma from "../../app/db.server";
import { makeOrderKey } from "../../app/utils/crypto.server";
import { createConversionJob } from "../../app/services/db/conversion-repository.server";
import { handleOrdersCreate } from "../../app/webhooks/handlers/orders.handler";

describe("orders/create webhook enqueue behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should upsert ConversionJob even when a matching purchase receipt exists", async () => {
    const shopDomain = "test-shop.myshopify.com";
    const shopId = "shop-1";
    const checkoutToken = "checkout-token-123";
    const checkoutKey = makeOrderKey({ checkoutToken });

    (prisma.shop.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: shopId });
    (prisma.pixelEventReceipt.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "receipt-1",
      orderKey: checkoutKey,
    });
    (prisma.pixelEventReceipt.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.shopifyOrderSnapshot.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({});

    vi.mocked(createConversionJob).mockResolvedValue({ id: "job-1" } as any);

    const payload = {
      id: "12345",
      name: "#1001",
      total_price: "10.00",
      currency: "USD",
      financial_status: "paid",
      checkout_token: checkoutToken,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const result = await handleOrdersCreate({
      shop: shopDomain,
      topic: "orders/create",
      webhookId: "wh_1",
      payload,
      admin: null as any,
      session: null as any,
    } as any);

    expect(result.success).toBe(true);
    expect(prisma.pixelEventReceipt.update).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createConversionJob)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createConversionJob).mock.calls[0]?.[0]).toMatchObject({
      shopId,
      orderId: "12345",
      currency: "USD",
    });
  });
});

