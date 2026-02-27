import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueueIngestBatch: vi.fn(),
  ipKeyExtractor: vi.fn(),
  encrypt: vi.fn(),
}));

vi.mock("../../../app/lib/pixel-events/ingest-queue.server", () => ({
  enqueueIngestBatch: mocks.enqueueIngestBatch,
}));

vi.mock("../../../app/middleware/rate-limit.server", () => ({
  ipKeyExtractor: mocks.ipKeyExtractor,
}));

vi.mock("../../../app/utils/crypto.server", () => ({
  encrypt: mocks.encrypt,
}));

import { enqueueMiddleware } from "../../../app/lib/pixel-events/middleware/enqueue.middleware";

const originalEnv = process.env;

function createContext() {
  return {
    request: new Request("https://example.com/ingest", {
      method: "POST",
      headers: {
        "user-agent": "ua-value",
      },
    }),
    requestId: "req-1",
    shop: { id: "shop-1" },
    shopDomain: "shop.test",
    environment: "live",
    mode: "purchase_only",
    origin: "https://shop.test",
    keyValidation: { trusted: true },
    validatedEvents: [
      {
        payload: {
          data: { url: "https://shop.test/products/a?x=1" },
        },
        index: 0,
      },
    ],
    enabledPixelConfigs: [],
  } as any;
}

describe("enqueueMiddleware requestContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    mocks.enqueueIngestBatch.mockResolvedValue({ ok: true, dropped: 0 });
    mocks.ipKeyExtractor.mockReturnValue("1.2.3.4");
    mocks.encrypt.mockImplementation((value: string) => `enc:${value}`);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("does not enqueue raw or encrypted IP/UA when S2S is disabled", async () => {
    process.env.SERVER_SIDE_CONVERSIONS_ENABLED = "false";
    const result = await enqueueMiddleware(createContext());
    expect(result.continue).toBe(false);
    expect(mocks.enqueueIngestBatch).toHaveBeenCalledTimes(1);
    const entry = mocks.enqueueIngestBatch.mock.calls[0][0];
    expect(entry.requestContext.ip_encrypted).toBeNull();
    expect(entry.requestContext.user_agent_encrypted).toBeNull();
    expect(entry.requestContext.ip).toBeUndefined();
    expect(entry.requestContext.user_agent).toBeUndefined();
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });

  it("encrypts IP/UA before enqueue when S2S is enabled", async () => {
    process.env.SERVER_SIDE_CONVERSIONS_ENABLED = "true";
    const result = await enqueueMiddleware(createContext());
    expect(result.continue).toBe(false);
    expect(mocks.enqueueIngestBatch).toHaveBeenCalledTimes(1);
    const entry = mocks.enqueueIngestBatch.mock.calls[0][0];
    expect(entry.requestContext.ip_encrypted).toBe("enc:1.2.3.4");
    expect(entry.requestContext.user_agent_encrypted).toBe("enc:ua-value");
    expect(entry.requestContext.ip).toBeUndefined();
    expect(entry.requestContext.user_agent).toBeUndefined();
    expect(mocks.encrypt).toHaveBeenCalledTimes(2);
  });
});
