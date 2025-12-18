// Cryptographic utilities for secure credential storage
// Uses AES-256-GCM for encryption with proper key derivation

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

// Get encryption key from environment variable or generate a default for development
const getEncryptionKey = (): Buffer => {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) {
    console.warn(
      "⚠️ ENCRYPTION_SECRET not set. Using default key for development only."
    );
    // In production, this should fail or use a secure default
    if (process.env.NODE_ENV === "production") {
      throw new Error("ENCRYPTION_SECRET must be set in production");
    }
    return scryptSync("default-dev-secret-do-not-use-in-production", "salt", 32);
  }
  // Derive a 256-bit key from the secret
  return scryptSync(secret, "tracking-guardian-salt", 32);
};

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypts sensitive data using AES-256-GCM
 * @param plaintext - The data to encrypt
 * @returns Base64-encoded encrypted string (iv:authTag:ciphertext)
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all in hex)
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts data encrypted with the encrypt function
 * @param encryptedData - The encrypted string (iv:authTag:ciphertext)
 * @returns The original plaintext
 */
export function decrypt(encryptedData: string): string {
  const key = getEncryptionKey();
  const parts = encryptedData.split(":");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format");
  }

  const [ivHex, authTagHex, ciphertext] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Encrypts a JSON object
 * @param data - Object to encrypt
 * @returns Base64-encoded encrypted string
 */
export function encryptJson<T extends object>(data: T): string {
  return encrypt(JSON.stringify(data));
}

/**
 * Decrypts and parses a JSON object
 * @param encryptedData - Encrypted string
 * @returns The original object
 */
export function decryptJson<T extends object>(encryptedData: string): T {
  const jsonString = decrypt(encryptedData);
  return JSON.parse(jsonString) as T;
}

/**
 * SHA-256 hash function for PII data (email, phone, etc.)
 * Used for sending hashed data to ad platforms
 */
export async function hashValue(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Normalizes a phone number by removing all non-numeric characters
 * @param phone - Phone number string
 * @returns Normalized phone number
 */
export function normalizePhone(phone: string): string {
  // Remove all non-numeric characters except leading +
  return phone.replace(/[^\d+]/g, "");
}

/**
 * Normalizes an email address for hashing
 * @param email - Email address
 * @returns Normalized email (lowercase, trimmed)
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}
