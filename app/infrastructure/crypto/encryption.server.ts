/**
 * 加密服务 - 用于存储敏感数据（像素凭证、脚本片段等）
 * 
 * 这个服务是对 app/utils/crypto.server.ts 的包装，提供统一的接口
 * 用于加密存储 AuditAsset 的 rawSnippet 和其他敏感数据
 */

import { encrypt, decrypt, encryptJson, decryptJson } from "~/utils/crypto.server";

/**
 * 加密并存储原始脚本片段
 */
export function encryptRawSnippet(snippet: string): string {
  if (!snippet || snippet.trim().length === 0) {
    throw new Error("Cannot encrypt empty snippet");
  }
  return encrypt(snippet);
}

/**
 * 解密原始脚本片段
 */
export function decryptRawSnippet(encryptedSnippet: string | null | undefined): string | null {
  if (!encryptedSnippet) {
    return null;
  }
  try {
    return decrypt(encryptedSnippet);
  } catch (error) {
    console.error("Failed to decrypt raw snippet:", error);
    return null;
  }
}

/**
 * 加密像素凭证（JSON 对象）
 */
export function encryptPixelCredentials(credentials: Record<string, unknown>): string {
  return encryptJson(credentials);
}

/**
 * 解密像素凭证
 */
export function decryptPixelCredentials<T extends Record<string, unknown>>(
  encryptedCredentials: string | null | undefined
): T | null {
  if (!encryptedCredentials) {
    return null;
  }
  try {
    return decryptJson<T>(encryptedCredentials);
  } catch (error) {
    console.error("Failed to decrypt pixel credentials:", error);
    return null;
  }
}

/**
 * 加密任意敏感数据（字符串）
 */
export function encryptSensitiveData(data: string): string {
  return encrypt(data);
}

/**
 * 解密敏感数据
 */
export function decryptSensitiveData(encryptedData: string | null | undefined): string | null {
  if (!encryptedData) {
    return null;
  }
  try {
    return decrypt(encryptedData);
  } catch (error) {
    console.error("Failed to decrypt sensitive data:", error);
    return null;
  }
}

