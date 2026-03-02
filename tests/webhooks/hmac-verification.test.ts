import { createHash } from "crypto";
import { describe, expect, it, vi } from "vitest";
import {
  generateHMACSignature,
  validatePixelEventHMAC,
} from "../../app/lib/pixel-events/hmac-validation";

vi.mock("../../app/utils/logger.server", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const token = "test-secret-token-123";
const shopDomain = "test-shop.myshopify.com";
const timestampWindowMs = 5 * 60 * 1000;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function buildSignedRequest(bodyText: string, signature: string, timestamp: number): Request {
  return new Request("https://example.com/webhooks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tracking-Guardian-Signature": signature,
      "X-Tracking-Guardian-Timestamp": String(timestamp),
    },
    body: bodyText,
  });
}

describe("Webhook HMAC verification", () => {
  it("accepts valid signature over raw request body hash", async () => {
    const timestamp = Date.now();
    const bodyText = JSON.stringify({ eventName: "purchase", timestamp });
    const bodyHash = sha256(bodyText);
    const signature = generateHMACSignature(token, timestamp, shopDomain, bodyHash);
    const request = buildSignedRequest(bodyText, signature, timestamp);

    const result = await validatePixelEventHMAC(
      request,
      bodyHash,
      token,
      shopDomain,
      timestamp,
      timestampWindowMs
    );

    expect(result.valid).toBe(true);
    expect(result.trustLevel).toBe("trusted");
  });

  it("rejects tampered payload when signature computed from original payload", async () => {
    const timestamp = Date.now();
    const originalBody = JSON.stringify({ eventName: "purchase", amount: 100, timestamp });
    const tamperedBody = JSON.stringify({ eventName: "purchase", amount: 999, timestamp });
    const signature = generateHMACSignature(token, timestamp, shopDomain, sha256(originalBody));
    const request = buildSignedRequest(tamperedBody, signature, timestamp);

    const result = await validatePixelEventHMAC(
      request,
      sha256(tamperedBody),
      token,
      shopDomain,
      timestamp,
      timestampWindowMs
    );

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("invalid_signature");
  });

  it("rejects invalid mixed timestamp header format", async () => {
    const timestamp = Date.now();
    const bodyText = JSON.stringify({ eventName: "purchase", timestamp });
    const bodyHash = sha256(bodyText);
    const signature = generateHMACSignature(token, timestamp, shopDomain, bodyHash);
    const request = new Request("https://example.com/webhooks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tracking-Guardian-Signature": signature,
        "X-Tracking-Guardian-Timestamp": `${timestamp}abc`,
      },
      body: bodyText,
    });

    const result = await validatePixelEventHMAC(
      request,
      bodyHash,
      token,
      shopDomain,
      timestamp,
      timestampWindowMs
    );

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("missing_timestamp_header");
  });
});
