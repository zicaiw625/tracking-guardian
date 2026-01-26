import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../app/db.server", () => ({
  default: {
    eventNonce: {
      create: vi.fn(),
    },
  },
}));

vi.mock("../../../app/utils/logger.server", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../../app/utils/redis-client.server", () => ({
  getRedisClient: vi.fn(),
  getRedisClientStrict: vi.fn(async () => {
    throw new Error("redis down");
  }),
}));

import prisma from "../../../app/db.server";
import { createEventNonce } from "../../../app/lib/pixel-events/receipt-handler";
import { getRedisClientStrict } from "../../../app/utils/redis-client.server";

describe("createEventNonce Redis down", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to DB when Redis strict fails", async () => {
    (prisma.eventNonce.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});
    const result = await createEventNonce(
      "shop_1",
      "order_1",
      Date.now(),
      "nonce_1",
      "purchase"
    );
    expect(getRedisClientStrict).toHaveBeenCalled();
    expect(prisma.eventNonce.create).toHaveBeenCalled();
    expect(result.isReplay).toBe(false);
  });

  it("returns replay when DB fallback hits unique constraint", async () => {
    (prisma.eventNonce.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce({ code: "P2002" });
    const result = await createEventNonce(
      "shop_1",
      "order_1",
      Date.now(),
      "nonce_1",
      "purchase"
    );
    expect(result.isReplay).toBe(true);
  });
});

