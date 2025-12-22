import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getDecryptedCredentials,
  validateCredentials,
  getValidatedCredentials,
  type PixelConfigForCredentials,
} from "../../app/services/credentials.server";
import { encryptJson } from "../../app/utils/crypto.server";
import type { GoogleCredentials, MetaCredentials, TikTokCredentials } from "../../app/types";

describe("Credentials Service", () => {
  describe("getDecryptedCredentials", () => {
    it("should decrypt encrypted credentials", () => {
      const credentials: GoogleCredentials = {
        measurementId: "G-XXXXXXXX",
        apiSecret: "secret123",
      };
      const encrypted = encryptJson(credentials);

      const pixelConfig: PixelConfigForCredentials = {
        credentialsEncrypted: encrypted,
        platform: "google",
      };

      const result = getDecryptedCredentials(pixelConfig, "google");

      expect(result.credentials).toEqual(credentials);
      expect(result.usedLegacy).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("should handle legacy plaintext credentials object", () => {
      const credentials: MetaCredentials = {
        pixelId: "123456789",
        accessToken: "token123",
      };

      const pixelConfig: PixelConfigForCredentials = {
        credentialsEncrypted: null,
        credentials: credentials,
        platform: "meta",
      };

      const result = getDecryptedCredentials(pixelConfig, "meta");

      expect(result.credentials).toEqual(credentials);
      expect(result.usedLegacy).toBe(true);
    });

    it("should handle legacy encrypted credentials string", () => {
      const credentials: TikTokCredentials = {
        pixelId: "pixel123",
        accessToken: "tiktok_token",
      };
      const encrypted = encryptJson(credentials);

      const pixelConfig: PixelConfigForCredentials = {
        credentialsEncrypted: null,
        credentials: encrypted,
        platform: "tiktok",
      };

      const result = getDecryptedCredentials(pixelConfig, "tiktok");

      expect(result.credentials).toEqual(credentials);
      expect(result.usedLegacy).toBe(true);
    });

    it("should return null credentials when no credentials available", () => {
      const pixelConfig: PixelConfigForCredentials = {
        credentialsEncrypted: null,
        credentials: undefined,
        platform: "google",
      };

      const result = getDecryptedCredentials(pixelConfig, "google");

      expect(result.credentials).toBeNull();
      expect(result.usedLegacy).toBe(false);
    });

    it("should return error when decryption fails", () => {
      const pixelConfig: PixelConfigForCredentials = {
        credentialsEncrypted: "invalid:encrypted:data",
        platform: "google",
      };

      const result = getDecryptedCredentials(pixelConfig, "google");

      expect(result.credentials).toBeNull();
      expect(result.error).toBeDefined();
    });

    it("should try legacy credentials when encrypted fails", () => {
      const credentials: GoogleCredentials = {
        measurementId: "G-XXXXXXXX",
        apiSecret: "secret123",
      };

      const pixelConfig: PixelConfigForCredentials = {
        credentialsEncrypted: "invalid:encrypted:data", // This will fail
        credentials: credentials, // Fallback to this
        platform: "google",
      };

      const result = getDecryptedCredentials(pixelConfig, "google");

      expect(result.credentials).toEqual(credentials);
      expect(result.usedLegacy).toBe(true);
    });
  });

  describe("validateCredentials", () => {
    it("should return invalid for null credentials", () => {
      const result = validateCredentials(null, "google");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("No credentials");
    });

    describe("Google credentials", () => {
      it("should validate complete Google credentials", () => {
        const credentials: GoogleCredentials = {
          measurementId: "G-XXXXXXXX",
          apiSecret: "secret123",
        };

        const result = validateCredentials(credentials, "google");

        expect(result.valid).toBe(true);
      });

      it("should reject missing measurementId", () => {
        const credentials = {
          apiSecret: "secret123",
        } as GoogleCredentials;

        const result = validateCredentials(credentials, "google");

        expect(result.valid).toBe(false);
        expect(result.error).toContain("measurementId");
      });

      it("should reject missing apiSecret", () => {
        const credentials = {
          measurementId: "G-XXXXXXXX",
        } as GoogleCredentials;

        const result = validateCredentials(credentials, "google");

        expect(result.valid).toBe(false);
        expect(result.error).toContain("apiSecret");
      });
    });

    describe("Meta credentials", () => {
      it("should validate complete Meta credentials", () => {
        const credentials: MetaCredentials = {
          pixelId: "123456789",
          accessToken: "token123",
        };

        const result = validateCredentials(credentials, "meta");

        expect(result.valid).toBe(true);
      });

      it("should reject missing pixelId", () => {
        const credentials = {
          accessToken: "token123",
        } as MetaCredentials;

        const result = validateCredentials(credentials, "meta");

        expect(result.valid).toBe(false);
        expect(result.error).toContain("pixelId");
      });
    });

    describe("TikTok credentials", () => {
      it("should validate complete TikTok credentials", () => {
        const credentials: TikTokCredentials = {
          pixelId: "pixel123",
          accessToken: "tiktok_token",
        };

        const result = validateCredentials(credentials, "tiktok");

        expect(result.valid).toBe(true);
      });

      it("should reject missing pixelCode", () => {
        const credentials = {
          accessToken: "tiktok_token",
        } as unknown as TikTokCredentials;

        const result = validateCredentials(credentials, "tiktok");

        expect(result.valid).toBe(false);
        expect(result.error).toContain("pixelCode");
      });
    });
  });

  describe("getValidatedCredentials", () => {
    it("should return credentials when valid", () => {
      const credentials: GoogleCredentials = {
        measurementId: "G-XXXXXXXX",
        apiSecret: "secret123",
      };
      const encrypted = encryptJson(credentials);

      const pixelConfig: PixelConfigForCredentials = {
        credentialsEncrypted: encrypted,
        platform: "google",
      };

      const result = getValidatedCredentials(pixelConfig, "google");

      expect(result.credentials).toEqual(credentials);
      expect(result.error).toBeUndefined();
    });

    it("should return error when decryption fails", () => {
      const pixelConfig: PixelConfigForCredentials = {
        credentialsEncrypted: "invalid",
        platform: "google",
      };

      const result = getValidatedCredentials(pixelConfig, "google");

      expect(result.credentials).toBeNull();
      expect(result.error).toBeDefined();
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

      const result = getValidatedCredentials(pixelConfig, "google");

      expect(result.credentials).toBeNull();
      expect(result.error).toContain("apiSecret");
    });
  });
});

