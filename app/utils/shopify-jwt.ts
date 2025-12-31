import { jwtVerify, type JWTPayload } from "jose";
import { logger } from "./logger.server";

interface ShopifyJwtPayload extends JWTPayload {
    iss?: string;
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

/**
 * 规范化主机名：支持纯域名（如 "store.myshopify.com"）或完整 URL（如 "https://store.myshopify.com/admin"）
 * Checkout UI Extension 的 token claims 里 dest 通常是纯域名字符串，不是完整 URL
 * 
 * 此函数确保兼容两种格式：
 * - 纯域名："store.myshopify.com"
 * - 完整 URL："https://store.myshopify.com/admin"
 */
function normalizeHost(input: string): string {
    if (!input || typeof input !== "string") {
        throw new Error("Invalid host input");
    }
    // 先尝试作为完整 URL 解析
    try {
        return new URL(input).hostname;
    } catch {
        // 如果解析失败，说明是纯域名，直接提取（移除可能的协议前缀和路径）
        // 支持："store.myshopify.com" 或 "https://store.myshopify.com" 或 "store.myshopify.com/path"
        const cleaned = input.replace(/^https?:\/\//, "").split("/")[0].split(":")[0].trim();
        if (!cleaned) {
            throw new Error("Invalid host format");
        }
        return cleaned;
    }
}

/**
 * 提取顶级域名（简化版，用于 iss 和 dest 的一致性校验）
 * 例如："admin.shopify.com" -> "shopify.com", "store.myshopify.com" -> "myshopify.com"
 */
function topLevelDomain(host: string): string {
    const parts = host.split(".").filter(Boolean);
    return parts.slice(-2).join(".");
}

export async function verifyShopifyJwt(
    token: string,
    apiSecret: string,
    expectedShopDomain?: string,
    expectedAud?: string
): Promise<VerificationResult> {
    // 对于 Checkout UI Extension，expectedAud 是必需的（应该是 SHOPIFY_API_KEY）
    // 这是安全验证的关键部分，不应省略
    // 在生产环境中强制要求 expectedAud
    if (!expectedAud && process.env.NODE_ENV === "production") {
        return {
            valid: false,
            error: "expectedAud is required for JWT verification in production",
        };
    }
    if (!expectedAud) {
        logger.warn("verifyShopifyJwt called without expectedAud - this is insecure for production use");
    }
    
    const cleanToken = token.startsWith("Bearer ")
        ? token.slice(7)
        : token;

    try {
        // 使用 jose 库进行 JWT 验证
        const secret = new TextEncoder().encode(apiSecret);
        
        // 构建验证选项：aud 如果提供了则强制校验，iss 不在这里硬校验（改为下面可选校验）
        const verifyOptions: Parameters<typeof jwtVerify>[2] = {
            algorithms: ["HS256"],
            // 强制校验 audience（如果提供了 expectedAud）
            // 对于 Checkout UI Extension，expectedAud 应该是 SHOPIFY_API_KEY
            ...(expectedAud ? { audience: expectedAud } : {}),
        };
        
        const { payload } = await jwtVerify(cleanToken, secret, verifyOptions);

        const shopifyPayload = payload as ShopifyJwtPayload;

        // 验证必要的字段：dest 和 aud 是必需的（iss 可选）
        if (!shopifyPayload.dest || typeof shopifyPayload.dest !== "string") {
            return { valid: false, error: "Missing dest claim" };
        }
        
        if (!shopifyPayload.aud || typeof shopifyPayload.aud !== "string") {
            return { valid: false, error: "Missing aud claim" };
        }
        
        // 验证时间相关字段
        if (shopifyPayload.exp === undefined || shopifyPayload.nbf === undefined || shopifyPayload.iat === undefined) {
            return { valid: false, error: "Missing required JWT time claims (exp, nbf, iat)" };
        }
        
        // 验证 jti（JWT ID）存在
        if (!shopifyPayload.jti) {
            return { valid: false, error: "Missing required JWT claim (jti)" };
        }

        // 规范化并提取 shop domain（支持纯域名或完整 URL）
        let destHost: string;
        try {
            destHost = normalizeHost(shopifyPayload.dest);
        } catch (error) {
            return {
                valid: false,
                error: `Invalid destination format: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
        
        if (!destHost) {
            return { valid: false, error: "Invalid destination format" };
        }

        // iss 可能存在也可能没有：有则校验 top-level domain 一致性
        if (shopifyPayload.iss && typeof shopifyPayload.iss === "string") {
            let issHost: string | undefined;
            try {
                issHost = normalizeHost(shopifyPayload.iss);
            } catch (error) {
                // 如果 iss 解析失败，记录警告但继续（因为 iss 是可选的）
                logger.warn(`Failed to normalize issuer: ${error instanceof Error ? error.message : String(error)}`);
            }
            
            if (issHost) {
                const destTld = topLevelDomain(destHost);
                const issTld = topLevelDomain(issHost);
                
                if (destTld !== issTld) {
                    return {
                        valid: false,
                        error: `Issuer and dest top-level domains do not match: ${issTld} vs ${destTld}`,
                    };
                }
            }
        }

        // 验证 shop domain 匹配（如果提供了 expectedShopDomain）
        if (expectedShopDomain && destHost !== expectedShopDomain) {
            return {
                valid: false,
                error: `Shop domain mismatch: expected ${expectedShopDomain}, got ${destHost}`,
            };
        }

        // 验证 aud（audience）- 如果提供了 expectedAud，应该已经在 jwtVerify 中校验过了
        // 这里再做一次明确校验以确保一致性
        if (expectedAud && shopifyPayload.aud !== expectedAud) {
            return {
                valid: false,
                error: `Audience mismatch: expected ${expectedAud}, got ${shopifyPayload.aud}`,
            };
        }

        return {
            valid: true,
            payload: shopifyPayload,
            shopDomain: destHost,
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
/**
 * 从请求中提取认证 token（支持 Bearer token 格式）
 */
export function extractAuthToken(request: Request): string | null {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
        return null;
    }
    // 如果已经是 Bearer 格式，直接返回；否则添加 Bearer 前缀（虽然通常不会发生）
    if (authHeader.startsWith("Bearer ")) {
        return authHeader;
    }
    return `Bearer ${authHeader}`;
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
