import { jwtVerify, type JWTPayload } from "jose";
import { logger } from "./logger.server";

interface ShopifyJwtPayload extends JWTPayload {
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

function extractShopDomain(dest: string): string | null {
    try {
        const url = new URL(dest);
        return url.hostname;
    }
    catch {
        return null;
    }
}

export async function verifyShopifyJwt(
    token: string,
    apiSecret: string,
    expectedShopDomain?: string,
    expectedAud?: string
): Promise<VerificationResult> {
    const cleanToken = token.startsWith("Bearer ")
        ? token.slice(7)
        : token;

    try {
        // 使用 jose 库进行严格的 JWT 验证
        const secret = new TextEncoder().encode(apiSecret);
        
        const { payload } = await jwtVerify(cleanToken, secret, {
            algorithms: ["HS256"],
            // 严格校验 issuer - 必须是 shopify.com 域名
            issuer: (iss) => {
                if (!iss) return false;
                // 严格匹配 shopify.com 域名格式
                return /^https:\/\/[a-zA-Z0-9-]+\.shopify\.com\/?$/.test(iss) ||
                       iss === "https://shopify.com" ||
                       iss === "https://admin.shopify.com";
            },
            // 如果提供了 expectedAud，则严格校验
            audience: expectedAud || undefined,
        });

        const shopifyPayload = payload as ShopifyJwtPayload;

        // 验证必要的字段
        if (!shopifyPayload.iss || !shopifyPayload.dest || !shopifyPayload.aud) {
            return { valid: false, error: "Missing required JWT claims" };
        }

        // 提取 shop domain
        const shopDomain = extractShopDomain(shopifyPayload.dest);
        if (!shopDomain) {
            return { valid: false, error: "Invalid destination format" };
        }

        // 验证 shop domain 匹配
        if (expectedShopDomain && shopDomain !== expectedShopDomain) {
            return {
                valid: false,
                error: `Shop domain mismatch: expected ${expectedShopDomain}, got ${shopDomain}`,
            };
        }

        // 验证 aud（audience）- 应该是你的 API key
        if (expectedAud && shopifyPayload.aud !== expectedAud) {
            return {
                valid: false,
                error: `Audience mismatch: expected ${expectedAud}, got ${shopifyPayload.aud}`,
            };
        }

        return {
            valid: true,
            payload: shopifyPayload,
            shopDomain,
        };
    }
    catch (error) {
        if (error instanceof Error) {
            // jose 库会抛出详细的错误信息
            if (error.name === "JWTExpired") {
                return { valid: false, error: "Token expired" };
            }
            if (error.name === "JWTClaimValidationFailed") {
                return { valid: false, error: `Claim validation failed: ${error.message}` };
            }
            if (error.name === "JWTInvalid") {
                return { valid: false, error: `Invalid JWT: ${error.message}` };
            }
            return { valid: false, error: `JWT verification failed: ${error.message}` };
        }
        return { valid: false, error: "Unknown JWT verification error" };
    }
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
        logger.warn("⚠️ SHOPIFY_API_SECRET not set. JWT verification will fail.");
        return "development-secret-not-for-production";
    }
    return secret;
}
