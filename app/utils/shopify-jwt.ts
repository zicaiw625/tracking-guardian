import { jwtVerify, type JWTPayload } from "jose";
import { logger } from "./logger.server";

interface ShopifyJwtPayload extends JWTPayload {
    iss?: string; // Shopify session token 的 iss claim 是可选的：Checkout UI extensions 可能没有，Embedded Admin App 通常有
    dest: string;
    aud: string;
    sub?: string; // sub claim 也是可选的（customer gid），仅在登录用户时存在
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
 * Shopify session token 的 dest claim 格式（根据官方文档）：
 * - 标准格式：纯域名 "store-name.myshopify.com"（不包含协议，这是标准格式）
 * - 可能变体：完整 URL "https://store-name.myshopify.com"（某些实现可能包含）
 * 
 * 此函数确保兼容两种格式，并提取纯域名部分用于后续验证
 * 重要：Shopify 官方文档明确说明 dest 是纯域名格式，不包含 https://
 * 
 * 注意：不要使用 new URL() 解析，因为 dest 可能是纯域名格式（没有 scheme）
 * 如果使用 new URL() 解析纯域名会抛出错误
 * 
 * 修复说明（P0-1）：
 * - 兼容 "store.myshopify.com" 和 "https://store.myshopify.com" 两种格式
 * - 不使用 new URL() 解析，避免对纯域名格式抛出错误
 */
function normalizeHost(input: string): string {
    if (!input || typeof input !== "string") {
        throw new Error("Invalid host input");
    }
    
    let cleaned = input.trim();
    
    // 移除可能的协议前缀（https:// 或 http://）
    cleaned = cleaned.replace(/^https?:\/\//i, "");
    
    // 移除路径部分（/admin 等）
    const pathIndex = cleaned.indexOf("/");
    if (pathIndex !== -1) {
        cleaned = cleaned.substring(0, pathIndex);
    }
    
    // 移除查询参数和锚点（虽然通常不会出现在这里，但为了安全）
    const queryIndex = cleaned.indexOf("?");
    if (queryIndex !== -1) {
        cleaned = cleaned.substring(0, queryIndex);
    }
    const hashIndex = cleaned.indexOf("#");
    if (hashIndex !== -1) {
        cleaned = cleaned.substring(0, hashIndex);
    }
    
    // 移除端口号（:443 等）
    const portIndex = cleaned.indexOf(":");
    if (portIndex !== -1) {
        cleaned = cleaned.substring(0, portIndex);
    }
    
    cleaned = cleaned.trim();
    
    // 验证结果：必须是有效的域名格式（至少包含一个点）
    if (!cleaned || !cleaned.includes(".")) {
        throw new Error(`Invalid host format: expected domain like "store.myshopify.com", got "${input}"`);
    }
    
    // 确保是 myshopify.com 域名（Shopify 商店域名）
    if (!cleaned.endsWith(".myshopify.com") && cleaned !== "myshopify.com") {
        // 允许其他格式，但记录警告（可能是开发环境）
        logger.warn(`Non-standard shop domain format: ${cleaned}`);
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

        // 验证必要的字段：dest、aud 是必需的，iss 是可选的（Checkout UI extensions 可能没有 iss）
        if (!shopifyPayload.dest || typeof shopifyPayload.dest !== "string") {
            return { valid: false, error: "Missing dest claim" };
        }
        
        if (!shopifyPayload.aud || typeof shopifyPayload.aud !== "string") {
            return { valid: false, error: "Missing aud claim" };
        }
        
        // iss 是可选的：Checkout UI extensions 的 session token 可能没有 iss
        // Embedded Admin App 的 session token 通常包含 iss
        const hasIssuer = shopifyPayload.iss && typeof shopifyPayload.iss === "string" && shopifyPayload.iss.length > 0;
        
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

        // 手动校验 iss（issuer）格式：如果存在，必须是 <dest>/admin
        // 
        // 重要说明（根据 Shopify 官方文档）：
        // 1. Checkout UI extensions 的 session token 可能没有 iss claim（这是正常的）
        // 2. Embedded Admin App 的 session token 通常包含 iss，格式为 "shop-name.myshopify.com/admin"
        //    注意：文档中的尖括号只是标记格式，实际 token 中的 iss 是纯字符串 "shop-name.myshopify.com/admin"
        //    也可能包含 https:// 前缀，需要兼容处理
        // 3. 如果 iss 存在，我们验证它是否符合 Embedded Admin App 的格式
        // 4. 如果 iss 不存在，我们按 Checkout UI extensions token 处理（只校验 dest/aud/exp/nbf/iat）
        //
        // 验证逻辑（仅在 iss 存在时）：
        // - 规范化 iss（移除可能的 https:// 前缀和尖括号）
        // - 构建预期的 iss：${destHost}/admin（这是 Shopify 官方格式）
        // - 比较两者是否完全匹配（不区分大小写，因为域名不区分大小写）
        // 
        // 修复说明（P0-1）：
        // - 不使用 jwtVerify 的 issuer 选项，因为我们需要先解析 dest 才能构建预期的 iss
        // - 手动检查 iss === `${dest}/admin`（或兼容 https:// 变体）
        if (hasIssuer && shopifyPayload.iss) {
            try {
                const normalizedIss = normalizeIssuer(shopifyPayload.iss);
                // 构建预期的 iss：${destHost}/admin（这是 Shopify 官方格式）
                // 根据 Shopify 文档：iss 格式是 <shop-name.myshopify.com/admin>，实际 token 中是 "shop-name.myshopify.com/admin"
                const expectedIss = `${destHost}/admin`;
                
                // 域名不区分大小写，所以使用 toLowerCase 比较
                // 只比较规范化后的格式（移除 https:// 和尖括号后）
                const normalizedIssLower = normalizedIss.toLowerCase();
                const expectedIssLower = expectedIss.toLowerCase();
                
                if (normalizedIssLower !== expectedIssLower) {
                    return {
                        valid: false,
                        error: `Issuer mismatch: expected ${expectedIss}, got ${normalizedIss} (original: ${shopifyPayload.iss})`,
                    };
                }
            } catch (error) {
                return {
                    valid: false,
                    error: `Invalid issuer format: ${error instanceof Error ? error.message : String(error)}`,
                };
            }
        }
        // 如果 iss 不存在，这是 Checkout UI extensions token，继续验证其他字段即可

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
        // 根据 Shopify 官方文档：aud claim 必须与你的应用的 API Key（client id）完全匹配
        //
        // 修复说明（P0-1）：
        // - 一定要校验 aud 是你的 app client id（Shopify aud 就是 client id）
        // - jwtVerify 中已经通过 audience 选项校验过了，这里再做一次明确校验以确保代码逻辑清晰
        // 
        // 重要：aud 校验是强制性的，必须提供 expectedAud 才能通过验证
        if (expectedAud) {
            if (shopifyPayload.aud !== expectedAud) {
                return {
                    valid: false,
                    error: `Audience mismatch: expected ${expectedAud}, got ${shopifyPayload.aud}. The aud claim must match your app's API Key (SHOPIFY_API_KEY).`,
                };
            }
        } else {
            // 如果没有提供 expectedAud，但 aud 存在，仍然记录警告（生产环境应该始终提供 expectedAud）
            // 注意：在生产环境中，expectedAud 是必需的（第118行已检查）
            if (shopifyPayload.aud) {
                logger.warn("JWT aud claim exists but expectedAud was not provided for verification - this is insecure for production use");
            }
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
