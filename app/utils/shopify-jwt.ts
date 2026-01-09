import { jwtVerify, type JWTPayload } from "jose";
import { logger } from "./logger.server";

interface ShopifyJwtPayload extends JWTPayload {
    iss?: string;
    dest: string;
    aud: string;
    sub?: string;
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

function normalizeHost(input: string): string {
    if (!input || typeof input !== "string") {
        throw new Error("Invalid host input");
    }

    let cleaned = input.trim();

    cleaned = cleaned.replace(/^https?:\/\//, "");

    const pathIndex = cleaned.indexOf("/");
    if (pathIndex !== -1) {
        cleaned = cleaned.substring(0, pathIndex);
    }

    const queryIndex = cleaned.indexOf("?");
    if (queryIndex !== -1) {
        cleaned = cleaned.substring(0, queryIndex);
    }
    const hashIndex = cleaned.indexOf("#");
    if (hashIndex !== -1) {
        cleaned = cleaned.substring(0, hashIndex);
    }

    const portIndex = cleaned.indexOf(":");
    if (portIndex !== -1) {
        cleaned = cleaned.substring(0, portIndex);
    }

    cleaned = cleaned.trim();

    if (!cleaned || !cleaned.includes(".")) {
        throw new Error(`Invalid host format: expected domain like "store.myshopify.com", got "${input}"`);
    }

    if (!cleaned.endsWith(".myshopify.com") && cleaned !== "myshopify.com") {

        logger.warn(`Non-standard shop domain format: ${cleaned}`);
    }

    return cleaned;
}

function normalizeIssuer(input: string): string {
    if (!input || typeof input !== "string") {
        throw new Error("Invalid issuer input");
    }
    let result = input.trim();

    if (result.startsWith("<") && result.endsWith(">")) {
        result = result.slice(1, -1).trim();
    }

    result = result.replace(/^https?:\/\//, "");

    return result;
}

export async function verifyShopifyJwt(
    token: string,
    apiSecret: string,
    expectedShopDomain?: string,
    expectedAud?: string
): Promise<VerificationResult> {

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

        const secret = new TextEncoder().encode(apiSecret);

        const verifyOptions: Parameters<typeof jwtVerify>[2] = {
            algorithms: ["HS256"],

            ...(expectedAud ? { audience: expectedAud } : {}),
        };

        const { payload } = await jwtVerify(cleanToken, secret, verifyOptions);

        const shopifyPayload = payload as ShopifyJwtPayload;

        if (!shopifyPayload.dest || typeof shopifyPayload.dest !== "string") {
            return { valid: false, error: "Missing dest claim" };
        }

        if (!shopifyPayload.aud || typeof shopifyPayload.aud !== "string") {
            return { valid: false, error: "Missing aud claim" };
        }

        const hasIssuer = shopifyPayload.iss && typeof shopifyPayload.iss === "string" && shopifyPayload.iss.length > 0;

        if (shopifyPayload.exp === undefined || shopifyPayload.nbf === undefined || shopifyPayload.iat === undefined) {
            return { valid: false, error: "Missing required JWT time claims (exp, nbf, iat)" };
        }

        if (!shopifyPayload.jti) {
            return { valid: false, error: "Missing required JWT claim (jti)" };
        }

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

        if (hasIssuer && shopifyPayload.iss) {
            try {
                const normalizedIss = normalizeIssuer(shopifyPayload.iss);

                const expectedIss = `${destHost}/admin`;

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

        if (expectedShopDomain && destHost !== expectedShopDomain) {
            return {
                valid: false,
                error: `Shop domain mismatch: expected ${expectedShopDomain}, got ${destHost}`,
            };
        }

        if (expectedAud) {
            if (shopifyPayload.aud !== expectedAud) {
                return {
                    valid: false,
                    error: `Audience mismatch: expected ${expectedAud}, got ${shopifyPayload.aud}. The aud claim must match your app's API Key (SHOPIFY_API_KEY).`,
                };
            }
        } else {

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
