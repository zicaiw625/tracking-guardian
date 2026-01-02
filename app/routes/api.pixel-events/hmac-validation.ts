
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

