import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCheckAndReserveBillingSlot = vi.fn();
const mockReleaseBillingSlot = vi.fn();

vi.mock("../../../app/services/billing/gate.server", () => ({
  checkAndReserveBillingSlot: (...args: unknown[]) => mockCheckAndReserveBillingSlot(...args),
  releaseBillingSlot: (...args: unknown[]) => mockReleaseBillingSlot(...args),
}));

vi.mock("../../../app/utils/config.server", () => ({
  getBoolEnv: vi.fn(() => true),
}));

const txMock = {
  internalEvent: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  eventDispatchJob: {
    createMany: vi.fn(),
  },
  $executeRaw: vi.fn(),
};

vi.mock("../../../app/db.server", () => ({
  default: {
    pixelConfig: {
      findMany: vi.fn(),
    },
    shop: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(async (callback: (tx: typeof txMock) => Promise<void>) => callback(txMock)),
  },
}));

import prisma from "../../../app/db.server";
import { persistInternalEventsAndDispatchJobs } from "../../../app/services/dispatch/internal-event-write.server";

describe("persistInternalEventsAndDispatchJobs billing gate integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.pixelConfig.findMany).mockResolvedValue([{ platform: "google" }] as any);
    vi.mocked(prisma.shop.findUnique).mockResolvedValue({ plan: "starter" } as any);
    txMock.internalEvent.findUnique.mockResolvedValue(null);
    txMock.internalEvent.create.mockResolvedValue({ id: "ie-1" });
    txMock.eventDispatchJob.createMany.mockResolvedValue({ count: 1 });
  });

  it("should skip purchase dispatch when billing gate blocks reservation", async () => {
    mockCheckAndReserveBillingSlot.mockResolvedValue({
      ok: true,
      value: {
        success: false,
        current: 1000,
        limit: 1000,
        remaining: 0,
        alreadyCounted: false,
        yearMonth: "2026-03",
      },
    });

    await persistInternalEventsAndDispatchJobs(
      "shop-1",
      [
        {
          eventId: "evt-1",
          orderId: "order-1",
          destinations: ["google"],
          payload: {
            eventName: "checkout_completed",
            timestamp: Date.now(),
            shopDomain: "demo.myshopify.com",
            data: { orderId: "order-1", currency: "USD", value: 10 },
          },
        } as any,
      ],
      undefined,
      "live"
    );

    expect(mockCheckAndReserveBillingSlot).toHaveBeenCalledOnce();
    expect(txMock.internalEvent.create).not.toHaveBeenCalled();
    expect(txMock.eventDispatchJob.createMany).not.toHaveBeenCalled();
  });

  it("should release reserved usage slot when transaction fails", async () => {
    mockCheckAndReserveBillingSlot.mockResolvedValue({
      ok: true,
      value: {
        success: true,
        current: 10,
        limit: 1000,
        remaining: 989,
        alreadyCounted: false,
        yearMonth: "2026-03",
      },
    });
    txMock.internalEvent.create.mockRejectedValue(new Error("db write failed"));

    await expect(
      persistInternalEventsAndDispatchJobs(
        "shop-1",
        [
          {
            eventId: "evt-1",
            orderId: "order-2",
            destinations: ["google"],
            payload: {
              eventName: "checkout_completed",
              timestamp: Date.now(),
              shopDomain: "demo.myshopify.com",
              data: { orderId: "order-2", currency: "USD", value: 10 },
            },
          } as any,
        ],
        undefined,
        "live"
      )
    ).rejects.toThrow("db write failed");

    expect(mockReleaseBillingSlot).toHaveBeenCalledWith("shop-1", "2026-03");
  });
});
