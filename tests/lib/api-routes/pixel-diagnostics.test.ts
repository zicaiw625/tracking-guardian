import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../app/db.server", () => ({
  default: {
    shop: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../../../app/middleware/rate-limit.server", () => ({
  checkRateLimitAsync: vi.fn(),
  ipKeyExtractor: vi.fn(),
}));

import prisma from "../../../app/db.server";
import { action } from "../../../app/lib/api-routes/pixel-diagnostics";
import { checkRateLimitAsync, ipKeyExtractor } from "../../../app/middleware/rate-limit.server";

function createRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Request {
  return new Request("https://example.com/api/pixel-diagnostics", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tracking-Guardian-Diagnostic": "1",
      "x-shopify-shop-domain": "demo-shop.myshopify.com",
      "User-Agent": "Mozilla/5.0",
      Origin: "https://demo-shop.myshopify.com",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("pixel diagnostics api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ipKeyExtractor).mockReturnValue("1.2.3.4");
    vi.mocked(checkRateLimitAsync).mockResolvedValue({
      allowed: true,
      remaining: 19,
      resetAt: Date.now() + 60000,
      retryAfter: undefined,
      usingFallback: false,
    });
    vi.mocked(prisma.shop.findUnique).mockResolvedValue({
      id: "shop-1",
      isActive: true,
    } as never);
  });

  it("accepts valid diagnostic request", async () => {
    const response = await action({
      request: createRequest({
        reason: "missing_ingestion_key",
        shopDomain: "demo-shop.myshopify.com",
        timestamp: Date.now(),
      }),
      params: {},
      context: {},
    });
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.accepted).toBe(true);
  });

  it("rejects payload with extra fields", async () => {
    const response = await action({
      request: createRequest({
        reason: "missing_ingestion_key",
        shopDomain: "demo-shop.myshopify.com",
        timestamp: Date.now(),
        events: [],
      }),
      params: {},
      context: {},
    });
    expect(response.status).toBe(400);
  });

  it("rejects mismatched header and payload shop domain", async () => {
    const response = await action({
      request: createRequest(
        {
          reason: "missing_ingestion_key",
          shopDomain: "demo-shop.myshopify.com",
          timestamp: Date.now(),
        },
        { "x-shopify-shop-domain": "another-shop.myshopify.com" }
      ),
      params: {},
      context: {},
    });
    expect(response.status).toBe(403);
  });
});
