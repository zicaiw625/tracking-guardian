import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import type { SurveyResponseData } from "../types";
import { checkRateLimit, createRateLimitResponse } from "../utils/rate-limiter";
import {
  verifyShopifyJwt,
  extractAuthToken,
  getShopifyApiSecret,
} from "../utils/shopify-jwt";

// Valid source options for survey
const VALID_SOURCES = ["search", "social", "friend", "ad", "other"];

// CORS headers for checkout UI extensions
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Shopify-Shop-Domain",
  "Access-Control-Max-Age": "86400", // 24 hours
};

/**
 * Helper to create JSON response with CORS headers
 */
function jsonWithCors<T>(data: T, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    headers.set(key, value);
  });
  
  return json(data, {
    ...init,
    headers,
  });
}

// Maximum lengths for text fields to prevent abuse
const MAX_ORDER_ID_LENGTH = 64;
const MAX_ORDER_NUMBER_LENGTH = 32;
const MAX_FEEDBACK_LENGTH = 2000;
const MAX_SOURCE_LENGTH = 50;

/**
 * Validates and sanitizes survey input data
 * Returns sanitized data or throws an error with a message
 */
function validateSurveyInput(body: unknown): SurveyResponseData {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body");
  }

  const data = body as Record<string, unknown>;

  // Validate orderId (required)
  if (!data.orderId || typeof data.orderId !== "string") {
    throw new Error("Missing or invalid orderId");
  }
  
  const orderId = data.orderId.trim();
  if (orderId.length === 0 || orderId.length > MAX_ORDER_ID_LENGTH) {
    throw new Error(`orderId must be 1-${MAX_ORDER_ID_LENGTH} characters`);
  }
  
  // Check for potential injection patterns in orderId
  if (!/^[a-zA-Z0-9_\-:.]+$/.test(orderId)) {
    throw new Error("orderId contains invalid characters");
  }

  // Validate orderNumber (optional)
  let orderNumber: string | undefined;
  if (data.orderNumber !== undefined) {
    if (typeof data.orderNumber !== "string") {
      throw new Error("Invalid orderNumber type");
    }
    orderNumber = data.orderNumber.trim().slice(0, MAX_ORDER_NUMBER_LENGTH);
  }

  // Validate rating (optional, must be 1-5 if provided)
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

  // Validate feedback (optional)
  let feedback: string | undefined;
  if (data.feedback !== undefined) {
    if (typeof data.feedback !== "string") {
      throw new Error("Invalid feedback type");
    }
    // Sanitize feedback - remove potential XSS
    feedback = data.feedback
      .trim()
      .slice(0, MAX_FEEDBACK_LENGTH)
      .replace(/<[^>]*>/g, ""); // Strip HTML tags
  }

  // Validate source (optional)
  let source: string | undefined;
  if (data.source !== undefined) {
    if (typeof data.source !== "string") {
      throw new Error("Invalid source type");
    }
    source = data.source.trim().toLowerCase().slice(0, MAX_SOURCE_LENGTH);
    // Validate against known sources or accept custom but sanitized
    if (source && !VALID_SOURCES.includes(source)) {
      // Accept custom source but sanitize it
      source = source.replace(/[^a-zA-Z0-9_\-\s]/g, "");
    }
  }

  // Validate customAnswers (optional)
  let customAnswers: Record<string, unknown> | undefined;
  if (data.customAnswers !== undefined) {
    if (typeof data.customAnswers !== "object" || Array.isArray(data.customAnswers)) {
      throw new Error("Invalid customAnswers type");
    }
    // Limit the size of customAnswers to prevent abuse
    const customAnswersStr = JSON.stringify(data.customAnswers);
    if (customAnswersStr.length > 10000) {
      throw new Error("customAnswers too large");
    }
    customAnswers = data.customAnswers as Record<string, unknown>;
  }

  return {
    orderId,
    orderNumber,
    rating,
    feedback,
    source,
    customAnswers,
  };
}

/**
 * Validates shop domain format
 */
function isValidShopDomain(domain: string): boolean {
  // Shopify domains follow pattern: store-name.myshopify.com
  return /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(domain);
}

