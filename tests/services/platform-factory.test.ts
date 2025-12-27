

import { describe, it, expect } from "vitest";
import {
  getPlatformService,
  isPlatformSupported,
  getSupportedPlatforms,
  googleService,
  metaService,
  tiktokService,
} from "../../app/services/platforms/factory";
import { GooglePlatformService } from "../../app/services/platforms/google.service";
import { MetaPlatformService } from "../../app/services/platforms/meta.service";
import { TikTokPlatformService } from "../../app/services/platforms/tiktok.service";

describe("getPlatformService", () => {
  it("should return GooglePlatformService for google platform", () => {
    const service = getPlatformService("google");
    expect(service).toBeInstanceOf(GooglePlatformService);
  });

  it("should return MetaPlatformService for meta platform", () => {
    const service = getPlatformService("meta");
    expect(service).toBeInstanceOf(MetaPlatformService);
  });

  it("should return TikTokPlatformService for tiktok platform", () => {
    const service = getPlatformService("tiktok");
    expect(service).toBeInstanceOf(TikTokPlatformService);
  });

  it("should throw for unsupported platform", () => {
    expect(() => {
      getPlatformService("invalid");
    }).toThrow("Unsupported platform");
  });
});

describe("isPlatformSupported", () => {
  it("should return true for supported platforms", () => {
    expect(isPlatformSupported("google")).toBe(true);
    expect(isPlatformSupported("meta")).toBe(true);
    expect(isPlatformSupported("tiktok")).toBe(true);
  });

  it("should return false for unsupported platforms", () => {
    expect(isPlatformSupported("invalid")).toBe(false);
    expect(isPlatformSupported("")).toBe(false);
  });
});

describe("getSupportedPlatforms", () => {
  it("should return all supported platforms", () => {
    const platforms = getSupportedPlatforms();
    expect(platforms).toContain("google");
    expect(platforms).toContain("meta");
    expect(platforms).toContain("tiktok");
    expect(platforms).toHaveLength(3);
  });
});

describe("PlatformService interface compliance", () => {
  const services = [
    { name: "google", service: googleService },
    { name: "meta", service: metaService },
    { name: "tiktok", service: tiktokService },
  ];

  for (const { name, service } of services) {
    describe(`${name} service`, () => {
      it("should have platform property", () => {
        expect(service.platform).toBe(name);
      });

      it("should have displayName property", () => {
        expect(typeof service.displayName).toBe("string");
        expect(service.displayName.length).toBeGreaterThan(0);
      });

      it("should have sendConversion method", () => {
        expect(typeof service.sendConversion).toBe("function");
      });

      it("should have validateCredentials method", () => {
        expect(typeof service.validateCredentials).toBe("function");
      });

      it("should have parseError method", () => {
        expect(typeof service.parseError).toBe("function");
      });

      it("should have buildPayload method", () => {
        expect(typeof service.buildPayload).toBe("function");
      });
    });
  }
});

describe("Credential validation", () => {
  describe("Google credentials", () => {
    it("should accept valid Google credentials", () => {
      const result = googleService.validateCredentials({
        measurementId: "G-ABC12345",
        apiSecret: "secret123",
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject invalid measurementId format", () => {
      const result = googleService.validateCredentials({
        measurementId: "invalid",
        apiSecret: "secret123",
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("format"))).toBe(true);
    });

    it("should reject missing measurementId", () => {
      const result = googleService.validateCredentials({
        apiSecret: "secret123",
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("measurementId"))).toBe(true);
    });

    it("should reject missing apiSecret", () => {
      const result = googleService.validateCredentials({
        measurementId: "G-ABC12345",
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("apiSecret"))).toBe(true);
    });
  });

  describe("Meta credentials", () => {
    it("should accept valid Meta credentials", () => {
      const result = metaService.validateCredentials({
        pixelId: "1234567890123456",
        accessToken: "EAAtoken123",
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject missing pixelId", () => {
      const result = metaService.validateCredentials({
        accessToken: "EAAtoken123",
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("pixelId"))).toBe(true);
    });

    it("should reject missing accessToken", () => {
      const result = metaService.validateCredentials({
        pixelId: "1234567890123456",
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("accessToken"))).toBe(true);
    });
  });

  describe("TikTok credentials", () => {
    it("should accept valid TikTok credentials", () => {

      const result = tiktokService.validateCredentials({
        pixelId: "ABCDEF1234567890ABCDEF",
        accessToken: "token123abc",
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject missing pixelId", () => {
      const result = tiktokService.validateCredentials({
        accessToken: "token123abc",
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("pixelId") || e.includes("pixel"))).toBe(true);
    });

    it("should reject missing accessToken", () => {
      const result = tiktokService.validateCredentials({
        pixelId: "ABCDEF1234567890ABCDEF",
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("accessToken") || e.includes("token"))).toBe(true);
    });
  });
});

describe("Error parsing", () => {
  const services = [
    { name: "google", service: googleService },
    { name: "meta", service: metaService },
    { name: "tiktok", service: tiktokService },
  ];

  for (const { name, service } of services) {
    describe(`${name} error parsing`, () => {
      it("should parse Error objects", () => {
        const error = new Error("Test error message");
        const parsed = service.parseError(error);

        expect(parsed).toHaveProperty("type");
        expect(parsed).toHaveProperty("message");

        expect("isRetryable" in parsed || "retryable" in parsed).toBe(true);
        expect(parsed.message).toContain("Test error message");
      });

      it("should parse string errors", () => {
        const parsed = service.parseError("String error");

        expect(parsed).toHaveProperty("message");
        expect(parsed.message).toContain("String error");
      });

      it("should handle null/undefined gracefully", () => {
        const parsedNull = service.parseError(null);
        const parsedUndefined = service.parseError(undefined);

        expect(parsedNull).toHaveProperty("type");
        expect(parsedNull).toHaveProperty("message");
        expect(parsedUndefined).toHaveProperty("type");
        expect(parsedUndefined).toHaveProperty("message");
      });
    });
  }
});

