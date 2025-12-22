import type { ConversionData, TikTokCredentials, ConversionApiResponse } from "../../types";
import { hashValue, normalizePhone, normalizeEmail } from "../../utils/crypto";
import { logger } from "../../utils/logger";

const TIKTOK_API_TIMEOUT_MS = 30000; 

interface TikTokUserData {
  email?: string;
  phone_number?: string;
}

async function buildHashedUserData(
  conversionData: ConversionData,
  orderId: string
): Promise<{ user: TikTokUserData; hasPii: boolean }> {
  const user: TikTokUserData = {};
  let hasPii = false;
  
  if (conversionData.email) {
    user.email = await hashValue(normalizeEmail(conversionData.email));
    hasPii = true;
  }
  if (conversionData.phone) {
    user.phone_number = await hashValue(normalizePhone(conversionData.phone));
    hasPii = true;
  }
  
  if (!hasPii && process.env.NODE_ENV !== "test") {
    logger.debug(`[P0-01] TikTok Events API: No PII for order ${orderId.slice(0, 8)}...`, {
      platform: "tiktok",
      note: "Conversion will still be recorded but may have lower match rate",
    });
  }
  
  return { user, hasPii };
}

export async function sendConversionToTikTok(
  credentials: TikTokCredentials | null,
  conversionData: ConversionData,
  eventId?: string
): Promise<ConversionApiResponse> {
  if (!credentials?.pixelId || !credentials?.accessToken) {
    throw new Error("TikTok Pixel credentials not configured");
  }

  if (!/^[A-Z0-9]{20,}$/i.test(credentials.pixelId)) {
    throw new Error("Invalid TikTok Pixel ID format");
  }

  const timestamp = new Date().toISOString();

  const { user, hasPii } = await buildHashedUserData(
    conversionData,
    conversionData.orderId
  );

  if (!hasPii) {
    logger.info(`[P0-01] Sending TikTok conversion with no PII for order ${conversionData.orderId.slice(0, 8)}...`, {
      platform: "tiktok",
      note: "Conversion will still be recorded",
    });
  }

  const contents = conversionData.lineItems?.map((item) => ({
    content_id: item.productId,
    content_name: item.name,
    quantity: item.quantity,
    price: item.price,
  })) || [];

  const dedupeEventId = eventId || `${conversionData.orderId}_purchase_${Date.now()}`;

  const eventPayload = {
    pixel_code: credentials.pixelId,
    event: "CompletePayment",
    event_id: dedupeEventId, 
    timestamp,
    context: {
      user,
    },
    properties: {
      currency: conversionData.currency,
      value: conversionData.value,
      order_id: conversionData.orderId,
      contents,
      content_type: "product",
    },
    ...(credentials.testEventCode && { test_event_code: credentials.testEventCode }),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIKTOK_API_TIMEOUT_MS);

  try {
  
  const response = await fetch(
    "https://business-api.tiktok.com/open_api/v1.3/pixel/track/",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Access-Token": credentials.accessToken,
      },
      body: JSON.stringify({ data: [eventPayload] }),
        signal: controller.signal,
    }
  );

  if (!response.ok) {
    const errorData = await response.json();
      
      const errorMessage = errorData.message || "Unknown TikTok API error";
      throw new Error(`TikTok API error: ${errorMessage}`);
    }

    const result = await response.json();
    
    logger.info(`TikTok conversion sent: order=${conversionData.orderId.slice(0, 8)}...`);

    return {
      success: true,
      conversionId: conversionData.orderId,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`TikTok API request timeout after ${TIKTOK_API_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function generateTikTokPixelCode(config: { pixelId: string }): string {
  if (!config.pixelId) {
    return "";
  }

  return `// Tracking Guardian - TikTok Pixel Custom Pixel Template
// 
// 📋 使用说明：
// 1. 前往 Shopify 后台 → 设置 → 客户事件
// 2. 点击"添加自定义 Pixel"
// 3. 粘贴此代码并保存
// 4. 在 TikTok Events Manager 验证事件是否正确接收
//
// ⚠️ 推荐：使用 Tracking Guardian App Pixel + 服务端 Events API 可获得更好的追踪效果

const TIKTOK_PIXEL_ID = "${config.pixelId}";

// 加载 TikTok Pixel SDK
!function (w, d, t) {
  w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
  ttq.load(TIKTOK_PIXEL_ID);
  ttq.page();
}(window, document, 'ttq');

// 监听 checkout_completed 事件
analytics.subscribe('checkout_completed', (event) => {
  // Customer Privacy API 检查
  // TikTok Pixel 需要 marketing + saleOfData 同意
  const marketingAllowed = customerPrivacy.marketingAllowed();
  const saleOfDataAllowed = customerPrivacy.saleOfDataAllowed();
  
  if (!marketingAllowed) {
    console.log('[Tracking Guardian] TikTok Pixel: 用户未授权营销追踪，跳过');
    return;
  }
  
  if (!saleOfDataAllowed) {
    console.log('[Tracking Guardian] TikTok Pixel: 用户不允许数据销售，跳过');
    return;
  }
  
  const checkout = event.data?.checkout;
  if (!checkout) return;
  
  const orderId = checkout.order?.id || checkout.token;
  const value = parseFloat(checkout.totalPrice?.amount || 0);
  const currency = checkout.currencyCode || 'USD';
  
  const contents = (checkout.lineItems || []).map(item => ({
    content_id: item.variant?.product?.id || item.id,
    content_name: item.title || '',
    quantity: item.quantity || 1,
    price: parseFloat(item.variant?.price?.amount || 0),
  }));
  
  // TikTok CompletePayment 事件
  // 使用 event_id 进行去重（与服务端 Events API 配合使用时很重要）
  const eventId = orderId + '_purchase_' + Date.now();
  
  ttq.track('CompletePayment', {
    value: value,
    currency: currency,
    contents: contents,
    content_type: 'product',
    order_id: orderId,
  }, { event_id: eventId });
  
  console.log('[Tracking Guardian] TikTok CompletePayment event sent:', orderId, 'eventId:', eventId);
});

// 可选：监听其他漏斗事件
analytics.subscribe('checkout_started', (event) => {
  const marketingAllowed = customerPrivacy.marketingAllowed();
  const saleOfDataAllowed = customerPrivacy.saleOfDataAllowed();
  
  if (!marketingAllowed || !saleOfDataAllowed) return;
  
  const checkout = event.data?.checkout;
  if (!checkout) return;
  
  ttq.track('InitiateCheckout', {
    value: parseFloat(checkout.totalPrice?.amount || 0),
    currency: checkout.currencyCode || 'USD',
  });
});

analytics.subscribe('product_added_to_cart', (event) => {
  const marketingAllowed = customerPrivacy.marketingAllowed();
  const saleOfDataAllowed = customerPrivacy.saleOfDataAllowed();
  
  if (!marketingAllowed || !saleOfDataAllowed) return;
  
  const cartLine = event.data?.cartLine;
  if (!cartLine) return;
  
  ttq.track('AddToCart', {
    content_id: cartLine.merchandise?.product?.id,
    content_name: cartLine.merchandise?.product?.title,
    quantity: cartLine.quantity || 1,
    price: parseFloat(cartLine.merchandise?.price?.amount || 0),
    currency: cartLine.merchandise?.price?.currencyCode || 'USD',
  });
});

console.log('[Tracking Guardian] TikTok Pixel Custom Pixel initialized');
`;
}
