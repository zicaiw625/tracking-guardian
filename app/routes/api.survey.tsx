import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import type { SurveyResponseData } from "../types";
import { checkRateLimit, createRateLimitResponse } from "../utils/rate-limiter";

/**
 * API endpoint for saving survey responses from checkout extensions
 * This endpoint is called from the Thank You page survey block
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  // Rate limiting check
  const rateLimit = checkRateLimit(request, "survey");
  if (rateLimit.isLimited) {
    return createRateLimitResponse(rateLimit.retryAfter);
  }

  // Only accept POST requests
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    // Get the shop domain from the request
    const shopHeader = request.headers.get("X-Shopify-Shop-Domain");
    if (!shopHeader) {
      return json({ error: "Missing shop domain header" }, { status: 400 });
    }

    // Parse the request body
    const body = await request.json() as SurveyResponseData;

    if (!body.orderId) {
      return json({ error: "Missing orderId" }, { status: 400 });
    }

    // Find the shop
    const shop = await prisma.shop.findUnique({
      where: { shopDomain: shopHeader },
    });

    if (!shop) {
      return json({ error: "Shop not found" }, { status: 404 });
    }

    // Check if survey response already exists for this order
    const existingResponse = await prisma.surveyResponse.findFirst({
      where: {
        shopId: shop.id,
        orderId: body.orderId,
      },
    });

    if (existingResponse) {
      // Update existing response
      const updated = await prisma.surveyResponse.update({
        where: { id: existingResponse.id },
        data: {
          rating: body.rating ?? existingResponse.rating,
          feedback: body.feedback ?? existingResponse.feedback,
          source: body.source ?? existingResponse.source,
          customAnswers: body.customAnswers ? JSON.parse(JSON.stringify(body.customAnswers)) : existingResponse.customAnswers,
        },
      });

      return json({
        success: true,
        message: "Survey response updated",
        id: updated.id,
      });
    }

    // Create new survey response
    const surveyResponse = await prisma.surveyResponse.create({
      data: {
        shopId: shop.id,
        orderId: body.orderId,
        orderNumber: body.orderNumber,
        rating: body.rating,
        feedback: body.feedback,
        source: body.source,
        customAnswers: body.customAnswers ? JSON.parse(JSON.stringify(body.customAnswers)) : undefined,
      },
    });

    console.log(`Survey response saved: shop=${shopHeader}, order=${body.orderId}, rating=${body.rating}, source=${body.source}`);

    return json({
      success: true,
      message: "Survey response saved",
      id: surveyResponse.id,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Survey API error:", errorMessage);
    return json(
      {
        success: false,
        error: errorMessage,
      },
      { status: 500 }
    );
  }
};

// GET endpoint for analytics (protected)
export const loader = async ({ request }: ActionFunctionArgs) => {
  // This could be used to fetch survey analytics
  // For now, return method not allowed
  return json({ error: "Use admin routes for survey analytics" }, { status: 405 });
};