/**
 * API endpoint for saving survey responses from checkout extensions
 * This endpoint is called from the Thank You page survey block
 * 
 * Security: Requires valid Shopify session token (JWT) from Checkout UI Extension
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  // Handle CORS preflight requests (OPTIONS)
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  // Rate limiting check
  const rateLimit = checkRateLimit(request, "survey");
  if (rateLimit.isLimited) {
    // Add CORS headers to rate limit response
    const response = createRateLimitResponse(rateLimit.retryAfter);
    Object.entries(CORS_HEADERS).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  }

  // Only accept POST requests
  if (request.method !== "POST") {
    return jsonWithCors({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    // Get and validate the shop domain from the request
    const shopHeader = request.headers.get("X-Shopify-Shop-Domain");
    if (!shopHeader) {
      return jsonWithCors({ error: "Missing shop domain header" }, { status: 400 });
    }

    // Validate shop domain format to prevent header injection
    if (!isValidShopDomain(shopHeader)) {
      console.warn(`Invalid shop domain format: ${shopHeader}`);
      return jsonWithCors({ error: "Invalid shop domain format" }, { status: 400 });
    }

    // SECURITY: Verify Shopify session token (JWT)
    // This prevents fake requests from spoofed origins
    const authToken = extractAuthToken(request);
    if (!authToken) {
      console.warn(`Missing Authorization header for shop ${shopHeader}`);
      return jsonWithCors({ error: "Unauthorized: Missing authentication token" }, { status: 401 });
    }

    // Verify the JWT token
    let apiSecret: string;
    try {
      apiSecret = getShopifyApiSecret();
    } catch (error) {
      console.error("Failed to get Shopify API secret:", error);
      return jsonWithCors({ error: "Server configuration error" }, { status: 500 });
    }

    const jwtResult = verifyShopifyJwt(authToken, apiSecret, shopHeader);
    
    if (!jwtResult.valid) {
      console.warn(`JWT verification failed for shop ${shopHeader}: ${jwtResult.error}`);
      return jsonWithCors(
        { error: `Unauthorized: ${jwtResult.error}` },
        { status: 401 }
      );
    }

    // Additional check: ensure shop domain from token matches header
    if (jwtResult.shopDomain !== shopHeader) {
      console.warn(
        `Shop domain mismatch: header=${shopHeader}, token=${jwtResult.shopDomain}`
      );
      return jsonWithCors(
        { error: "Unauthorized: Shop domain mismatch" },
        { status: 401 }
      );
    }

    // Parse and validate the request body
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return jsonWithCors({ error: "Invalid JSON body" }, { status: 400 });
    }

    let validatedData: SurveyResponseData;
    try {
      validatedData = validateSurveyInput(rawBody);
    } catch (validationError) {
      const message = validationError instanceof Error ? validationError.message : "Validation failed";
      return jsonWithCors({ error: message }, { status: 400 });
    }

    // Find the shop - only find active shops
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

    // SECURITY: Verify orderId belongs to this shop
    // Check if we have a conversion log for this order (created by webhook)
    // This prevents users from submitting surveys for orders that don't belong to this shop
    const orderBelongsToShop = await prisma.conversionLog.findFirst({
      where: {
        shopId: shop.id,
        orderId: validatedData.orderId,
      },
      select: { id: true },
    });

    if (!orderBelongsToShop) {
      // Also check if there's already a survey response (for cases where conversion tracking wasn't enabled)
      const existingSurvey = await prisma.surveyResponse.findFirst({
        where: {
          shopId: shop.id,
          orderId: validatedData.orderId,
        },
        select: { id: true },
      });

      if (!existingSurvey) {
        console.warn(
          `Survey submission rejected: orderId=${validatedData.orderId.slice(0, 8)}... ` +
          `not found for shop=${shopHeader}`
        );
        return jsonWithCors(
          { error: "Order not found or not eligible for survey" },
          { status: 404 }
        );
      }
    }

    // Check if survey response already exists for this order (idempotency)
    const existingResponse = await prisma.surveyResponse.findFirst({
      where: {
        shopId: shop.id,
        orderId: validatedData.orderId,
      },
    });

    if (existingResponse) {
      // Update existing response
      const updated = await prisma.surveyResponse.update({
        where: { id: existingResponse.id },
        data: {
          rating: validatedData.rating ?? existingResponse.rating,
          feedback: validatedData.feedback ?? existingResponse.feedback,
          source: validatedData.source ?? existingResponse.source,
          customAnswers: validatedData.customAnswers 
            ? JSON.parse(JSON.stringify(validatedData.customAnswers)) 
            : existingResponse.customAnswers,
        },
      });

      return jsonWithCors({
        success: true,
        message: "Survey response updated",
        id: updated.id,
      });
    }

    // Create new survey response
    const surveyResponse = await prisma.surveyResponse.create({
      data: {
        shopId: shop.id,
        orderId: validatedData.orderId,
        orderNumber: validatedData.orderNumber,
        rating: validatedData.rating,
        feedback: validatedData.feedback,
        source: validatedData.source,
        customAnswers: validatedData.customAnswers 
          ? JSON.parse(JSON.stringify(validatedData.customAnswers)) 
          : undefined,
      },
    });

    // Log without sensitive data
    console.log(
      `Survey response saved: shop=${shopHeader}, orderId=${validatedData.orderId.slice(0, 8)}..., ` +
      `hasRating=${validatedData.rating !== undefined}, hasSource=${validatedData.source !== undefined}`
    );

    return jsonWithCors({
      success: true,
      message: "Survey response saved",
      id: surveyResponse.id,
    });
  } catch (error) {
    // Don't expose internal error details to clients
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Survey API error:", errorMessage);
    
    return jsonWithCors(
      {
        success: false,
        error: "An error occurred processing your request",
      },
      { status: 500 }
    );
  }
};

// Handle OPTIONS requests for CORS preflight
export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }
  
  // GET endpoint for analytics (protected)
  // For now, return method not allowed
  return jsonWithCors({ error: "Use admin routes for survey analytics" }, { status: 405 });
};
