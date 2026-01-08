import { encrypt, decrypt, encryptJson, decryptJson } from "~/utils/crypto.server";
import { logger } from "~/utils/logger.server";

export function encryptRawSnippet(snippet: string): string {
  if (!snippet || snippet.trim().length === 0) {
    throw new Error("Cannot encrypt empty snippet");
  }
  return encrypt(snippet);
}

export function decryptRawSnippet(encryptedSnippet: string | null | undefined): string | null {
  if (!encryptedSnippet) {
    return null;
  }
  try {
    return decrypt(encryptedSnippet);
  } catch (error) {
    logger.error("Failed to decrypt raw snippet", error);
    return null;
  }
}

export function encryptPixelCredentials(credentials: Record<string, unknown>): string {
  return encryptJson(credentials);
}

export function decryptPixelCredentials<T extends Record<string, unknown>>(
  encryptedCredentials: string | null | undefined
): T | null {
  if (!encryptedCredentials) {
    return null;
  }
  try {
    return decryptJson<T>(encryptedCredentials);
  } catch (error) {
    logger.error("Failed to decrypt pixel credentials", error);
    return null;
  }
}

export function encryptSensitiveData(data: string): string {
  return encrypt(data);
}

export function decryptSensitiveData(encryptedData: string | null | undefined): string | null {
  if (!encryptedData) {
    return null;
  }
  try {
    return decrypt(encryptedData);
  } catch (error) {
    logger.error("Failed to decrypt sensitive data", error);
    return null;
  }
}
