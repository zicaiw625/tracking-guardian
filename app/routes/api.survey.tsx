import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import type { SurveyResponseData } from "../types";
import { checkRateLimitAsync, createRateLimitResponse } from "../utils/rate-limiter";
import { verifyShopifyJwt, extractAuthToken, getShopifyApiSecret, } from "../utils/shopify-jwt";
import { optionsResponse, jsonWithCors } from "../utils/cors";
import { logger } from "../utils/logger.server";
import { generateSimpleId } from "../utils/helpers";
const VALID_SOURCES = ["search", "social", "friend", "ad", "other"];
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
export const action = async ({ request }: ActionFunctionArgs) => {
    if (request.method === "OPTIONS") {
        return optionsResponse(request, true);
    }
    const rateLimit = await checkRateLimitAsync(request, "survey");
    if (rateLimit.isLimited) {
        logger.warn(`Rate limit exceeded for survey API`);
        const response = createRateLimitResponse(rateLimit.retryAfter);

        Object.entries(optionsResponse(request, true).headers).forEach(([key, value]) => {
            response.headers.set(key, value);
        });
        return response;
    }
    if (request.method !== "POST") {
        return jsonWithCors({ error: "Method not allowed" }, { status: 405, request, staticCors: true });
    }
    const contentType = request.headers.get("Content-Type");
    if (!contentType || !contentType.includes("application/json")) {
        return jsonWithCors({ error: "Content-Type must be application/json" }, { status: 415, request, staticCors: true });
    }
    const MAX_SURVEY_BODY_SIZE = 16 * 1024;
    const contentLength = parseInt(request.headers.get("Content-Length") || "0", 10);
    if (contentLength > MAX_SURVEY_BODY_SIZE) {
        return jsonWithCors({ error: "Request body too large", maxSize: MAX_SURVEY_BODY_SIZE }, { status: 413, request, staticCors: true });
    }
    try {
        const authToken = extractAuthToken(request);
        if (!authToken) {
            logger.warn("Missing Authorization header");
            return jsonWithCors({ error: "Unauthorized: Missing authentication token" }, { status: 401, request, staticCors: true });
        }
        let apiSecret: string;
        try {
            apiSecret = getShopifyApiSecret();
        }
        catch (error) {
            logger.error("Failed to get Shopify API secret", error);
            return jsonWithCors({ error: "Server configuration error" }, { status: 500, request, staticCors: true });
        }
        const expectedAud = process.env.SHOPIFY_API_KEY;
        if (!expectedAud) {
            logger.error("SHOPIFY_API_KEY not configured");
            return jsonWithCors({ error: "Server configuration error" }, { status: 500, request, staticCors: true });
        }

        const jwtResult = await verifyShopifyJwt(authToken, apiSecret, undefined, expectedAud);
        if (!jwtResult.valid || !jwtResult.shopDomain) {
            logger.warn(`JWT verification failed: ${jwtResult.error}`);
            return jsonWithCors({ error: `Unauthorized: ${jwtResult.error}` }, { status: 401, request, staticCors: true });
        }
        const shopDomain = jwtResult.shopDomain;
        let rawBody: unknown;
        try {
            rawBody = await request.json();
        }
        catch {
            return jsonWithCors({ error: "Invalid JSON body" }, { status: 400, request, staticCors: true });
        }
        let validatedData: SurveyResponseData;
        try {
            validatedData = validateSurveyInput(rawBody);
        }
        catch (validationError) {
            const message = validationError instanceof Error ? validationError.message : "Validation failed";
            return jsonWithCors({ error: message }, { status: 400, request, staticCors: true });
        }
        const shop = await prisma.shop.findUnique({
            where: { shopDomain },
            select: { id: true, isActive: true },
        });
        if (!shop) {
            return jsonWithCors({ error: "Shop not found" }, { status: 404, request, staticCors: true });
        }
        if (!shop.isActive) {
            return jsonWithCors({ error: "Shop is not active" }, { status: 403, request, staticCors: true });
        }
        const surveyKey = validatedData.orderId
            || (validatedData.orderNumber ? `order_num:${validatedData.orderNumber}` : null)
            || (validatedData.checkoutToken ? `checkout:${validatedData.checkoutToken}` : null);
        if (!surveyKey) {
            return jsonWithCors({ error: "No valid order identifier" }, { status: 400, request, staticCors: true });
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
                shop: shopDomain,
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
            }, { request, staticCors: true });
        }
        const surveyResponse = await prisma.surveyResponse.create({
            data: {
                id: generateSimpleId("survey"),
                shopId: shop.id,
                orderId: surveyKey,
                orderNumber: validatedData.orderNumber || null,
                rating: validatedData.rating || null,
                feedback: validatedData.feedback || null,
                source: validatedData.source || null,
                customAnswers: validatedData.customAnswers
                    ? JSON.parse(JSON.stringify(validatedData.customAnswers))
                    : null,
            },
        });
        logger.info(`Survey response saved`, {
            shop: shopDomain,
            hasOrderId: !!validatedData.orderId,
            hasOrderNumber: !!validatedData.orderNumber,
            hasRating: validatedData.rating !== undefined,
            hasSource: validatedData.source !== undefined,
        });
        return jsonWithCors({
            success: true,
            message: "Survey response saved",
            id: surveyResponse.id,
        }, { request, staticCors: true });
    }
    catch (error) {
        logger.error("Survey API error", error);
        return jsonWithCors({
            success: false,
            error: "An error occurred processing your request",
        }, { status: 500, request, staticCors: true });
    }
};
export const loader = async ({ request }: LoaderFunctionArgs) => {
    if (request.method === "OPTIONS") {
        return optionsResponse(request, true);
    }
    return jsonWithCors({ error: "Use admin routes for survey analytics" }, { status: 405, request, staticCors: true });
};
