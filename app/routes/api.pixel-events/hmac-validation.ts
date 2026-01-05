
import { createHmac, timingSafeEqual } from "crypto";
import { logger } from "../../utils/logger.server";
import type { KeyValidationResult } from "./types";

const HMAC_ALGORITHM = "sha256";
const HMAC_HEADER = "X-Tracking-Guardian-Signature";

export interface HMACValidationResult {
  valid: boolean;
  reason?: string;
  errorCode?: "missing_signature" | "invalid_signature" | "timestamp_out_of_window";
}

/**
 * P0: 生成 HMAC 签名（hex 格式）
 * 
 * 从 base64 改为 hex 格式，以匹配客户端使用 @noble/hashes 生成的签名。
 * hex 格式更简单，不需要 base64 编码/解码，且与 @noble/hashes 默认输出一致。
 */
export function generateHMACSignature(
  secret: string,
  timestamp: number,
  bodyHash: string
): string {
  const message = `${timestamp}:${bodyHash}`;
  const hmac = createHmac(HMAC_ALGORITHM, secret);
  hmac.update(message);
  return hmac.digest("hex");
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
    // P0: 使用 hex 格式进行签名验证，匹配客户端 @noble/hashes 的输出
    const signatureBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expectedSignature, "hex");

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
    logger.warn("HMAC signature verification error:", {
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : "Unknown",
    });
    return {
      valid: false,
      reason: "Invalid signature format (expected hex)",
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
 * ⚠️ 重要：HMAC 签名密钥（ingestionSecret）在客户端可见
 * 
 * ingestionSecret 通过 Web Pixel settings 下发到客户端，因此无法做到真正保密。
 * 此 HMAC 签名机制的主要目的是：
 * - 防误报/防跨店伪造：确保事件来自正确的店铺（通过 shopDomain 查找对应的 ingestionSecret）
 * - 基础抗滥用：配合 rate limiting 和异常检测防止恶意请求
 * - 防篡改：验证 payload 完整性
 * - 防重放：配合 nonce + timestamp 防止重放攻击
 * 
 * ⚠️ 这不是强安全边界，不要承诺"强防伪造"。
 * 
 * 真正的安全边界依赖于多层防护：
 * 1. HMAC 签名验证（X-Tracking-Guardian-Signature header）- 防误报/防跨店伪造
 * 2. Origin/Referrer 校验（确保请求来自 Shopify checkout 页面）
 * 3. Shopify 像素隐私加载机制（customer_privacy）确保只有授权的像素能运行
 * 4. Rate limiting 和异常检测（防止滥用）
 * 5. Nonce + timestamp 防重放攻击
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

