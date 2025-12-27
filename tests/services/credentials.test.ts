import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  // Result-based API
  decryptCredentials,
  validatePlatformCredentials,
  getValidCredentials,
  type PixelConfigForCredentials,
} from "../../app/services/credentials.server";
import { encryptJson } from "../../app/utils/crypto.server";
import type { GoogleCredentials, MetaCredentials, TikTokCredentials } from "../../app/types";

describe("Credentials Service", () => {
  // =========================================================================
  // Result-based API Tests
  // =========================================================================

  describe("decryptCredentials (Result-based)", () => {
    it("should return ok result with decrypted credentials", () => {
      const credentials: GoogleCredentials = {
        measurementId: "G-XXXXXXXX",
        apiSecret: "secret123",
      };
      const encrypted = encryptJson(credentials);

      const pixelConfig: PixelConfigForCredentials = {
        credentialsEncrypted: encrypted,
        platform: "google",
      };

      const result = decryptCredentials(pixelConfig, "google");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.credentials).toEqual(credentials);
        expect(result.value.usedLegacy).toBe(false);
      }
    });

    it("should return error result when decryption fails", () => {
      const pixelConfig: PixelConfigForCredentials = {
        credentialsEncrypted: "invalid:encrypted:data",
        platform: "google",
      };

      const result = decryptCredentials(pixelConfig, "google");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("NO_CREDENTIALS");
      }
    });

    it("should return error result when no credentials available", () => {
      const pixelConfig: PixelConfigForCredentials = {
        credentialsEncrypted: null,
        credentials: undefined,
        platform: "google",
      };

      const result = decryptCredentials(pixelConfig, "google");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("NO_CREDENTIALS");
        expect(result.error.platform).toBe("google");
      }
    });

    it("should use legacy plaintext credentials as fallback", () => {
      const credentials: MetaCredentials = {
        pixelId: "123456789",
        accessToken: "token123",
      };

      const pixelConfig: PixelConfigForCredentials = {
        credentialsEncrypted: null,
        credentials: credentials,
        platform: "meta",
      };

      const result = decryptCredentials(pixelConfig, "meta");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.credentials).toEqual(credentials);
        expect(result.value.usedLegacy).toBe(true);
      }
    });

    it("should fallback to legacy when encrypted fails", () => {
      const credentials: GoogleCredentials = {
        measurementId: "G-XXXXXXXX",
        apiSecret: "secret123",
      };

      const pixelConfig: PixelConfigForCredentials = {
        credentialsEncrypted: "invalid:encrypted:data", // This will fail
        credentials: credentials, // Fallback to this
        platform: "google",
      };

      const result = decryptCredentials(pixelConfig, "google");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.credentials).toEqual(credentials);
        expect(result.value.usedLegacy).toBe(true);
      }
    });
  });

  describe("validatePlatformCredentials (Result-based)", () => {
    it("should return ok for valid Google credentials", () => {
      const credentials: GoogleCredentials = {
        measurementId: "G-XXXXXXXX",
        apiSecret: "secret123",
      };

      const result = validatePlatformCredentials(credentials, "google");

      expect(result.ok).toBe(true);
    });

    it("should return error for invalid Google credentials", () => {
      const credentials = {
        measurementId: "G-XXXXXXXX",
        // Missing apiSecret
      } as GoogleCredentials;

      const result = validatePlatformCredentials(credentials, "google");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("VALIDATION_FAILED");
        expect(result.error.message).toContain("apiSecret");
      }
    });

    it("should return ok for valid Meta credentials", () => {
      const credentials: MetaCredentials = {
        pixelId: "123456789",
        accessToken: "token123",
      };

      const result = validatePlatformCredentials(credentials, "meta");

      expect(result.ok).toBe(true);
    });

    it("should return error for invalid Meta credentials", () => {
      const credentials = {
        accessToken: "token123",
        // Missing pixelId
      } as MetaCredentials;

      const result = validatePlatformCredentials(credentials, "meta");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("VALIDATION_FAILED");
        expect(result.error.message).toContain("pixelId");
      }
    });

    it("should return ok for valid TikTok credentials", () => {
      const credentials: TikTokCredentials = {
        pixelCode: "pixel123",
        accessToken: "tiktok_token",
      };

      const result = validatePlatformCredentials(credentials, "tiktok");

      expect(result.ok).toBe(true);
    });

    it("should return error for invalid TikTok credentials", () => {
      const credentials = {
        accessToken: "tiktok_token",
        // Missing pixelCode
      } as unknown as TikTokCredentials;

      const result = validatePlatformCredentials(credentials, "tiktok");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("VALIDATION_FAILED");
        expect(result.error.message).toContain("pixelCode");
      }
    });
  });

  describe("getValidCredentials (Result-based)", () => {
    it("should return ok with valid decrypted and validated credentials", () => {
      const credentials: GoogleCredentials = {
        measurementId: "G-XXXXXXXX",
        apiSecret: "secret123",
      };
      const encrypted = encryptJson(credentials);

      const pixelConfig: PixelConfigForCredentials = {
        credentialsEncrypted: encrypted,
        platform: "google",
      };

      const result = getValidCredentials(pixelConfig, "google");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.credentials).toEqual(credentials);
      }
    });

    it("should return error when validation fails", () => {
      const credentials = {
        measurementId: "G-XXXXXXXX",
        // Missing apiSecret
      };
      const encrypted = encryptJson(credentials);

      const pixelConfig: PixelConfigForCredentials = {
        credentialsEncrypted: encrypted,
        platform: "google",
      };

      const result = getValidCredentials(pixelConfig, "google");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("VALIDATION_FAILED");
      }
    });

    it("should return error when decryption fails", () => {
      const pixelConfig: PixelConfigForCredentials = {
        credentialsEncrypted: "invalid:encrypted:data",
        platform: "google",
      };

      const result = getValidCredentials(pixelConfig, "google");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("NO_CREDENTIALS");
      }
    });
  });
});
