import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import type { SurveyResponseData } from "../types";
import { checkRateLimitAsync, createRateLimitResponse } from "../utils/rate-limiter";
import { verifyShopifyJwt, extractAuthToken, getShopifyApiSecret, } from "../utils/shopify-jwt";
import { STATIC_CORS_HEADERS, jsonWithCors as jsonWithCorsBase } from "../utils/cors";
import { logger } from "../utils/logger.server";
const VALID_SOURCES = ["search", "social", "friend", "ad", "other"];
const CORS_HEADERS = STATIC_CORS_HEADERS;
function jsonWithCors<T>(data: T, init?: ResponseInit): Response {
    return jsonWithCorsBase(data, {
        ...init,
        staticCors: true,
        headers: init?.headers as HeadersInit | undefined,
    });
}
const MAX_ORDER_ID_LENGTH = 64;
const MAX_ORDER_NUMBER_LENGTH = 32;
const MAX_FEEDBACK_LENGTH = 2000;
const MAX_SOURCE_LENGTH = 50;
function validateSurveyInput(body: unknown): SurveyResponseData {
    if (!body || typeof body !== "object") {
        throw new Error("Invalid request body");
    }
    const data = body as Record<string, unknown>;
    let orderId: string | undefined;
    if (data.orderId !== undefined && data.orderId !== null) {
        if (typeof data.orderId !== "string") {
            throw new Error("Invalid orderId type");
        }
        orderId = data.orderId.trim();
        if (orderId.length > MAX_ORDER_ID_LENGTH) {
            throw new Error(`orderId must be at most ${MAX_ORDER_ID_LENGTH} characters`);
        }
        if (orderId.length > 0 && !/^[a-zA-Z0-9_\-:.]+$/.test(orderId)) {
            throw new Error("orderId contains invalid characters");
        }
        if (orderId.length === 0) {
            orderId = undefined;
        }
    }
    let orderNumber: string | undefined;
    if (data.orderNumber !== undefined && data.orderNumber !== null) {
        if (typeof data.orderNumber !== "string") {
            throw new Error("Invalid orderNumber type");
        }
        orderNumber = data.orderNumber.trim().slice(0, MAX_ORDER_NUMBER_LENGTH);
        if (orderNumber.length === 0) {
            orderNumber = undefined;
        }
    }
    let checkoutToken: string | undefined;
    if (data.checkoutToken !== undefined && data.checkoutToken !== null) {
        if (typeof data.checkoutToken !== "string") {
            throw new Error("Invalid checkoutToken type");
        }
        checkoutToken = data.checkoutToken.trim().slice(0, 64);
        if (checkoutToken.length === 0) {
            checkoutToken = undefined;
        }
    }
    if (!orderId && !orderNumber && !checkoutToken) {
        throw new Error("At least one order identifier required (orderId, orderNumber, or checkoutToken)");
    }
    let rating: number | undefined;
    if (data.rating !== undefined) {
        if (typeof data.rating !== "number" || !Number.isInteger(data.rating)) {
            throw new Error("Rating must be an integer");
        }
        if (data.rating < 1 || data.rating > 5) {
            throw new Error("Rating must be between 1 and 5");
        }
        rating = data.rating;
    }
    let feedback: string | undefined;
    if (data.feedback !== undefined) {
        if (typeof data.feedback !== "string") {
            throw new Error("Invalid feedback type");
        }
        feedback = data.feedback
            .trim()
            .slice(0, MAX_FEEDBACK_LENGTH)
            .replace(/<[^>]*>/g, "");
    }
    let source: string | undefined;
    if (data.source !== undefined) {
        if (typeof data.source !== "string") {
            throw new Error("Invalid source type");
        }
        source = data.source.trim().toLowerCase().slice(0, MAX_SOURCE_LENGTH);
        if (source && !VALID_SOURCES.includes(source)) {
            source = source.replace(/[^a-zA-Z0-9_\-\s]/g, "");
        }
    }
    let customAnswers: Record<string, unknown> | undefined;
    if (data.customAnswers !== undefined) {
        if (typeof data.customAnswers !== "object" || Array.isArray(data.customAnswers)) {
            throw new Error("Invalid customAnswers type");
        }
        const customAnswersStr = JSON.stringify(data.customAnswers);
        if (customAnswersStr.length > 10000) {
            throw new Error("customAnswers too large");
        }
        customAnswers = data.customAnswers as Record<string, unknown>;
    }
    return {
        orderId,
        orderNumber,
        checkoutToken,
        rating,
        feedback,
        source,
        customAnswers,
    };
}
function isValidShopDomain(domain: string): boolean {
    return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(domain);
}
export const action = async ({ request }: ActionFunctionArgs) => {
    if (request.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: CORS_HEADERS,
        });
    }
    const rateLimit = await checkRateLimitAsync(request, "survey");
    if (rateLimit.isLimited) {
        logger.warn(`Rate limit exceeded for survey API`);
        const response = createRateLimitResponse(rateLimit.retryAfter);
        Object.entries(CORS_HEADERS).forEach(([key, value]) => {
            response.headers.set(key, value);
        });
        return response;
    }
    if (request.method !== "POST") {
        return jsonWithCors({ error: "Method not allowed" }, { status: 405 });
    }
    const contentType = request.headers.get("Content-Type");
    if (!contentType || !contentType.includes("application/json")) {
        return jsonWithCors({ error: "Content-Type must be application/json" }, { status: 415 });
    }
    const MAX_SURVEY_BODY_SIZE = 16 * 1024;
    const contentLength = parseInt(request.headers.get("Content-Length") || "0", 10);
    if (contentLength > MAX_SURVEY_BODY_SIZE) {
        return jsonWithCors({ error: "Request body too large", maxSize: MAX_SURVEY_BODY_SIZE }, { status: 413 });
    }
    try {
        const shopHeader = request.headers.get("X-Shopify-Shop-Domain");
        if (!shopHeader) {
            return jsonWithCors({ error: "Missing shop domain header" }, { status: 400 });
        }
        if (!isValidShopDomain(shopHeader)) {
            logger.warn(`Invalid shop domain format: ${shopHeader?.substring(0, 50)}`);
            return jsonWithCors({ error: "Invalid shop domain format" }, { status: 400 });
        }
        const authToken = extractAuthToken(request);
        if (!authToken) {
            logger.warn(`Missing Authorization header for shop ${shopHeader}`);
            return jsonWithCors({ error: "Unauthorized: Missing authentication token" }, { status: 401 });
        }
        let apiSecret: string;
        try {
            apiSecret = getShopifyApiSecret();
        }
        catch (error) {
            logger.error("Failed to get Shopify API secret", error);
            return jsonWithCors({ error: "Server configuration error" }, { status: 500 });
        }
        const jwtResult = await verifyShopifyJwt(authToken, apiSecret, shopHeader);
        if (!jwtResult.valid) {
            logger.warn(`JWT verification failed for shop ${shopHeader}: ${jwtResult.error}`);
            return jsonWithCors({ error: `Unauthorized: ${jwtResult.error}` }, { status: 401 });
        }
        if (jwtResult.shopDomain !== shopHeader) {
            logger.warn(`Shop domain mismatch`, {
                headerShop: shopHeader,
                tokenShop: jwtResult.shopDomain
            });
            return jsonWithCors({ error: "Unauthorized: Shop domain mismatch" }, { status: 401 });
        }
        let rawBody: unknown;
        try {
            rawBody = await request.json();
        }
        catch {
            return jsonWithCors({ error: "Invalid JSON body" }, { status: 400 });
        }
        let validatedData: SurveyResponseData;
        try {
            validatedData = validateSurveyInput(rawBody);
        }
        catch (validationError) {
            const message = validationError instanceof Error ? validationError.message : "Validation failed";
            return jsonWithCors({ error: message }, { status: 400 });
        }
        const shop = await prisma.shop.findUnique({
            where: { shopDomain: shopHeader },
            select: { id: true, isActive: true },
        });
        if (!shop) {
            return jsonWithCors({ error: "Shop not found" }, { status: 404 });
        }
        if (!shop.isActive) {
            return jsonWithCors({ error: "Shop is not active" }, { status: 403 });
        }
        const surveyKey = validatedData.orderId
            || (validatedData.orderNumber ? `order_num:${validatedData.orderNumber}` : null)
            || (validatedData.checkoutToken ? `checkout:${validatedData.checkoutToken}` : null);
        if (!surveyKey) {
            return jsonWithCors({ error: "No valid order identifier" }, { status: 400 });
        }
        const existingOrderEvidence = validatedData.orderId
            ? await prisma.conversionLog.findFirst({
                where: {
                    shopId: shop.id,
                    orderId: validatedData.orderId,
                },
                select: { id: true },
            })
            : null;
        if (!existingOrderEvidence && validatedData.orderId) {
            logger.info(`Survey for untracked order`, {
                orderIdPrefix: validatedData.orderId.slice(0, 8),
                shop: shopHeader,
                jwtValidated: true,
            });
        }
        const existingResponse = await prisma.surveyResponse.findFirst({
            where: {
                shopId: shop.id,
                orderId: surveyKey,
            },
        });
        if (existingResponse) {
            const updated = await prisma.surveyResponse.update({
                where: { id: existingResponse.id },
                data: {
                    rating: validatedData.rating ?? existingResponse.rating,
                    feedback: validatedData.feedback ?? existingResponse.feedback,
                    source: validatedData.source ?? existingResponse.source,
                    customAnswers: validatedData.customAnswers
                        ? JSON.parse(JSON.stringify(validatedData.customAnswers))
                        : existingResponse.customAnswers,
                    ...(validatedData.orderId && existingResponse.orderId.startsWith("order_num:")
                        ? { orderId: validatedData.orderId }
                        : {}),
                },
            });
            return jsonWithCors({
                success: true,
                message: "Survey response updated",
                id: updated.id,
            });
        }
        const surveyResponse = await prisma.surveyResponse.create({
            data: {
                shopId: shop.id,
                orderId: surveyKey,
                orderNumber: validatedData.orderNumber,
                rating: validatedData.rating,
                feedback: validatedData.feedback,
                source: validatedData.source,
                customAnswers: validatedData.customAnswers
                    ? JSON.parse(JSON.stringify(validatedData.customAnswers))
                    : undefined,
            },
        });
        logger.info(`Survey response saved`, {
            shop: shopHeader,
            hasOrderId: !!validatedData.orderId,
            hasOrderNumber: !!validatedData.orderNumber,
            hasRating: validatedData.rating !== undefined,
            hasSource: validatedData.source !== undefined,
        });
        return jsonWithCors({
            success: true,
            message: "Survey response saved",
            id: surveyResponse.id,
        });
    }
    catch (error) {
        logger.error("Survey API error", error);
        return jsonWithCors({
            success: false,
            error: "An error occurred processing your request",
        }, { status: 500 });
    }
};
export const loader = async ({ request }: LoaderFunctionArgs) => {
    if (request.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: CORS_HEADERS,
        });
    }
    return jsonWithCors({ error: "Use admin routes for survey analytics" }, { status: 405 });
};
