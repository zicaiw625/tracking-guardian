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
export function generateGooglePixelCode(config: {
    measurementId: string;
    conversionId?: string;
    conversionLabel?: string;
}): string {
    if (!config.measurementId) {
        return "";
    }
    const hasGoogleAds = config.conversionId && config.conversionLabel;
    return `
const GA4_MEASUREMENT_ID = "${config.measurementId}";
${hasGoogleAds ? `const GOOGLE_ADS_ID = "${config.conversionId}";
const GOOGLE_ADS_LABEL = "${config.conversionLabel}";` : "// Google Ads 转化跟踪未配置"}

// 加载 gtag.js
(function() {
  const script = document.createElement('script');
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_MEASUREMENT_ID;
  script.async = true;
  document.head.appendChild(script);
})();

window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', GA4_MEASUREMENT_ID, { send_page_view: false });
${hasGoogleAds ? `gtag('config', GOOGLE_ADS_ID);` : ""}

                           
analytics.subscribe('checkout_completed', (event) => {
                            
                                                   
                                    
  const analyticsAllowed = customerPrivacy.analyticsProcessingAllowed();
  const marketingAllowed = customerPrivacy.marketingAllowed();
  
  if (!analyticsAllowed) {
    console.log('[Tracking Guardian] GA4: 用户未授权分析追踪，跳过');
    return;
  }
  
  const checkout = event.data?.checkout;
  if (!checkout) return;
  
  const orderId = checkout.order?.id || checkout.token;
  const value = parseFloat(checkout.totalPrice?.amount || 0);
  const currency = checkout.currencyCode || 'USD';
  
  const items = (checkout.lineItems || []).map((item, index) => ({
    item_id: item.variant?.product?.id || item.id,
    item_name: item.title || '',
    price: parseFloat(item.variant?.price?.amount || 0),
    quantity: item.quantity || 1,
    index: index,
  }));
  
                    
  gtag('event', 'purchase', {
    transaction_id: orderId,
    value: value,
    currency: currency,
    tax: parseFloat(checkout.totalTax?.amount || 0),
    shipping: parseFloat(checkout.shippingLine?.price?.amount || 0),
    items: items,
  });
  
  console.log('[Tracking Guardian] GA4 purchase event sent:', orderId);
  
  ${hasGoogleAds ? `// Google Ads 转化（需要 marketing 同意）
  if (marketingAllowed) {
    gtag('event', 'conversion', {
      send_to: GOOGLE_ADS_ID + '/' + GOOGLE_ADS_LABEL,
      value: value,
      currency: currency,
      transaction_id: orderId,
    });
    console.log('[Tracking Guardian] Google Ads conversion sent:', orderId);
  }` : "// 如需 Google Ads 转化追踪，请配置 conversionId 和 conversionLabel"}
});

console.log('[Tracking Guardian] GA4 Custom Pixel initialized');
`;
}
