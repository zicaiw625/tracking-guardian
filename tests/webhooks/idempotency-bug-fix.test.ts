import { beforeEach, describe, expect, it, vi } from "vitest";

const { createMock, findUniqueMock, updateManyMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  findUniqueMock: vi.fn(),
  updateManyMock: vi.fn(),
}));

vi.mock("../../app/db.server", () => ({
  default: {
    webhookLog: {
      create: createMock,
      findUnique: findUniqueMock,
      updateMany: updateManyMock,
    },
  },
}));

vi.mock("../../app/utils/helpers", () => ({
  generateSimpleId: vi.fn(() => "webhook_test"),
}));

import { tryAcquireWebhookLock } from "../../app/webhooks/middleware/idempotency";

function prismaConflictError(): Error & { code: string } {
  const err = new Error("Unique constraint failed") as Error & { code: string };
  err.code = "P2002";
  return err;
}

describe("Webhook idempotency middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows processing when lock insert succeeds", async () => {
    createMock.mockResolvedValueOnce({});

    const result = await tryAcquireWebhookLock(
      "test-shop.myshopify.com",
      "wh_1",
      "orders/create"
    );

    expect(result).toEqual({ acquired: true });
  });

  it("re-acquires lock when previous status is FAILED", async () => {
    createMock.mockRejectedValueOnce(prismaConflictError());
    findUniqueMock.mockResolvedValueOnce({
      status: "failed",
      receivedAt: new Date(),
    });
    updateManyMock.mockResolvedValueOnce({ count: 1 });

    const result = await tryAcquireWebhookLock(
      "test-shop.myshopify.com",
      "wh_2",
      "orders/create"
    );

    expect(result).toEqual({ acquired: true });
    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "failed",
        }),
        data: expect.objectContaining({
          status: "processing",
        }),
      })
    );
  });

  it("returns duplicate when existing lock is still processing", async () => {
    createMock.mockRejectedValueOnce(prismaConflictError());
    findUniqueMock.mockResolvedValueOnce({
      status: "processing",
      receivedAt: new Date(),
    });

    const result = await tryAcquireWebhookLock(
      "test-shop.myshopify.com",
      "wh_3",
      "orders/create"
    );

    expect(result).toEqual({ acquired: false, existing: true });
  });
});
