import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  postJson: vi.fn(),
}));

vi.mock("../../app/utils/http", () => ({
  postJson: mocks.postJson,
}));

vi.mock("../../app/utils/crypto.server", () => ({
  decrypt: vi.fn((value: string) => value),
}));

import { sendEvent } from "../../app/services/destinations/meta";

const credentials = {
  pixelId: "12345",
  accessToken: "token-abc",
};

function buildEvent() {
  return {
    event_name: "purchase",
    event_id: "evt-1",
    timestamp: Date.now(),
    value: 10,
    currency: "USD",
    page_url: "https://shop.test/checkout",
    user_agent: "ua",
  } as any;
}

describe("meta destination auth flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends header-only request first", async () => {
    mocks.postJson.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      data: {},
    });

    const result = await sendEvent(buildEvent(), credentials as any);

    expect(result.ok).toBe(true);
    expect(mocks.postJson).toHaveBeenCalledTimes(1);
    const [url, , options] = mocks.postJson.mock.calls[0];
    expect(url).toMatch(/\/12345\/events$/);
    expect(url).not.toContain("access_token=");
    expect(options.headers.Authorization).toBe("Bearer token-abc");
  });

  it("falls back to query token once on 401/403", async () => {
    mocks.postJson
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        data: { error: { message: "Unauthorized" } },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        data: {},
      });

    const result = await sendEvent(buildEvent(), credentials as any);

    expect(result.ok).toBe(true);
    expect(mocks.postJson).toHaveBeenCalledTimes(2);
    const [firstUrl, , firstOptions] = mocks.postJson.mock.calls[0];
    const [secondUrl, , secondOptions] = mocks.postJson.mock.calls[1];
    expect(firstUrl).toMatch(/\/12345\/events$/);
    expect(firstUrl).not.toContain("access_token=");
    expect(secondUrl).toContain("/12345/events?access_token=token-abc");
    expect(firstOptions.headers.Authorization).toBe("Bearer token-abc");
    expect(secondOptions.headers.Authorization).toBe("Bearer token-abc");
  });

  it("does not fallback for non-auth failure", async () => {
    mocks.postJson.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      data: { error: { message: "Bad Request" } },
    });

    const result = await sendEvent(buildEvent(), credentials as any);

    expect(result.ok).toBe(false);
    expect(mocks.postJson).toHaveBeenCalledTimes(1);
  });
});
