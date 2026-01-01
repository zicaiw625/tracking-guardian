import { jwtVerify, type JWTPayload } from "jose";
import { logger } from "./logger.server";

interface ShopifyJwtPayload extends JWTPayload {
    iss: string; // Shopify session token 必须包含 iss claim
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
 * 规范化主机名：提取纯域名（如 "store.myshopify.com"）
 * 
 * Shopify session token 的 dest claim 格式：
 * - 官方格式：纯域名 "store-name.myshopify.com"（不包含协议）
 * - 可能变体：完整 URL "https://store-name.myshopify.com"
 * 
 * 此函数确保兼容两种格式，并提取纯域名部分用于后续验证
 */
function normalizeHost(input: string): string {
    if (!input || typeof input !== "string") {
        throw new Error("Invalid host input");
    }
    // 移除可能的协议前缀（https:// 或 http://）
    // 移除路径部分（/admin 等）
    // 移除端口号（:443 等）
    // 最终只保留纯域名，例如："store-name.myshopify.com"
    const cleaned = input.replace(/^https?:\/\//, "").split("/")[0].split(":")[0].trim();
    if (!cleaned) {
        throw new Error("Invalid host format");
    }
    return cleaned;
}

/**
 * 规范化 issuer 字符串：移除可能的协议前缀和尖括号，保留完整路径
 * 
 * Shopify session token 的 iss claim 格式：
 * - 官方格式：纯字符串 "shop-name.myshopify.com/admin"（不包含 https:// 前缀和尖括号）
 * - 可能变体："https://shop-name.myshopify.com/admin" 或 "<shop-name.myshopify.com/admin>"
 * 
 * 此函数移除协议前缀和可能的尖括号，保留完整的路径部分用于验证
 */
function normalizeIssuer(input: string): string {
    if (!input || typeof input !== "string") {
        throw new Error("Invalid issuer input");
    }
    let result = input.trim();
    // 先移除可能的尖括号（文档标记格式，如 <shop-name.myshopify.com/admin>）
    if (result.startsWith("<") && result.endsWith(">")) {
        result = result.slice(1, -1).trim();
    }
    // 移除协议前缀（https:// 或 http://）
    result = result.replace(/^https?:\/\//, "").trim();
    // 例如："https://store.myshopify.com/admin" -> "store.myshopify.com/admin"
    // 或 "<store.myshopify.com/admin>" -> "store.myshopify.com/admin"
    return result;
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
        
        // 构建验证选项：aud 如果提供了则强制校验，iss 不在这里硬校验（在 verify 后手动检查）
        // 注意：我们不使用 jwtVerify 的 issuer 选项，因为 iss 格式是 <dest>/admin，需要先解析 dest 才能验证
        const verifyOptions: Parameters<typeof jwtVerify>[2] = {
            algorithms: ["HS256"],
            // 强制校验 audience（如果提供了 expectedAud）
            // 对于 Checkout UI Extension，expectedAud 应该是 SHOPIFY_API_KEY（即 app client id）
            ...(expectedAud ? { audience: expectedAud } : {}),
        };
        
        const { payload } = await jwtVerify(cleanToken, secret, verifyOptions);

        const shopifyPayload = payload as ShopifyJwtPayload;

        // 验证必要的字段：dest、aud 和 iss 都是必需的
        if (!shopifyPayload.dest || typeof shopifyPayload.dest !== "string") {
            return { valid: false, error: "Missing dest claim" };
        }
        
        if (!shopifyPayload.aud || typeof shopifyPayload.aud !== "string") {
            return { valid: false, error: "Missing aud claim" };
        }
        
        if (!shopifyPayload.iss || typeof shopifyPayload.iss !== "string") {
            return { valid: false, error: "Missing iss claim" };
        }
        
        // 验证时间相关字段
        if (shopifyPayload.exp === undefined || shopifyPayload.nbf === undefined || shopifyPayload.iat === undefined) {
            return { valid: false, error: "Missing required JWT time claims (exp, nbf, iat)" };
        }
        
        // 验证 jti（JWT ID）存在
        if (!shopifyPayload.jti) {
            return { valid: false, error: "Missing required JWT claim (jti)" };
        }

        // 规范化并提取 shop domain（dest 通常是纯域名，如 "store.myshopify.com"）
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

        // 手动校验 iss（issuer）格式：必须是 <dest>/admin
        // 
        // 重要：我们不使用 jwtVerify 的 issuer 选项，而是在这里手动检查，原因：
        // 1. Shopify 的 iss 格式是 <dest>/admin，需要先解析 dest 才能构建预期的 iss
        // 2. dest 可能是纯域名或完整 URL，需要先 normalize 才能正确比较
        // 3. Shopify 官方格式：iss = "<shop-name.myshopify.com/admin>"（不包含 https:// 前缀）
        //
        // 验证逻辑：
        // - 规范化 iss（移除可能的 https:// 前缀）
        // - 构建预期的 iss：${destHost}/admin
        // - 比较两者是否完全匹配
        try {
            const normalizedIss = normalizeIssuer(shopifyPayload.iss);
            const expectedIss = `${destHost}/admin`;
            
            if (normalizedIss !== expectedIss) {
                return {
                    valid: false,
                    error: `Issuer mismatch: expected ${expectedIss}, got ${normalizedIss}`,
                };
            }
        } catch (error) {
            return {
                valid: false,
                error: `Invalid issuer format: ${error instanceof Error ? error.message : String(error)}`,
            };
        }

        // 验证 shop domain 匹配（如果提供了 expectedShopDomain）
        if (expectedShopDomain && destHost !== expectedShopDomain) {
            return {
                valid: false,
                error: `Shop domain mismatch: expected ${expectedShopDomain}, got ${destHost}`,
            };
        }

        // 验证 aud（audience）- 必须匹配 app client id（SHOPIFY_API_KEY）
        //
        // Shopify session token 的 aud claim 就是 app client id（SHOPIFY_API_KEY）
        // 这是安全验证的关键部分，确保 token 是发给我们的应用的
        //
        // 注意：jwtVerify 中已经通过 audience 选项校验过了（第90行），
        // 这里再做一次明确校验以确保代码逻辑清晰，并在错误信息中提供更详细的上下文
        if (expectedAud && shopifyPayload.aud !== expectedAud) {
            return {
                valid: false,
                error: `Audience mismatch: expected ${expectedAud}, got ${shopifyPayload.aud}`,
            };
        }
        
        // 如果没有提供 expectedAud，但 aud 存在，仍然记录警告（生产环境应该始终提供 expectedAud）
        if (!expectedAud && shopifyPayload.aud) {
            logger.warn("JWT aud claim exists but expectedAud was not provided for verification");
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
