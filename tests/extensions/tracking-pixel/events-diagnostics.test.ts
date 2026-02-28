import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEventSender } from "../../../extensions/tracking-pixel/src/events";

describe("tracking pixel diagnostics headers", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("sends diagnostics nonce header when ingestion key is missing", () => {
    createEventSender({
      backendUrl: "https://backend.example",
      shopDomain: "demo-shop.myshopify.com",
      ingestionKey: "",
      isDevMode: false,
      consentManager: {
        marketingAllowed: true,
        analyticsAllowed: true,
        saleOfDataAllowed: true,
        hasMarketingConsent: () => true,
        hasAnalyticsConsent: () => true,
        hasFullConsent: () => true,
        updateFromStatus: () => {},
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = requestInit.headers as Record<string, string>;
    expect(headers["X-Tracking-Guardian-Diagnostic"]).toBe("1");
    expect(headers["X-Tracking-Guardian-Nonce"]).toBeTruthy();
    expect(typeof headers["X-Tracking-Guardian-Nonce"]).toBe("string");
    expect(headers["X-Tracking-Guardian-Nonce"].length).toBeGreaterThan(8);
  });
});
