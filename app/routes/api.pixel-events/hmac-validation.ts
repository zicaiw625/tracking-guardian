
import { createHmac, timingSafeEqual } from "crypto";
import { logger } from "../../utils/logger.server";
import type { KeyValidationResult } from "./key-validation";

const HMAC_ALGORITHM = "sha256";
const HMAC_HEADER = "X-Tracking-Guardian-Signature";

export interface HMACValidationResult {
  valid: boolean;
  reason?: string;
  errorCode?: "missing_signature" | "invalid_signature" | "timestamp_out_of_window";
}

export function generateHMACSignature(
  secret: string,
  timestamp: number,
  bodyHash: string
): string {
  const message = `${timestamp}:${bodyHash}`;
  const hmac = createHmac(HMAC_ALGORITHM, secret);
  hmac.update(message);
  return hmac.digest("base64");
}

export function verifyHMACSignature(
  signature: string | null,
  secret: string,
  timestamp: number,
  bodyHash: string,
  timestampWindowMs: number = 5 * 60 * 1000
): HMACValidationResult {
  if (!signature) {
    return {
      valid: false,
      reason: "Missing HMAC signature",
      errorCode: "missing_signature",
    };
  }

  const now = Date.now();
  const timeDiff = Math.abs(now - timestamp);
  if (timeDiff > timestampWindowMs) {
    return {
      valid: false,
      reason: `Timestamp outside window: ${timeDiff}ms (max: ${timestampWindowMs}ms)`,
      errorCode: "timestamp_out_of_window",
    };
  }

  const expectedSignature = generateHMACSignature(secret, timestamp, bodyHash);

  try {
    const signatureBuffer = Buffer.from(signature, "base64");
    const expectedBuffer = Buffer.from(expectedSignature, "base64");

    if (signatureBuffer.length !== expectedBuffer.length) {
      return {
        valid: false,
        reason: "Invalid signature length",
        errorCode: "invalid_signature",
      };
    }

    if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return {
        valid: false,
        reason: "HMAC signature mismatch",
        errorCode: "invalid_signature",
      };
    }

    return { valid: true };
  } catch (error) {
    logger.warn("HMAC signature verification error:", error);
    return {
      valid: false,
      reason: "Invalid signature format",
      errorCode: "invalid_signature",
    };
  }
}

export function extractHMACSignature(request: Request): string | null {
  return request.headers.get(HMAC_HEADER);
}

/**
 * P0-1/P0-4: 安全模型说明
 * 
 * ingestionSecret (secret 参数) 用于生成 HMAC 签名，不直接出现在请求体中。
 * 客户端使用 ingestionSecret 生成签名，服务端通过 shopDomain 查找对应的 ingestionSecret 进行验证。
 * 
 * 真正的安全边界依赖于：
 * 1. HMAC 签名验证（X-Tracking-Guardian-Signature header）- 主要验证机制
 * 2. Origin/Referrer 校验（确保请求来自 Shopify checkout 页面）
 * 3. Shopify 像素隐私加载机制（customer_privacy）确保只有授权的像素能运行
 * 4. Rate limiting 和异常检测（防止滥用）
 * 5. Nonce + timestamp 防重放攻击
 * 
 * HMAC 签名主要用于：
 * - 防篡改（验证 payload 完整性）
 * - 关联店铺（通过 shopDomain 查找对应的 ingestionSecret 进行验证）
 * - 配合 nonce/timestamp 防重放
 * 
 * 注意：客户端不再在请求体中发送 ingestionKey，服务端完全依赖 HMAC 签名验证。
 */
export async function validatePixelEventHMAC(
  request: Request,
  bodyText: string,
  secret: string,
  timestamp: number,
  timestampWindowMs: number = 5 * 60 * 1000
): Promise<HMACValidationResult> {
  const signature = extractHMACSignature(request);

  if (!signature) {

    return {
      valid: false,
      reason: "Missing HMAC signature header",
      errorCode: "missing_signature",
    };
  }

  const crypto = await import("crypto");
  const bodyHash = crypto.createHash("sha256").update(bodyText).digest("hex");

  return verifyHMACSignature(signature, secret, timestamp, bodyHash, timestampWindowMs);
}

