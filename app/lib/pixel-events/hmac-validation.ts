import { createHmac, timingSafeEqual } from "crypto";
import { logger } from "../../utils/logger.server";

/**
 * HMAC Signature Generation and Verification
 *
 * SECURITY NOTE / THREAT MODEL:
 * The ingestion_key used to generate this HMAC is distributed to the client-side (Web Pixel Extension).
 * Therefore, this HMAC primarily serves as an INTEGRITY check and rate-limiting helper, not as a strong
 * authentication mechanism against a determined attacker who can extract the key from the client.
 *
 * Trust Level:
 * - "trusted": Payload integrity verified, originated from a client with the key.
 * - "untrusted": Signature missing or invalid.
 *
 * For strong proof of purchase, server-side reconciliation with Shopify Orders (via Webhooks/Admin API)
 * is required (planned for v1.1+).
 */

const HMAC_ALGORITHM = "sha256";
const HMAC_HEADER = "X-Tracking-Guardian-Signature";
const TIMESTAMP_HEADER = "X-Tracking-Guardian-Timestamp";

export interface HMACValidationResult {
  valid: boolean;
  reason?: string;
  errorCode?: "missing_signature" | "invalid_signature" | "timestamp_out_of_window" | "missing_timestamp_header" | "timestamp_mismatch";
  trustLevel?: "trusted" | "partial" | "untrusted";
}

interface HMACInput {
  signature: string | null;
  timestamp: number | null;
  shopDomain: string;
  source: "header" | "body" | "none";
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

function extractTimestampFromBody(bodyData: unknown): number | null {
  if (!bodyData || typeof bodyData !== "object") {
    return null;
  }
  const candidate = (bodyData as Record<string, unknown>).signatureTimestamp;
  if (typeof candidate === "number" && Number.isInteger(candidate)) {
    return candidate;
  }
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    const parsed = parseInt(candidate, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function extractSignatureFromBody(bodyData: unknown): string | null {
  if (!bodyData || typeof bodyData !== "object") {
    return null;
  }
  const signature = (bodyData as Record<string, unknown>).signature;
  if (typeof signature !== "string") {
    return null;
  }
  const normalized = signature.trim();
  return normalized.length > 0 ? normalized : null;
}

function extractShopDomainFromBody(bodyData: unknown): string | null {
  if (!bodyData || typeof bodyData !== "object") {
    return null;
  }
  const shopDomain = (bodyData as Record<string, unknown>).signatureShopDomain;
  if (typeof shopDomain !== "string") {
    return null;
  }
  const normalized = shopDomain.trim();
  return normalized.length > 0 ? normalized : null;
}

function extractHMACInput(
  request: Request,
  payloadTimestamp: number,
  payloadShopDomain: string,
  bodyData?: unknown
): HMACInput {
  const headerSignature = extractHMACSignature(request);
  if (headerSignature) {
    return {
      signature: headerSignature,
      timestamp: extractTimestampHeader(request),
      shopDomain: payloadShopDomain,
      source: "header",
    };
  }
  const bodySignature = extractSignatureFromBody(bodyData);
  if (bodySignature) {
    return {
      signature: bodySignature,
      timestamp: extractTimestampFromBody(bodyData) ?? payloadTimestamp,
      shopDomain: extractShopDomainFromBody(bodyData) ?? payloadShopDomain,
      source: "body",
    };
  }
  return {
    signature: null,
    timestamp: null,
    shopDomain: payloadShopDomain,
    source: "none",
  };
}

export async function validatePixelEventHMAC(
  request: Request,
  bodyHash: string,
  token: string,
  shopDomain: string,
  payloadTimestamp: number,
  timestampWindowMs: number,
  bodyData?: unknown
): Promise<HMACValidationResult> {
  const hmacInput = extractHMACInput(request, payloadTimestamp, shopDomain, bodyData);
  if (!hmacInput.signature) {
    return {
      valid: false,
      reason: "Missing HMAC signature",
      errorCode: "missing_signature",
      trustLevel: "untrusted",
    };
  }
  if (hmacInput.timestamp === null) {
    return {
      valid: false,
      reason: "Missing signature timestamp",
      errorCode: "missing_timestamp_header",
      trustLevel: "untrusted",
    };
  }
  if (hmacInput.source === "header" && hmacInput.timestamp !== payloadTimestamp) {
    return {
      valid: false,
      reason: `Timestamp mismatch: header=${hmacInput.timestamp}, payload=${payloadTimestamp}`,
      errorCode: "timestamp_mismatch",
      trustLevel: "untrusted",
    };
  }
  if (hmacInput.source === "body" && hmacInput.shopDomain !== shopDomain) {
    return {
      valid: false,
      reason: `Shop domain mismatch: signature=${hmacInput.shopDomain}, payload=${shopDomain}`,
      errorCode: "invalid_signature",
      trustLevel: "untrusted",
    };
  }
  return verifyHMACSignature(
    hmacInput.signature,
    token,
    hmacInput.timestamp,
    hmacInput.shopDomain,
    bodyHash,
    timestampWindowMs
  );
}
