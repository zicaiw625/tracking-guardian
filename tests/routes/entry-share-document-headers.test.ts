import { describe, expect, it, vi } from "vitest";

vi.mock("react-dom/server", () => ({
  renderToPipeableStream: (_app: unknown, options: any) => {
    setTimeout(() => {
      options.onShellReady();
    }, 0);
    return {
      pipe: (dest: any) => {
        dest.end("<html><body>ok</body></html>");
      },
      abort: vi.fn(),
    };
  },
}));

vi.mock("@remix-run/react", () => ({
  RemixServer: () => null,
}));

vi.mock("../../app/i18n.server", () => ({
  i18nServer: {
    getLocale: vi.fn().mockResolvedValue("zh"),
    getRouteNamespaces: vi.fn().mockReturnValue(["translation"]),
  },
}));

vi.mock("../../app/shopify.server", () => ({
  addDocumentResponseHeaders: vi.fn(),
}));

vi.mock("../../app/utils/secrets.server", () => ({
  enforceSecurityChecks: vi.fn().mockResolvedValue(undefined),
  ensureSecretsValid: vi.fn(),
}));

vi.mock("../../app/utils/crypto.server", () => ({
  validateEncryptionConfig: vi.fn(),
}));

vi.mock("../../app/utils/config.server", () => ({
  validateConfig: vi.fn(() => ({ errors: [], warnings: [] })),
  logConfigStatus: vi.fn(),
  API_CONFIG: { MAX_BODY_SIZE: 1024 * 1024 },
}));

vi.mock("../../app/utils/logger.server", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../app/utils/redis-client.server", () => ({
  RedisClientFactory: {
    resetAsync: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../app/db.server", () => ({
  default: {
    $disconnect: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../app/lib/pixel-events/cors", () => ({
  getCorsHeadersPreBody: vi.fn(() => ({})),
}));

vi.mock("../../app/utils/security", () => ({
  SecureShopDomainSchema: {
    safeParse: vi.fn(() => ({ success: false })),
  },
}));

import handleRequest from "../../app/entry.server";

describe("entry share document headers", () => {
  it("applies security headers to /s share documents", async () => {
    const request = new Request("https://example.com/s/test-token");
    const response = await handleRequest(request, 200, new Headers(), { routeModules: {} } as any);

    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("applies security headers to /r share documents", async () => {
    const request = new Request("https://example.com/r/test-token");
    const response = await handleRequest(request, 200, new Headers(), { routeModules: {} } as any);

    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });
});
