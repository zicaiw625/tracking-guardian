import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  encrypt,
  decrypt,
  encryptJson,
  decryptJson,
  hashValue,
  normalizePhone,
  normalizeEmail,
  validateEncryptionConfig,
} from "../../app/utils/crypto";

describe("Crypto Utils", () => {
  describe("encrypt/decrypt", () => {
    it("should encrypt and decrypt a string correctly", () => {
      const plaintext = "Hello, World!";
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it("should produce different ciphertext for same plaintext", () => {
      const plaintext = "Test message";
      const encrypted1 = encrypt(plaintext);
      const encrypted2 = encrypt(plaintext);

      // Due to random IV, encrypted values should be different
      expect(encrypted1).not.toBe(encrypted2);

      // But both should decrypt to the same value
      expect(decrypt(encrypted1)).toBe(plaintext);
      expect(decrypt(encrypted2)).toBe(plaintext);
    });

    it("should handle empty string", () => {
      const plaintext = "";
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it("should handle special characters", () => {
      const plaintext = '{"key": "value", "special": "äöü!@#$%^&*()"}';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it("should throw error for invalid encrypted data format", () => {
      expect(() => decrypt("invalid-format")).toThrow("Invalid encrypted data format");
    });
  });

  describe("encryptJson/decryptJson", () => {
    it("should encrypt and decrypt JSON objects", () => {
      const data = {
        pixelId: "123456789",
        accessToken: "secret-token",
        nested: { key: "value" },
      };

      const encrypted = encryptJson(data);
      const decrypted = decryptJson<typeof data>(encrypted);

      expect(decrypted).toEqual(data);
    });

    it("should handle arrays in JSON", () => {
      const data = {
        items: [1, 2, 3],
        names: ["a", "b", "c"],
      };

      const encrypted = encryptJson(data);
      const decrypted = decryptJson<typeof data>(encrypted);

      expect(decrypted).toEqual(data);
    });
  });

  describe("hashValue", () => {
    it("should produce consistent hash for same input", async () => {
      const value = "test@example.com";
      const hash1 = await hashValue(value);
      const hash2 = await hashValue(value);

      expect(hash1).toBe(hash2);
    });

    it("should produce different hash for different input", async () => {
      const hash1 = await hashValue("test1@example.com");
      const hash2 = await hashValue("test2@example.com");

      expect(hash1).not.toBe(hash2);
    });

    it("should produce 64-character hex string", async () => {
      const hash = await hashValue("test");

      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("normalizePhone", () => {
    it("should remove non-numeric characters", () => {
      expect(normalizePhone("(123) 456-7890")).toBe("1234567890");
      expect(normalizePhone("123.456.7890")).toBe("1234567890");
      expect(normalizePhone("123 456 7890")).toBe("1234567890");
    });

    it("should preserve leading plus sign", () => {
      expect(normalizePhone("+1 (123) 456-7890")).toBe("+11234567890");
    });

    it("should handle already clean numbers", () => {
      expect(normalizePhone("1234567890")).toBe("1234567890");
    });
  });

  describe("normalizeEmail", () => {
    it("should lowercase and trim email", () => {
      expect(normalizeEmail("  Test@Example.COM  ")).toBe("test@example.com");
    });

    it("should handle already normalized email", () => {
      expect(normalizeEmail("test@example.com")).toBe("test@example.com");
    });
  });

  describe("validateEncryptionConfig", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should return warnings when ENCRYPTION_SECRET is not set in development", () => {
      process.env.NODE_ENV = "development";
      delete process.env.ENCRYPTION_SECRET;
      
      const result = validateEncryptionConfig();
      
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain("ENCRYPTION_SECRET not set - using insecure development default");
    });

    it("should return warning for short ENCRYPTION_SECRET", () => {
      process.env.NODE_ENV = "development";
      process.env.ENCRYPTION_SECRET = "short-secret";
      
      const result = validateEncryptionConfig();
      
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes("shorter than recommended"))).toBe(true);
    });

    it("should return no warnings when properly configured", () => {
      process.env.NODE_ENV = "development";
      process.env.ENCRYPTION_SECRET = "a-very-long-and-secure-secret-key-here";
      process.env.ENCRYPTION_SALT = "unique-salt-value";
      
      const result = validateEncryptionConfig();
      
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe("encryption security", () => {
    it("should produce ciphertext longer than plaintext (includes IV and auth tag)", () => {
      const plaintext = "short";
      const encrypted = encrypt(plaintext);
      
      // Encrypted format: iv(32 hex chars):authTag(32 hex chars):ciphertext
      // So minimum length should be 32 + 1 + 32 + 1 + some ciphertext
      expect(encrypted.length).toBeGreaterThan(66);
    });

    it("should fail decryption with tampered ciphertext", () => {
      const plaintext = "sensitive data";
      const encrypted = encrypt(plaintext);
      
      // Tamper with the ciphertext part
      const parts = encrypted.split(":");
      const tamperedCiphertext = parts[2].slice(0, -2) + "ff";
      const tampered = `${parts[0]}:${parts[1]}:${tamperedCiphertext}`;
      
      expect(() => decrypt(tampered)).toThrow();
    });

    it("should fail decryption with tampered auth tag", () => {
      const plaintext = "sensitive data";
      const encrypted = encrypt(plaintext);
      
      // Tamper with the auth tag
      const parts = encrypted.split(":");
      const tamperedAuthTag = "00".repeat(16);
      const tampered = `${parts[0]}:${tamperedAuthTag}:${parts[2]}`;
      
      expect(() => decrypt(tampered)).toThrow();
    });
  });
});
