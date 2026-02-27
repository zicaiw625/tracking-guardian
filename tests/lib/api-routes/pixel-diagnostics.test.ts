import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

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

vi.mock("../../../app/utils/redis-client.server", () => ({
  getRedisClient: vi.fn(),
}));

import prisma from "../../../app/db.server";
import { action } from "../../../app/lib/api-routes/pixel-diagnostics";
import { checkRateLimitAsync, ipKeyExtractor } from "../../../app/middleware/rate-limit.server";
import { getRedisClient } from "../../../app/utils/redis-client.server";
const TEST_DIAGNOSTIC_SECRET = "pixel-diagnostic-secret-for-test";
const originalEnv = process.env;

function buildSignature(body: Record<string, unknown>): string {
  return createHmac("sha256", TEST_DIAGNOSTIC_SECRET)
    .update(`${body.shopDomain}:${body.timestamp}:${body.reason}`)
    .digest("hex");
}

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
      "X-Tracking-Guardian-Signature": buildSignature(body),
      "X-Tracking-Guardian-Nonce": "nonce-1",
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
    process.env = {
      ...originalEnv,
      PIXEL_DIAGNOSTIC_SECRET: TEST_DIAGNOSTIC_SECRET,
      NODE_ENV: "test",
    };
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
    vi.mocked(getRedisClient).mockResolvedValue({
      setNX: vi.fn().mockResolvedValue(true),
    } as never);
  });

  afterEach(() => {
    process.env = originalEnv;
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

  it("accepts backend_url_not_injected diagnostic reason", async () => {
    const response = await action({
      request: createRequest({
        reason: "backend_url_not_injected",
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

  it("rejects request with invalid diagnostic signature", async () => {
    const payload = {
      reason: "missing_ingestion_key",
      shopDomain: "demo-shop.myshopify.com",
      timestamp: Date.now(),
    };
    const response = await action({
      request: createRequest(payload, { "X-Tracking-Guardian-Signature": "invalid" }),
      params: {},
      context: {},
    });
    expect(response.status).toBe(403);
  });

  it("rejects request without nonce", async () => {
    const payload = {
      reason: "missing_ingestion_key",
      shopDomain: "demo-shop.myshopify.com",
      timestamp: Date.now(),
    };
    const response = await action({
      request: createRequest(payload, { "X-Tracking-Guardian-Nonce": "" }),
      params: {},
      context: {},
    });
    expect(response.status).toBe(403);
  });

  it("rejects replayed nonce", async () => {
    const payload = {
      reason: "missing_ingestion_key",
      shopDomain: "demo-shop.myshopify.com",
      timestamp: Date.now(),
    };
    vi.mocked(getRedisClient).mockResolvedValue({
      setNX: vi.fn().mockResolvedValue(false),
    } as never);
    const response = await action({
      request: createRequest(payload),
      params: {},
      context: {},
    });
    expect(response.status).toBe(403);
  });
});
