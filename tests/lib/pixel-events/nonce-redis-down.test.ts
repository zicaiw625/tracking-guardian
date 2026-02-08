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
import { createEventNonce, ReplayProtectionUnavailableError } from "../../../app/lib/pixel-events/receipt-handler";
import { getRedisClientStrict } from "../../../app/utils/redis-client.server";

describe("createEventNonce Redis down", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
  });
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("fails open when Redis strict fails (no DB fallback)", async () => {
    const result = await createEventNonce("shop_1", "order_1", Date.now(), "nonce_1", "purchase");
    expect(getRedisClientStrict).toHaveBeenCalled();
    expect(prisma.eventNonce.create).not.toHaveBeenCalled();
    expect(result.isReplay).toBe(false);
  });

  it("fails closed (throws) in production strict mode when Redis strict fails", async () => {
    process.env.NODE_ENV = "production";
    await expect(createEventNonce("shop_1", "order_1", Date.now(), "nonce_1", "purchase")).rejects.toBeInstanceOf(
      ReplayProtectionUnavailableError
    );
  });
});
