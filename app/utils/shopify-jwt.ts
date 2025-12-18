/**
 * Shopify Session Token (JWT) Verification
 * 
 * Verifies JWT tokens from Shopify Checkout UI Extensions
 * Based on: https://shopify.dev/docs/api/checkout-extensions/jwt-specification
 */

import { createHmac } from "crypto";

interface ShopifyJwtPayload {
  /** Issuer - Shopify's domain */
  iss: string;
  /** Destination - The shop's myshopify domain */
  dest: string;
  /** Audience - The app's API key */
  aud: string;
  /** Subject - Shop ID (GID format) */
  sub: string;
  /** Expiration time */
  exp: number;
  /** Not before time */
  nbf: number;
  /** Issued at time */
  iat: number;
  /** JWT ID */
  jti: string;
  /** Session ID */
  sid?: string;
}

interface VerificationResult {
  valid: boolean;
  payload?: ShopifyJwtPayload;
  error?: string;
  shopDomain?: string;
}

/**
 * Base64 URL decode (handles padding)
 */
function base64UrlDecode(str: string): string {
  // Add padding if needed
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  // Replace URL-safe characters
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf8");
}

/**
 * Verify HMAC-SHA256 signature
 */
function verifySignature(
  headerAndPayload: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = createHmac("sha256", secret)
    .update(headerAndPayload)
    .digest("base64url");
  
  // Timing-safe comparison to prevent timing attacks
  if (signature.length !== expectedSignature.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < signature.length; i++) {
    result |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Extract shop domain from JWT dest claim
 * The dest claim format is: https://shop-name.myshopify.com
 */
function extractShopDomain(dest: string): string | null {
  try {
    const url = new URL(dest);
    return url.hostname;
  } catch {
    return null;
  }
}

/**
 * Verify a Shopify session token (JWT)
 * 
 * @param token - The JWT token from Authorization header
 * @param apiSecret - The Shopify API secret key
 * @param expectedShopDomain - Optional: verify against expected shop domain
 * @returns Verification result with payload if valid
 */
export function verifyShopifyJwt(
  token: string,
  apiSecret: string,
  expectedShopDomain?: string
): VerificationResult {
  // Remove "Bearer " prefix if present
  const cleanToken = token.startsWith("Bearer ")
    ? token.slice(7)
    : token;

  // Split the token
  const parts = cleanToken.split(".");
  if (parts.length !== 3) {
    return { valid: false, error: "Invalid token format" };
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Verify signature first (before parsing payload to prevent attacks)
  const headerAndPayload = `${headerB64}.${payloadB64}`;
  if (!verifySignature(headerAndPayload, signatureB64, apiSecret)) {
    return { valid: false, error: "Invalid signature" };
  }

  // Parse header
  let header: { alg: string; typ: string };
  try {
    header = JSON.parse(base64UrlDecode(headerB64));
  } catch {
    return { valid: false, error: "Invalid header" };
  }

  // Verify algorithm
  if (header.alg !== "HS256") {
    return { valid: false, error: `Unsupported algorithm: ${header.alg}` };
  }

  // Parse payload
  let payload: ShopifyJwtPayload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64));
  } catch {
    return { valid: false, error: "Invalid payload" };
  }

  const now = Math.floor(Date.now() / 1000);

  // Verify expiration (with 5 second leeway for clock skew)
  if (payload.exp < now - 5) {
    return { valid: false, error: "Token expired" };
  }

  // Verify not before (with 5 second leeway)
  if (payload.nbf > now + 5) {
    return { valid: false, error: "Token not yet valid" };
  }

  // Verify issuer (must be from Shopify)
  if (!payload.iss || !payload.iss.includes("shopify.com")) {
    return { valid: false, error: "Invalid issuer" };
  }

  // Extract shop domain from dest
  const shopDomain = extractShopDomain(payload.dest);
  if (!shopDomain) {
    return { valid: false, error: "Invalid destination" };
  }

  // Verify shop domain matches if provided
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

/**
 * Extract Authorization header from request
 * @returns Token string or null if not present
 */
export function extractAuthToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return null;
  }
  
  // Support both "Bearer token" and raw token
  if (authHeader.startsWith("Bearer ")) {
    return authHeader;
  }
  
  return authHeader;
}

/**
 * Get Shopify API secret from environment
 * Throws in production if not set
 */
export function getShopifyApiSecret(): string {
  const secret = process.env.SHOPIFY_API_SECRET;
  
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SHOPIFY_API_SECRET must be set in production");
    }
    // Development fallback - should match your partner dashboard
    console.warn(
      "⚠️ SHOPIFY_API_SECRET not set. JWT verification will fail. " +
      "Set SHOPIFY_API_SECRET environment variable."
    );
    return "development-secret-not-for-production";
  }
  
  return secret;
}
