import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getPixelEventsCorsHeaders } from "../../app/utils/cors";

function makeRequest(method: string, headers: Record<string, string>): Request {
  return new Request("https://example.com/ingest", { method, headers });
}

describe("CORS: Origin null requires signature in production", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.NODE_ENV = "production";
    process.env.PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY = "true";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("allows preflight when Access-Control-Request-Headers declares signature", () => {
    const request = makeRequest("OPTIONS", {
      Origin: "null",
      "Access-Control-Request-Headers": "content-type, x-tracking-guardian-signature",
    });
    const headers = getPixelEventsCorsHeaders(request) as Record<string, string>;
    expect(headers["Access-Control-Allow-Origin"]).toBe("null");
  });

  it("does not allow preflight when signature header is not declared", () => {
    const request = makeRequest("OPTIONS", {
      Origin: "null",
      "Access-Control-Request-Headers": "content-type",
    });
    const headers = getPixelEventsCorsHeaders(request) as Record<string, string>;
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("allows actual request when signature header is present", () => {
    const request = makeRequest("POST", {
      Origin: "null",
      "X-Tracking-Guardian-Signature": "sig",
      "Content-Type": "application/json",
    });
    const headers = getPixelEventsCorsHeaders(request) as Record<string, string>;
    expect(headers["Access-Control-Allow-Origin"]).toBe("null");
  });

  it("does not allow actual request when signature header is missing", () => {
    const request = makeRequest("POST", {
      Origin: "null",
      "Content-Type": "application/json",
    });
    const headers = getPixelEventsCorsHeaders(request) as Record<string, string>;
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});

