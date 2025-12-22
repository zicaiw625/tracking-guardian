import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  encryptAccessToken,
  decryptAccessToken,
  isTokenEncrypted,
  ensureTokenEncrypted,
  encryptIngestionSecret,
  decryptIngestionSecret,
  generateEncryptedIngestionSecret,
  TokenDecryptionError,
  migrateToEncrypted,
  validateTokenEncryptionConfig,
} from "../../app/utils/token-encryption";

describe("Token Encryption Utils", () => {
  describe("encryptAccessToken/decryptAccessToken", () => {
    it("should encrypt and decrypt a token correctly", () => {
      const token = "shpat_1234567890abcdef";
      const encrypted = encryptAccessToken(token);
      const decrypted = decryptAccessToken(encrypted);

      expect(decrypted).toBe(token);
    });

    it("should produce versioned encrypted format", () => {
      const token = "shpat_test";
      const encrypted = encryptAccessToken(token);

      expect(encrypted.startsWith("v1:")).toBe(true);
    });

    it("should produce different ciphertext for same token", () => {
      const token = "shpat_same_token";
      const encrypted1 = encryptAccessToken(token);
      const encrypted2 = encryptAccessToken(token);

      expect(encrypted1).not.toBe(encrypted2);
      expect(decryptAccessToken(encrypted1)).toBe(token);
      expect(decryptAccessToken(encrypted2)).toBe(token);
    });

    it("should handle empty string", () => {
      expect(encryptAccessToken("")).toBe("");
      expect(decryptAccessToken("")).toBe("");
    });

    it("should return unencrypted legacy token as-is", () => {
      const legacyToken = "shpat_legacy_unencrypted";
      const result = decryptAccessToken(legacyToken);

      expect(result).toBe(legacyToken);
    });

    it("should throw TokenDecryptionError for invalid encrypted format", () => {
      const invalidEncrypted = "v1:invalid:format";

      expect(() => decryptAccessToken(invalidEncrypted)).toThrow(TokenDecryptionError);
    });

    it("should throw TokenDecryptionError for tampered ciphertext", () => {
      const token = "shpat_sensitive";
      const encrypted = encryptAccessToken(token);

      const parts = encrypted.split(":");
      const tamperedCiphertext = parts[3].slice(0, -2) + "ff";
      const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${tamperedCiphertext}`;

      expect(() => decryptAccessToken(tampered)).toThrow(TokenDecryptionError);
    });
  });

  describe("isTokenEncrypted", () => {
    it("should return true for encrypted tokens", () => {
      const encrypted = encryptAccessToken("shpat_test");
      expect(isTokenEncrypted(encrypted)).toBe(true);
    });

    it("should return false for unencrypted tokens", () => {
      expect(isTokenEncrypted("shpat_plain_token")).toBe(false);
    });

    it("should return false for null/undefined", () => {
      expect(isTokenEncrypted(null)).toBe(false);
      expect(isTokenEncrypted(undefined)).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(isTokenEncrypted("")).toBe(false);
    });
  });

  describe("ensureTokenEncrypted", () => {
    it("should encrypt unencrypted token", () => {
      const plain = "shpat_needs_encryption";
      const result = ensureTokenEncrypted(plain);

      expect(isTokenEncrypted(result)).toBe(true);
      expect(decryptAccessToken(result)).toBe(plain);
    });

    it("should return already encrypted token unchanged", () => {
      const encrypted = encryptAccessToken("shpat_already_encrypted");
      const result = ensureTokenEncrypted(encrypted);

      expect(result).toBe(encrypted);
    });

    it("should handle empty string", () => {
      expect(ensureTokenEncrypted("")).toBe("");
    });
  });

  describe("encryptIngestionSecret/decryptIngestionSecret", () => {
    it("should encrypt and decrypt ingestion secret", () => {
      const secret = "random-hex-secret-32chars-long";
      const encrypted = encryptIngestionSecret(secret);
      const decrypted = decryptIngestionSecret(encrypted);

      expect(decrypted).toBe(secret);
    });

    it("should return empty string for empty input", () => {
      expect(decryptIngestionSecret("")).toBe("");
    });

    it("should return empty string on decryption failure", () => {
      const result = decryptIngestionSecret("v1:invalid:encrypted:data");

      expect(result).toBe("");
    });
  });

  describe("generateEncryptedIngestionSecret", () => {
    it("should generate both plain and encrypted versions", () => {
      const result = generateEncryptedIngestionSecret();

      expect(result.plain).toBeDefined();
      expect(result.encrypted).toBeDefined();
      expect(result.plain.length).toBe(64); // 32 bytes = 64 hex chars
    });

    it("should produce valid encrypted secret", () => {
      const result = generateEncryptedIngestionSecret();

      expect(isTokenEncrypted(result.encrypted)).toBe(true);
      expect(decryptIngestionSecret(result.encrypted)).toBe(result.plain);
    });

    it("should generate unique secrets each time", () => {
      const result1 = generateEncryptedIngestionSecret();
      const result2 = generateEncryptedIngestionSecret();

      expect(result1.plain).not.toBe(result2.plain);
      expect(result1.encrypted).not.toBe(result2.encrypted);
    });
  });

  describe("migrateToEncrypted", () => {
    it("should return encrypted token for unencrypted input", () => {
      const plain = "shpat_needs_migration";
      const result = migrateToEncrypted(plain);

      expect(result).not.toBeNull();
      expect(isTokenEncrypted(result!)).toBe(true);
      expect(decryptAccessToken(result!)).toBe(plain);
    });

    it("should return null for already encrypted token", () => {
      const encrypted = encryptAccessToken("shpat_already_done");
      const result = migrateToEncrypted(encrypted);

      expect(result).toBeNull();
    });

    it("should return null for null/undefined input", () => {
      expect(migrateToEncrypted(null)).toBeNull();
      expect(migrateToEncrypted(undefined)).toBeNull();
    });
  });

  describe("validateTokenEncryptionConfig", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should return valid result when properly configured", () => {
      process.env.ENCRYPTION_SECRET = "a-very-long-and-secure-secret-key-here";
      process.env.ENCRYPTION_SALT = "unique-salt-value";

      const result = validateTokenEncryptionConfig();

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it("should return warning when ENCRYPTION_SECRET is short", () => {
      process.env.ENCRYPTION_SECRET = "short";

      const result = validateTokenEncryptionConfig();

      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes("shorter"))).toBe(true);
    });
  });

  describe("TokenDecryptionError", () => {
    it("should have correct name property", () => {
      const error = new TokenDecryptionError("Test error");

      expect(error.name).toBe("TokenDecryptionError");
      expect(error.message).toBe("Test error");
    });

    it("should preserve cause option", () => {
      const cause = new Error("Original error");
      const error = new TokenDecryptionError("Wrapped error", { cause });

      expect(error.cause).toBe(cause);
    });
  });
});

