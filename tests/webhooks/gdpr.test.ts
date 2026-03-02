import { beforeEach, describe, expect, it, vi } from "vitest";
import { GDPRJobStatus } from "../../app/types/enums";
import {
  handleCustomersDataRequest,
  handleCustomersRedact,
  handleShopRedact,
} from "../../app/webhooks/handlers/gdpr.handler";
import type { WebhookContext } from "../../app/webhooks/types";

const { upsertMock } = vi.hoisted(() => ({
  upsertMock: vi.fn(),
}));

vi.mock("../../app/db.server", () => ({
  default: {
    gDPRJob: {
      upsert: upsertMock,
    },
  },
}));

vi.mock("../../app/utils/logger.server", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createContext(topic: string, payload: unknown, webhookId = "wh_123"): WebhookContext {
  return {
    topic,
    shop: "test-shop.myshopify.com",
    webhookId,
    payload,
    admin: null,
    session: null,
  };
}

describe("GDPR webhook handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsertMock.mockResolvedValue(undefined);
  });

  it("queues CUSTOMERS_DATA_REQUEST with parsed payload", async () => {
    const context = createContext("CUSTOMERS_DATA_REQUEST", {
      shop_id: 1,
      shop_domain: "test-shop.myshopify.com",
      orders_requested: [1001, "x", 1002],
      customer: { id: 99 },
      data_request: { id: 1234 },
    });

    const result = await handleCustomersDataRequest(context);

    expect(result).toMatchObject({ success: true, status: 200 });
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          jobType: "data_request",
          status: GDPRJobStatus.QUEUED,
        }),
      })
    );
  });

  it("marks CUSTOMERS_DATA_REQUEST as failed when payload is invalid", async () => {
    const context = createContext("CUSTOMERS_DATA_REQUEST", {
      shop_domain: "test-shop.myshopify.com",
      orders_requested: [1001],
    });

    const result = await handleCustomersDataRequest(context);

    expect(result).toMatchObject({ success: false, status: 400, message: "Invalid payload" });
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: GDPRJobStatus.FAILED,
          errorMessage: "Invalid payload",
        }),
      })
    );
  });

  it("returns 500 when queue write fails and records failed status", async () => {
    upsertMock.mockRejectedValueOnce(new Error("db-down")).mockResolvedValueOnce(undefined);
    const context = createContext("CUSTOMERS_DATA_REQUEST", {
      shop_id: 1,
      shop_domain: "test-shop.myshopify.com",
      orders_requested: [],
    });

    const result = await handleCustomersDataRequest(context);

    expect(result).toMatchObject({
      success: false,
      status: 500,
      message: "GDPR data request processing failed",
    });
    expect(upsertMock).toHaveBeenCalledTimes(2);
    expect(upsertMock.mock.calls[1]?.[0]).toMatchObject({
      create: expect.objectContaining({
        status: GDPRJobStatus.FAILED,
      }),
      update: expect.objectContaining({
        status: GDPRJobStatus.FAILED,
      }),
    });
  });

  it("queues CUSTOMERS_REDACT and filters non-number order ids", async () => {
    const context = createContext("CUSTOMERS_REDACT", {
      shop_id: 1,
      shop_domain: "test-shop.myshopify.com",
      orders_to_redact: [2001, "bad", 2002],
      customer: { id: 88 },
    });

    const result = await handleCustomersRedact(context);

    expect(result).toMatchObject({ success: true, status: 200 });
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          jobType: "customer_redact",
          status: GDPRJobStatus.QUEUED,
        }),
      })
    );
  });

  it("rejects SHOP_REDACT when payload shop_domain mismatches", async () => {
    const context = createContext("SHOP_REDACT", {
      shop_id: 1,
      shop_domain: "other-shop.myshopify.com",
    });

    const result = await handleShopRedact(context);

    expect(result).toMatchObject({ success: false, status: 400, message: "Invalid payload" });
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          jobType: "shop_redact",
          status: GDPRJobStatus.FAILED,
        }),
      })
    );
  });

  it("queues SHOP_REDACT for valid payload", async () => {
    const context = createContext("SHOP_REDACT", {
      shop_id: 1,
      shop_domain: "test-shop.myshopify.com",
    });

    const result = await handleShopRedact(context);

    expect(result).toMatchObject({ success: true, status: 200 });
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: GDPRJobStatus.QUEUED,
        }),
      })
    );
  });
});
