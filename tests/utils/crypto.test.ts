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
  resetEncryptionKeyCache,
  normalizeOrderId,
  generateEventId,
  generateMatchKey,
  matchKeysEqual,
  generateDeduplicationFingerprint,
} from "../../app/utils/crypto.server";

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

      expect(encrypted1).not.toBe(encrypted2);

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

    it("should return warnings when no encryption secret is set in development", () => {
      process.env.NODE_ENV = "development";
      delete process.env.ENCRYPTION_SECRET;
      delete process.env.DEV_ENCRYPTION_SECRET;

      const result = validateEncryptionConfig();

      expect(result.valid).toBe(true);
      expect(result.secretSource).toBe("fallback");
      expect(result.warnings.some(w => w.includes("No encryption secret configured"))).toBe(true);
    });

    it("should return warning for short ENCRYPTION_SECRET", () => {
      process.env.NODE_ENV = "development";
      process.env.ENCRYPTION_SECRET = "short-secret";

      const result = validateEncryptionConfig();

      expect(result.valid).toBe(true);
      expect(result.secretSource).toBe("ENCRYPTION_SECRET");
      expect(result.warnings.some(w => w.includes("shorter than recommended"))).toBe(true);
    });

    it("should use DEV_ENCRYPTION_SECRET in development when ENCRYPTION_SECRET not set", () => {
      process.env.NODE_ENV = "development";
      delete process.env.ENCRYPTION_SECRET;
      process.env.DEV_ENCRYPTION_SECRET = "a-dev-specific-secret-key-here-32";

      const result = validateEncryptionConfig();

      expect(result.valid).toBe(true);
      expect(result.secretSource).toBe("DEV_ENCRYPTION_SECRET");
    });

    it("should prefer ENCRYPTION_SECRET over DEV_ENCRYPTION_SECRET", () => {
      process.env.NODE_ENV = "development";
      process.env.ENCRYPTION_SECRET = "primary-secret-key-here-32-chars";
      process.env.DEV_ENCRYPTION_SECRET = "dev-secret-should-not-be-used";

      const result = validateEncryptionConfig();

      expect(result.valid).toBe(true);
      expect(result.secretSource).toBe("ENCRYPTION_SECRET");
    });

    it("should return no warnings when properly configured", () => {
      process.env.NODE_ENV = "development";
      process.env.ENCRYPTION_SECRET = "a-very-long-and-secure-secret-key-here";
      process.env.ENCRYPTION_SALT = "unique-salt-value";

      const result = validateEncryptionConfig();

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it("should warn for short DEV_ENCRYPTION_SECRET", () => {
      process.env.NODE_ENV = "development";
      delete process.env.ENCRYPTION_SECRET;
      process.env.DEV_ENCRYPTION_SECRET = "short";

      const result = validateEncryptionConfig();

      expect(result.valid).toBe(true);
      expect(result.secretSource).toBe("DEV_ENCRYPTION_SECRET");
      expect(result.warnings.some(w => w.includes("DEV_ENCRYPTION_SECRET") && w.includes("shorter"))).toBe(true);
    });

    it("should not use DEV_ENCRYPTION_SECRET in production", () => {
      process.env.NODE_ENV = "production";
      delete process.env.ENCRYPTION_SECRET;
      process.env.DEV_ENCRYPTION_SECRET = "dev-secret";

      expect(() => validateEncryptionConfig()).toThrow("ENCRYPTION_SECRET must be set in production");
    });
  });

  describe("encryption security", () => {
    it("should produce ciphertext longer than plaintext (includes IV and auth tag)", () => {
      const plaintext = "short";
      const encrypted = encrypt(plaintext);

      expect(encrypted.length).toBeGreaterThan(66);
    });

    it("should fail decryption with tampered ciphertext", () => {
      const plaintext = "sensitive data";
      const encrypted = encrypt(plaintext);

      const parts = encrypted.split(":");
      const tamperedCiphertext = parts[2].slice(0, -2) + "ff";
      const tampered = `${parts[0]}:${parts[1]}:${tamperedCiphertext}`;

      expect(() => decrypt(tampered)).toThrow();
    });

    it("should fail decryption with tampered auth tag", () => {
      const plaintext = "sensitive data";
      const encrypted = encrypt(plaintext);

      const parts = encrypted.split(":");
      const tamperedAuthTag = "00".repeat(16);
      const tampered = `${parts[0]}:${tamperedAuthTag}:${parts[2]}`;

      expect(() => decrypt(tampered)).toThrow();
    });
  });

  describe("normalizeOrderId", () => {
    it("should extract numeric ID from GID format", () => {
      expect(normalizeOrderId("gid://shopify/Order/12345")).toBe("12345");
      expect(normalizeOrderId("gid://shopify/Order/9876543210")).toBe("9876543210");
    });

    it("should handle plain numeric strings", () => {
      expect(normalizeOrderId("12345")).toBe("12345");
      expect(normalizeOrderId(12345)).toBe("12345");
    });

    it("should extract trailing numeric from mixed strings", () => {
      expect(normalizeOrderId("order_12345")).toBe("12345");
      expect(normalizeOrderId("prefix-99999")).toBe("99999");
    });

    it("should return original string if no numeric found", () => {
      expect(normalizeOrderId("abc")).toBe("abc");
    });
  });

  describe("generateEventId", () => {
    it("should generate consistent eventId for same inputs", () => {
      const eventId1 = generateEventId("12345", "purchase", "test.myshopify.com");
      const eventId2 = generateEventId("12345", "purchase", "test.myshopify.com");
      expect(eventId1).toBe(eventId2);
    });

    it("should generate different eventId for different orders", () => {
      const eventId1 = generateEventId("12345", "purchase", "test.myshopify.com");
      const eventId2 = generateEventId("99999", "purchase", "test.myshopify.com");
      expect(eventId1).not.toBe(eventId2);
    });

    it("should include orderId and eventType in output", () => {
      const eventId = generateEventId("12345", "purchase", "test.myshopify.com");
      expect(eventId).toContain("12345");
      expect(eventId).toContain("purchase");
    });
  });

  describe("generateMatchKey (P1-04)", () => {
    it("should use orderId when available", () => {
      const result = generateMatchKey({ orderId: "12345", checkoutToken: "token123" });
      expect(result.matchKey).toBe("12345");
      expect(result.isOrderId).toBe(true);
      expect(result.normalizedOrderId).toBe("12345");
      expect(result.checkoutToken).toBe("token123");
    });

    it("should normalize GID orderId", () => {
      const result = generateMatchKey({
        orderId: "gid://shopify/Order/12345",
        checkoutToken: null
      });
      expect(result.matchKey).toBe("12345");
      expect(result.isOrderId).toBe(true);
    });

    it("should fall back to checkoutToken when orderId is null", () => {
      const result = generateMatchKey({ orderId: null, checkoutToken: "token123" });
      expect(result.matchKey).toBe("token123");
      expect(result.isOrderId).toBe(false);
      expect(result.normalizedOrderId).toBeNull();
      expect(result.checkoutToken).toBe("token123");
    });

    it("should fall back to checkoutToken when orderId is empty string", () => {
      const result = generateMatchKey({ orderId: "", checkoutToken: "token456" });
      expect(result.matchKey).toBe("token456");
      expect(result.isOrderId).toBe(false);
    });

    it("should throw error when both orderId and checkoutToken are null", () => {
      expect(() => generateMatchKey({ orderId: null, checkoutToken: null }))
        .toThrow("Cannot generate match key");
    });

    it("should throw error when both orderId and checkoutToken are empty", () => {
      expect(() => generateMatchKey({ orderId: "", checkoutToken: "" }))
        .toThrow("Cannot generate match key");
    });
  });

  describe("matchKeysEqual (P1-04)", () => {
    it("should match when both have same orderId", () => {
      expect(matchKeysEqual(
        { orderId: "12345", checkoutToken: null },
        { orderId: "12345", checkoutToken: "different" }
      )).toBe(true);
    });

    it("should match normalized orderIds", () => {
      expect(matchKeysEqual(
        { orderId: "gid://shopify/Order/12345", checkoutToken: null },
        { orderId: "12345", checkoutToken: null }
      )).toBe(true);
    });

    it("should not match different orderIds", () => {
      expect(matchKeysEqual(
        { orderId: "12345", checkoutToken: null },
        { orderId: "99999", checkoutToken: null }
      )).toBe(false);
    });

    it("should match when both have same checkoutToken", () => {
      expect(matchKeysEqual(
        { orderId: null, checkoutToken: "token123" },
        { orderId: null, checkoutToken: "token123" }
      )).toBe(true);
    });

    it("should not match different checkoutTokens", () => {
      expect(matchKeysEqual(
        { orderId: null, checkoutToken: "token123" },
        { orderId: null, checkoutToken: "token456" }
      )).toBe(false);
    });

    it("should not match when one has orderId and other has only different checkoutToken", () => {
      expect(matchKeysEqual(
        { orderId: "12345", checkoutToken: null },
        { orderId: null, checkoutToken: "unrelated_token" }
      )).toBe(false);
    });
  });

  describe("generateDeduplicationFingerprint (P1-04)", () => {
    it("should generate consistent fingerprint", () => {
      const fp1 = generateDeduplicationFingerprint("shop1", "12345", "purchase");
      const fp2 = generateDeduplicationFingerprint("shop1", "12345", "purchase");
      expect(fp1).toBe(fp2);
    });

    it("should generate different fingerprints for different shops", () => {
      const fp1 = generateDeduplicationFingerprint("shop1", "12345", "purchase");
      const fp2 = generateDeduplicationFingerprint("shop2", "12345", "purchase");
      expect(fp1).not.toBe(fp2);
    });

    it("should generate 64-char hex string", () => {
      const fp = generateDeduplicationFingerprint("shop1", "12345", "purchase");
      expect(fp).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("resetEncryptionKeyCache", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      resetEncryptionKeyCache();
    });

    afterEach(() => {
      process.env = originalEnv;
      resetEncryptionKeyCache();
    });

    it("should allow re-initialization with different secret", () => {
      process.env.NODE_ENV = "development";
      process.env.ENCRYPTION_SECRET = "first-secret-key-32-characters-!";

      const encrypted1 = encrypt("test");

      resetEncryptionKeyCache();
      process.env.ENCRYPTION_SECRET = "second-secret-key-32-characters!";

      expect(() => decrypt(encrypted1)).toThrow();
    });

    it("should work after switching between ENCRYPTION_SECRET and DEV_ENCRYPTION_SECRET", () => {
      process.env.NODE_ENV = "development";
      process.env.ENCRYPTION_SECRET = "primary-secret-32-characters-!!";
      delete process.env.DEV_ENCRYPTION_SECRET;

      const encrypted1 = encrypt("test-primary");
      const decrypted1 = decrypt(encrypted1);
      expect(decrypted1).toBe("test-primary");

      resetEncryptionKeyCache();
      delete process.env.ENCRYPTION_SECRET;
      process.env.DEV_ENCRYPTION_SECRET = "dev-only-secret-32-characters-!";

      const encrypted2 = encrypt("test-dev");
      const decrypted2 = decrypt(encrypted2);
      expect(decrypted2).toBe("test-dev");

      expect(() => decrypt(encrypted1)).toThrow();
    });
  });

  describe("Edge cases", () => {
    it("should handle very long strings", () => {
      const longString = "x".repeat(10000);
      const encrypted = encrypt(longString);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(longString);
    });

    it("should handle unicode characters", () => {
      const unicode = "Hello 你好 مرحبا 🎉🚀";
      const encrypted = encrypt(unicode);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(unicode);
    });

    it("should handle JSON with nested arrays and objects", () => {
      const complex = {
        level1: {
          level2: {
            array: [1, 2, { nested: true }],
            nullValue: null,
            boolTrue: true,
            boolFalse: false,
          },
        },
        emptyArray: [],
        emptyObject: {},
      };

      const encrypted = encryptJson(complex);
      const decrypted = decryptJson<typeof complex>(encrypted);
      expect(decrypted).toEqual(complex);
    });

    it("should handle order IDs with leading zeros", () => {
      expect(normalizeOrderId("00012345")).toBe("00012345");
      expect(normalizeOrderId("gid://shopify/Order/00012345")).toBe("00012345");
    });

    it("should handle whitespace in emails", () => {
      expect(normalizeEmail("  user@example.com  ")).toBe("user@example.com");
      expect(normalizeEmail("\tuser@example.com\n")).toBe("user@example.com");
    });

    it("should handle international phone formats", () => {
      expect(normalizePhone("+86 138-0000-0000")).toBe("+8613800000000");
      expect(normalizePhone("+1 (555) 123-4567")).toBe("+15551234567");
      expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    });
  });
});
