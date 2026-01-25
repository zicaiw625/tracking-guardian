import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/utils/secrets.server", () => ({
  ensureSecretsValid: vi.fn(),
  enforceSecurityChecks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../app/utils/config.server", () => ({
  validateConfig: vi.fn(() => ({ errors: [], warnings: [] })),
  logConfigStatus: vi.fn(),
  API_CONFIG: {
    MAX_BODY_SIZE: 1024 * 1024,
    TIMESTAMP_WINDOW_MS: 60_000,
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

vi.mock("../../app/utils/security-headers", () => ({
  EMBEDDED_APP_HEADERS: {},
  getProductionSecurityHeaders: (base: Record<string, string>) => base,
  validateSecurityHeaders: vi.fn(() => ({ valid: true, issues: [] })),
  addSecurityHeadersToHeaders: (headers: Headers, securityHeaders: Record<string, string>) => {
    for (const [k, v] of Object.entries(securityHeaders)) {
      if (!headers.has(k)) headers.set(k, v);
    }
  },
}));

vi.mock("../../app/utils/redis-client", () => ({
  RedisClientFactory: {
    resetAsync: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../app/db.server", () => ({
  default: {
    $disconnect: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../app/shopify.server", () => ({
  addDocumentResponseHeaders: vi.fn((_request: Request, headers: Headers) => {
    headers.set("Content-Security-Policy", "frame-ancestors https://admin.shopify.com");
  }),
}));

vi.mock("react-dom/server", () => ({
  renderToPipeableStream: (_element: unknown, options: any) => {
    setTimeout(() => {
      if (typeof options.onShellReady === "function") {
        options.onShellReady();
      } else if (typeof options.onAllReady === "function") {
        options.onAllReady();
      }
    }, 0);
    return {
      pipe: (body: any) => body.end(),
      abort: vi.fn(),
    };
  },
}));

import handleRequest from "../../app/entry.server";
import { addDocumentResponseHeaders } from "../../app/shopify.server";

describe("entry.server embedded headers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
  });

  it("should remove X-Frame-Options and replace CSP for embedded requests", async () => {
    const request = new Request("https://example.com/app?embedded=1", {
      headers: { "user-agent": "Mozilla/5.0" },
    });
    const responseHeaders = new Headers({
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'",
    });

    const response = await handleRequest(request, 200, responseHeaders, {} as any);

    expect(response.headers.get("X-Frame-Options")).toBeNull();
    expect(response.headers.get("Content-Security-Policy")).toContain("https://admin.shopify.com");
    expect(vi.mocked(addDocumentResponseHeaders)).toHaveBeenCalledTimes(1);
  });

  it("should keep X-Frame-Options for non-embedded requests", async () => {
    const request = new Request("https://example.com/app", {
      headers: { "user-agent": "Mozilla/5.0" },
    });
    const responseHeaders = new Headers({
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'",
    });

    const response = await handleRequest(request, 200, responseHeaders, {} as any);

    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(vi.mocked(addDocumentResponseHeaders)).toHaveBeenCalledTimes(1);
  });
});

