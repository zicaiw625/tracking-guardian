import type { ConversionData, GoogleCredentials, ConversionApiResponse } from "../../types";
import { logger } from "../../utils/logger.server";
const API_TIMEOUT_MS = 30000;
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    }
    finally {
        clearTimeout(timeoutId);
    }
}
export async function sendConversionToGoogle(credentials: GoogleCredentials | null, conversionData: ConversionData, eventId?: string): Promise<ConversionApiResponse> {
    if (!credentials) {
        throw new Error("Google credentials not configured");
    }
    if (!credentials.measurementId || !credentials.apiSecret) {
        throw new Error("GA4 Measurement Protocol requires measurementId and apiSecret. " +
            "Get these from GA4 Admin > Data Streams > Your Stream > Measurement Protocol API secrets");
    }
    if (!credentials.measurementId.match(/^G-[A-Z0-9]+$/)) {
        throw new Error(`Invalid GA4 Measurement ID format: ${credentials.measurementId}. ` +
            `Expected format: G-XXXXXXXXXX`);
    }
    logger.info(`Sending GA4 MP conversion for order=${conversionData.orderId}`);
    const dedupeEventId = eventId || `${conversionData.orderId}_purchase_${Date.now()}`;
    const payload: Record<string, unknown> = {
        client_id: `server.${conversionData.orderId}`,
        events: [
            {
                name: "purchase",
                params: {
                    engagement_time_msec: "1",
                    transaction_id: conversionData.orderId,
                    value: conversionData.value,
                    currency: conversionData.currency,
                    items: conversionData.lineItems?.map((item) => ({
                        item_id: item.productId,
                        item_name: item.name,
                        quantity: item.quantity,
                        price: item.price,
                    })) || [],
                },
            },
        ],
    };
    try {
        const url = `https://www.google-analytics.com/mp/collect?measurement_id=${credentials.measurementId}&api_secret=${credentials.apiSecret}`;
        const response = await fetchWithTimeout(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        }, API_TIMEOUT_MS);
        if (response.status === 204 || response.ok) {
            logger.info(`GA4 MP: conversion sent successfully for order=${conversionData.orderId}, eventId=${dedupeEventId}`);
            return {
                success: true,
                conversionId: dedupeEventId,
                timestamp: new Date().toISOString(),
            };
        }
        else {
            const errorText = await response.text().catch(() => "");
            throw new Error(`GA4 Measurement Protocol error: ${response.status} ${errorText}`);
        }
    }
    catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
            throw new Error(`GA4 MP timeout after ${API_TIMEOUT_MS}ms`);
        }
        throw error;
    }
}
/**
 * P0-5: Client-side pixel code generation removed.
 * 
 * Tracking Guardian uses server-side CAPI exclusively.
 * This function is kept for backwards compatibility but returns empty string.
 * 
 * @deprecated Use server-side sendConversionToGoogle instead
 */
export function generateGooglePixelCode(_config: {
    measurementId: string;
    conversionId?: string;
    conversionLabel?: string;
}): string {
    // P0-5: No longer generating client-side code
    // All tracking is done server-side via Measurement Protocol
    return "";
}
