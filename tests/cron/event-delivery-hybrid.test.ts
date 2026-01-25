import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/db.server", () => ({
  default: {
    eventLog: {
      findMany: vi.fn(),
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

vi.mock("../../app/services/db/pixel-config-repository.server", () => ({
  getShopPixelConfigs: vi.fn(),
}));

vi.mock("../../app/services/events/pipeline.server", () => ({
  processEventPipeline: vi.fn(),
}));

import prisma from "../../app/db.server";
import { getShopPixelConfigs } from "../../app/services/db/pixel-config-repository.server";
import { processEventPipeline } from "../../app/services/events/pipeline.server";
import { processEventDelivery } from "../../app/cron/tasks/event-delivery";

describe("Cron event delivery hybrid purchase filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should not deliver checkout_completed to marketing destinations", async () => {
    const payload = {
      eventName: "checkout_completed",
      timestamp: Date.now(),
      shopDomain: "test-shop.myshopify.com",
      consent: {
        marketing: true,
        analytics: true,
        saleOfDataAllowed: true,
      },
      data: {
        orderId: "123",
        value: 10,
        currency: "USD",
        environment: "live",
        items: [{ id: "sku1", quantity: 1, price: 10 }],
      },
    };

    (prisma.eventLog.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        {
          id: "elog1",
          shopId: "shop1",
          eventId: "evt1",
          eventName: "checkout_completed",
          createdAt: new Date(),
          normalizedEventJson: payload,
        },
      ])
      .mockResolvedValueOnce([]);

    vi.mocked(getShopPixelConfigs).mockResolvedValue([
      {
        id: "cfg1",
        platform: "meta",
        platformId: null,
        clientConfig: {},
      },
      {
        id: "cfg2",
        platform: "google",
        platformId: null,
        clientConfig: {},
      },
    ] as any);

    vi.mocked(processEventPipeline).mockResolvedValue({ success: true } as any);

    const result = await processEventDelivery();

    expect(result.processed).toBe(1);
    expect(vi.mocked(processEventPipeline)).toHaveBeenCalledTimes(1);
    const args = vi.mocked(processEventPipeline).mock.calls[0];
    expect(args?.[3]).toEqual(["google"]);
  });
});

