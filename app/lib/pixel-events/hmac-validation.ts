import { createHmac, timingSafeEqual } from "crypto";
import { logger } from "../../utils/logger.server";

const HMAC_ALGORITHM = "sha256";
const HMAC_HEADER = "X-Tracking-Guardian-Signature";
const TIMESTAMP_HEADER = "X-Tracking-Guardian-Timestamp";

export interface HMACValidationResult {
  valid: boolean;
  reason?: string;
  errorCode?: "missing_signature" | "invalid_signature" | "timestamp_out_of_window" | "missing_timestamp_header" | "timestamp_mismatch";
  trustLevel?: "trusted" | "partial" | "untrusted";
}

export function generateHMACSignature(
  token: string,
  timestamp: number,
  shopDomain: string,
  bodyHash: string
): string {
  const message = `${timestamp}:${shopDomain}:${bodyHash}`;
  const hmac = createHmac(HMAC_ALGORITHM, token);
  hmac.update(message);
  return hmac.digest("hex");
}

export function verifyHMACSignature(
  signature: string | null,
  token: string,
  timestamp: number,
  shopDomain: string,
  bodyHash: string,
  timestampWindowMs: number
): HMACValidationResult {
  if (!signature) {
    return {
      valid: false,
      reason: "Missing HMAC signature",
      errorCode: "missing_signature",
      trustLevel: "untrusted",
    };
  }
  if (signature.length > 256 || !/^[0-9a-f]+$/i.test(signature)) {
    return {
      valid: false,
      reason: "Invalid signature format",
      errorCode: "invalid_signature",
      trustLevel: "untrusted",
    };
  }
  const now = Date.now();
  const timeDiff = Math.abs(now - timestamp);
  if (timeDiff > timestampWindowMs) {
    return {
      valid: false,
      reason: `Timestamp outside window: ${timeDiff}ms (max: ${timestampWindowMs}ms)`,
      errorCode: "timestamp_out_of_window",
      trustLevel: "untrusted",
    };
  }
  const expectedSignature = generateHMACSignature(token, timestamp, shopDomain, bodyHash);
  try {
    const signatureBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expectedSignature, "hex");
    if (signatureBuffer.length !== expectedBuffer.length) {
      return {
        valid: false,
        reason: "Invalid signature length",
        errorCode: "invalid_signature",
        trustLevel: "untrusted",
      };
    }
    if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return {
        valid: false,
        reason: "HMAC signature mismatch",
        errorCode: "invalid_signature",
        trustLevel: "untrusted",
      };
    }
    return { valid: true, trustLevel: "trusted" };
  } catch (error) {
    logger.warn("HMAC signature verification error:", {
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : "Unknown",
    });
    return {
      valid: false,
      reason: "Invalid signature format (expected hex)",
      errorCode: "invalid_signature",
      trustLevel: "untrusted",
    };
  }
}

export function extractHMACSignature(request: Request): string | null {
  return request.headers.get(HMAC_HEADER);
}

export function extractTimestampHeader(request: Request): number | null {
  const timestampHeader = request.headers.get(TIMESTAMP_HEADER);
  if (!timestampHeader) {
    return null;
  }
  const timestamp = parseInt(timestampHeader, 10);
  if (isNaN(timestamp)) {
    return null;
  }
  return timestamp;
}

export async function validatePixelEventHMAC(
  request: Request,
  bodyHash: string,
  token: string,
  shopDomain: string,
  payloadTimestamp: number,
  timestampWindowMs: number
): Promise<HMACValidationResult> {
  const signature = extractHMACSignature(request);
  if (!signature) {
    return {
      valid: false,
      reason: "Missing HMAC signature header",
      errorCode: "missing_signature",
      trustLevel: "untrusted",
    };
  }
  const headerTimestamp = extractTimestampHeader(request);
  if (headerTimestamp === null) {
    return {
      valid: false,
      reason: "Missing timestamp header",
      errorCode: "missing_timestamp_header",
      trustLevel: "untrusted",
    };
  }
  if (headerTimestamp !== payloadTimestamp) {
    return {
      valid: false,
      reason: `Timestamp mismatch: header=${headerTimestamp}, payload=${payloadTimestamp}`,
      errorCode: "timestamp_mismatch",
      trustLevel: "untrusted",
    };
  }
  // bodyHash is now pre-calculated and passed in
  return verifyHMACSignature(signature, token, headerTimestamp, shopDomain, bodyHash, timestampWindowMs);
}
