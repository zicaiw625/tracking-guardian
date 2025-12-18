import { describe, it, expect } from "vitest";
import {
  encrypt,
  decrypt,
  encryptJson,
  decryptJson,
  hashValue,
  normalizePhone,
  normalizeEmail,
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
});
