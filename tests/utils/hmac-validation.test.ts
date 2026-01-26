import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac, createHash } from "crypto";
import {
  validatePixelEventHMAC,
  verifyHMACSignature,
  generateHMACSignature,
  extractHMACSignature,
  extractTimestampHeader,
} from "../../app/lib/pixel-events/hmac-validation";

vi.mock("../../app/utils/logger.server", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("HMAC Validation", () => {
  const testToken = "test-secret-token-123";
  const testShopDomain = "test-shop.myshopify.com";
  const timestampWindowMs = 300000;

  function makeBodyAndTimestamp(): { bodyText: string; timestamp: number } {
    const timestamp = Date.now();
    return { bodyText: `{"eventName":"test","timestamp":${timestamp}}`, timestamp };
  }

  function createBodyHash(bodyText: string): string {
    return createHash("sha256").update(bodyText).digest("hex");
  }

  function createValidRequest(signature: string, timestamp: number, bodyText: string): Request {
    return new Request("https://example.com/ingest", {
      method: "POST",
      headers: {
        "X-Tracking-Guardian-Signature": signature,
        "X-Tracking-Guardian-Timestamp": String(timestamp),
        "Content-Type": "application/json",
      },
      body: bodyText,
    });
  }

  describe("generateHMACSignature", () => {
    it("should generate valid HMAC signature", () => {
      const { bodyText, timestamp } = makeBodyAndTimestamp();
      const bodyHash = createBodyHash(bodyText);
      const signature = generateHMACSignature(testToken, timestamp, testShopDomain, bodyHash);
      expect(signature).toBeTruthy();
      expect(signature).toMatch(/^[0-9a-f]+$/i);
      expect(signature.length).toBeGreaterThan(0);
    });
  });

  describe("verifyHMACSignature", () => {
    it("should return valid=true for correct signature", () => {
      const { bodyText, timestamp } = makeBodyAndTimestamp();
      const bodyHash = createBodyHash(bodyText);
      const signature = generateHMACSignature(testToken, timestamp, testShopDomain, bodyHash);
      const result = verifyHMACSignature(signature, testToken, timestamp, testShopDomain, bodyHash, timestampWindowMs);
      expect(result.valid).toBe(true);
      expect(result.trustLevel).toBe("trusted");
    });

    it("should return valid=false for missing signature", () => {
      const { bodyText, timestamp } = makeBodyAndTimestamp();
      const bodyHash = createBodyHash(bodyText);
      const result = verifyHMACSignature(null, testToken, timestamp, testShopDomain, bodyHash, timestampWindowMs);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("missing_signature");
      expect(result.trustLevel).toBe("untrusted");
    });

    it("should return valid=false for invalid signature format", () => {
      const { bodyText, timestamp } = makeBodyAndTimestamp();
      const bodyHash = createBodyHash(bodyText);
      const result = verifyHMACSignature("invalid-format!", testToken, timestamp, testShopDomain, bodyHash, timestampWindowMs);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("invalid_signature");
      expect(result.trustLevel).toBe("untrusted");
    });

    it("should return valid=false for signature too long", () => {
      const { bodyText, timestamp } = makeBodyAndTimestamp();
      const bodyHash = createBodyHash(bodyText);
      const longSignature = "a".repeat(257);
      const result = verifyHMACSignature(longSignature, testToken, timestamp, testShopDomain, bodyHash, timestampWindowMs);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("invalid_signature");
      expect(result.trustLevel).toBe("untrusted");
    });

    it("should return valid=false for timestamp out of window (too old)", () => {
      const { bodyText } = makeBodyAndTimestamp();
      const oldTimestamp = Date.now() - timestampWindowMs - 1000;
      const bodyHash = createBodyHash(bodyText);
      const signature = generateHMACSignature(testToken, oldTimestamp, testShopDomain, bodyHash);
      const result = verifyHMACSignature(signature, testToken, oldTimestamp, testShopDomain, bodyHash, timestampWindowMs);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("timestamp_out_of_window");
      expect(result.trustLevel).toBe("untrusted");
    });

    it("should return valid=false for timestamp out of window (future)", () => {
      const { bodyText } = makeBodyAndTimestamp();
      const futureTimestamp = Date.now() + timestampWindowMs + 1000;
      const bodyHash = createBodyHash(bodyText);
      const signature = generateHMACSignature(testToken, futureTimestamp, testShopDomain, bodyHash);
      const result = verifyHMACSignature(signature, testToken, futureTimestamp, testShopDomain, bodyHash, timestampWindowMs);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("timestamp_out_of_window");
      expect(result.trustLevel).toBe("untrusted");
    });

    it("should return valid=false for signature mismatch", () => {
      const { bodyText, timestamp } = makeBodyAndTimestamp();
      const bodyHash = createBodyHash(bodyText);
      const wrongSignature = generateHMACSignature("wrong-token", timestamp, testShopDomain, bodyHash);
      const result = verifyHMACSignature(wrongSignature, testToken, timestamp, testShopDomain, bodyHash, timestampWindowMs);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("invalid_signature");
      expect(result.trustLevel).toBe("untrusted");
    });
  });

  describe("extractHMACSignature", () => {
    it("should extract signature from request header", () => {
      const { bodyText, timestamp } = makeBodyAndTimestamp();
      const signature = "abc123";
      const request = createValidRequest(signature, timestamp, bodyText);
      const extracted = extractHMACSignature(request);
      expect(extracted).toBe(signature);
    });

    it("should return null when signature header is missing", () => {
      const { bodyText, timestamp } = makeBodyAndTimestamp();
      const request = new Request("https://example.com/ingest", {
        method: "POST",
        headers: {
          "X-Tracking-Guardian-Timestamp": String(timestamp),
        },
        body: bodyText,
      });
      const extracted = extractHMACSignature(request);
      expect(extracted).toBeNull();
    });
  });

  describe("extractTimestampHeader", () => {
    it("should extract timestamp from request header", () => {
      const { bodyText, timestamp } = makeBodyAndTimestamp();
      const request = createValidRequest("abc123", timestamp, bodyText);
      const extracted = extractTimestampHeader(request);
      expect(extracted).toBe(timestamp);
    });

    it("should return null when timestamp header is missing", () => {
      const { bodyText } = makeBodyAndTimestamp();
      const request = new Request("https://example.com/ingest", {
        method: "POST",
        headers: {
          "X-Tracking-Guardian-Signature": "abc123",
        },
        body: bodyText,
      });
      const extracted = extractTimestampHeader(request);
      expect(extracted).toBeNull();
    });

    it("should return null for invalid timestamp format", () => {
      const { bodyText } = makeBodyAndTimestamp();
      const request = new Request("https://example.com/ingest", {
        method: "POST",
        headers: {
          "X-Tracking-Guardian-Signature": "abc123",
          "X-Tracking-Guardian-Timestamp": "invalid",
        },
        body: bodyText,
      });
      const extracted = extractTimestampHeader(request);
      expect(extracted).toBeNull();
    });
  });

  describe("validatePixelEventHMAC", () => {
    it("should return valid=true for correct request", async () => {
      const { bodyText, timestamp } = makeBodyAndTimestamp();
      const bodyHash = createBodyHash(bodyText);
      const signature = generateHMACSignature(testToken, timestamp, testShopDomain, bodyHash);
      const request = createValidRequest(signature, timestamp, bodyText);
      const result = await validatePixelEventHMAC(request, bodyText, testToken, testShopDomain, timestamp, timestampWindowMs);
      expect(result.valid).toBe(true);
      expect(result.trustLevel).toBe("trusted");
    });

    it("should return valid=false for missing signature header", async () => {
      const { bodyText, timestamp } = makeBodyAndTimestamp();
      const request = new Request("https://example.com/ingest", {
        method: "POST",
        headers: {
          "X-Tracking-Guardian-Timestamp": String(timestamp),
        },
        body: bodyText,
      });
      const result = await validatePixelEventHMAC(request, bodyText, testToken, testShopDomain, timestamp, timestampWindowMs);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("missing_signature");
      expect(result.trustLevel).toBe("untrusted");
    });

    it("should return valid=false for missing timestamp header", async () => {
      const { bodyText, timestamp } = makeBodyAndTimestamp();
      const bodyHash = createBodyHash(bodyText);
      const signature = generateHMACSignature(testToken, timestamp, testShopDomain, bodyHash);
      const request = new Request("https://example.com/ingest", {
        method: "POST",
        headers: {
          "X-Tracking-Guardian-Signature": signature,
        },
        body: bodyText,
      });
      const result = await validatePixelEventHMAC(request, bodyText, testToken, testShopDomain, timestamp, timestampWindowMs);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("missing_timestamp_header");
      expect(result.trustLevel).toBe("untrusted");
    });

    it("should return valid=false for timestamp mismatch", async () => {
      const { bodyText, timestamp } = makeBodyAndTimestamp();
      const bodyHash = createBodyHash(bodyText);
      const signature = generateHMACSignature(testToken, timestamp, testShopDomain, bodyHash);
      const request = createValidRequest(signature, timestamp, bodyText);
      const differentPayloadTimestamp = timestamp + 1000;
      const result = await validatePixelEventHMAC(request, bodyText, testToken, testShopDomain, differentPayloadTimestamp, timestampWindowMs);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("timestamp_mismatch");
      expect(result.trustLevel).toBe("untrusted");
    });

    it("should return valid=false for invalid signature", async () => {
      const { bodyText, timestamp } = makeBodyAndTimestamp();
      const request = createValidRequest("invalid-signature", timestamp, bodyText);
      const result = await validatePixelEventHMAC(request, bodyText, testToken, testShopDomain, timestamp, timestampWindowMs);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("invalid_signature");
      expect(result.trustLevel).toBe("untrusted");
    });

    it("should return valid=false for timestamp out of window", async () => {
      const { bodyText } = makeBodyAndTimestamp();
      const oldTimestamp = Date.now() - timestampWindowMs - 1000;
      const bodyHash = createBodyHash(bodyText);
      const signature = generateHMACSignature(testToken, oldTimestamp, testShopDomain, bodyHash);
      const request = createValidRequest(signature, oldTimestamp, bodyText);
      const result = await validatePixelEventHMAC(request, bodyText, testToken, testShopDomain, oldTimestamp, timestampWindowMs);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("timestamp_out_of_window");
      expect(result.trustLevel).toBe("untrusted");
    });
  });
});
