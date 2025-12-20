

import { createHmac } from "crypto";

interface ShopifyJwtPayload {
  
  iss: string;
  
  dest: string;
  
  aud: string;
  
  sub: string;
  
  exp: number;
  
  nbf: number;
  
  iat: number;
  
  jti: string;
  
  sid?: string;
}

interface VerificationResult {
  valid: boolean;
  payload?: ShopifyJwtPayload;
  error?: string;
  shopDomain?: string;
}

function base64UrlDecode(str: string): string {
  
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf8");
}

function verifySignature(
  headerAndPayload: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = createHmac("sha256", secret)
    .update(headerAndPayload)
    .digest("base64url");

  if (signature.length !== expectedSignature.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < signature.length; i++) {
    result |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
  }
  return result === 0;
}

function extractShopDomain(dest: string): string | null {
  try {
    const url = new URL(dest);
    return url.hostname;
  } catch {
    return null;
  }
}

export function verifyShopifyJwt(
  token: string,
  apiSecret: string,
  expectedShopDomain?: string
): VerificationResult {
  
  const cleanToken = token.startsWith("Bearer ")
    ? token.slice(7)
    : token;

  const parts = cleanToken.split(".");
  if (parts.length !== 3) {
    return { valid: false, error: "Invalid token format" };
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  const headerAndPayload = `${headerB64}.${payloadB64}`;
  if (!verifySignature(headerAndPayload, signatureB64, apiSecret)) {
    return { valid: false, error: "Invalid signature" };
  }

  let header: { alg: string; typ: string };
  try {
    header = JSON.parse(base64UrlDecode(headerB64));
  } catch {
    return { valid: false, error: "Invalid header" };
  }

  if (header.alg !== "HS256") {
    return { valid: false, error: `Unsupported algorithm: ${header.alg}` };
  }

  let payload: ShopifyJwtPayload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64));
  } catch {
    return { valid: false, error: "Invalid payload" };
  }

  const now = Math.floor(Date.now() / 1000);

  if (payload.exp < now - 5) {
    return { valid: false, error: "Token expired" };
  }

  if (payload.nbf > now + 5) {
    return { valid: false, error: "Token not yet valid" };
  }

  if (!payload.iss || !payload.iss.includes("shopify.com")) {
    return { valid: false, error: "Invalid issuer" };
  }

  const shopDomain = extractShopDomain(payload.dest);
  if (!shopDomain) {
    return { valid: false, error: "Invalid destination" };
  }

  if (expectedShopDomain && shopDomain !== expectedShopDomain) {
    return {
      valid: false,
      error: `Shop domain mismatch: expected ${expectedShopDomain}, got ${shopDomain}`,
    };
  }

  return {
    valid: true,
    payload,
    shopDomain,
  };
}

export function extractAuthToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return null;
  }

  if (authHeader.startsWith("Bearer ")) {
    return authHeader;
  }
  
  return authHeader;
}

export function getShopifyApiSecret(): string {
  const secret = process.env.SHOPIFY_API_SECRET;
  
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SHOPIFY_API_SECRET must be set in production");
    }
    
    console.warn(
      "⚠️ SHOPIFY_API_SECRET not set. JWT verification will fail. " +
      "Set SHOPIFY_API_SECRET environment variable."
    );
    return "development-secret-not-for-production";
  }
  
  return secret;
}
