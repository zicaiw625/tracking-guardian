import { beforeEach, describe, expect, it, vi } from "vitest";
const { txMock, prismaMock } = vi.hoisted(() => {
  const tx = {
    internalEvent: { upsert: vi.fn() },
    eventDispatchJob: { createMany: vi.fn() },
    orderSummary: { upsert: vi.fn() },
  };
  const prisma = {
    pixelEventReceipt: { findFirst: vi.fn() },
    pixelConfig: { findMany: vi.fn() },
    $transaction: vi.fn(async (cb: (txArg: typeof tx) => Promise<void>) => cb(tx)),
  };
  return { txMock: tx, prismaMock: prisma };
});

vi.mock("../../app/db.server", () => ({
  default: prismaMock,
}));

vi.mock("../../app/utils/config.server", () => ({
  ORDER_WEBHOOK_COLLECT_IP_UA: true,
  ORDER_WEBHOOK_ENABLED: true,
}));

vi.mock("../../app/utils/platform-consent", () => ({
  evaluatePlatformConsentWithStrategy: vi.fn(() => ({ allowed: true })),
}));

import { handleOrdersPaid } from "../../app/webhooks/handlers/orders-paid.handler";

describe("handleOrdersPaid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.pixelEventReceipt.findFirst.mockResolvedValue(null);
    prismaMock.pixelConfig.findMany.mockResolvedValue([{ platform: "google" }]);
    txMock.internalEvent.upsert.mockResolvedValue({ id: "ie-1" });
    txMock.eventDispatchJob.createMany.mockResolvedValue({ count: 1 });
    txMock.orderSummary.upsert.mockResolvedValue({ id: "os-1" });
  });

  it("uses upsert plus createMany(skipDuplicates) for idempotent writes", async () => {
    const result = await handleOrdersPaid(
      {
        shop: "demo.myshopify.com",
        topic: "ORDERS_PAID",
        webhookId: "wh-1",
        payload: {
          id: "1001",
          total_price: "12.34",
          currency: "USD",
          line_items: [],
          client_details: { browser_ip: "1.2.3.4", user_agent: "ua" },
        },
        admin: null,
        session: null,
      },
      {
        id: "shop-1",
        consentStrategy: "strict",
      } as any
    );

    expect(result.success).toBe(true);
    expect(txMock.internalEvent.upsert).toHaveBeenCalled();
    expect(txMock.eventDispatchJob.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true })
    );
  });
});
