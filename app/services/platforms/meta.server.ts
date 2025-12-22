import type { ConversionData, MetaCredentials, ConversionApiResponse } from "../../types";
import { hashValue, normalizePhone, normalizeEmail } from "../../utils/crypto";
import { 
  classifyHttpError, 
  classifyJsError, 
  parseMetaError,
  type PlatformError,
} from "./base.server";
import { logger } from "../../utils/logger";

const META_API_VERSION = "v21.0";
const META_API_TIMEOUT_MS = 30000; 

interface MetaUserData {
  em?: string[];
  ph?: string[];
  fn?: string[];
  ln?: string[];
  ct?: string[];
  st?: string[];
  country?: string[];
  zp?: string[];
}

async function buildHashedUserData(
  conversionData: ConversionData,
  orderId: string
): Promise<{ userData: MetaUserData; piiQuality: string }> {
  const userData: MetaUserData = {};
  const availableFields: string[] = [];
  const missingFields: string[] = [];

  if (conversionData.email) {
    userData.em = [await hashValue(normalizeEmail(conversionData.email))];
    availableFields.push("email");
  } else {
    missingFields.push("email");
  }

  if (conversionData.phone) {
    userData.ph = [await hashValue(normalizePhone(conversionData.phone))];
    availableFields.push("phone");
  } else {
    missingFields.push("phone");
  }

  if (conversionData.firstName) {
    const normalized = conversionData.firstName.toLowerCase().trim();
    if (normalized) {
      userData.fn = [await hashValue(normalized)];
      availableFields.push("firstName");
    }
  }

  if (conversionData.lastName) {
    const normalized = conversionData.lastName.toLowerCase().trim();
    if (normalized) {
      userData.ln = [await hashValue(normalized)];
      availableFields.push("lastName");
    }
  }

  if (conversionData.city) {
    const normalized = conversionData.city.toLowerCase().replace(/\s/g, '');
    if (normalized) {
      userData.ct = [await hashValue(normalized)];
      availableFields.push("city");
    }
  }

  if (conversionData.state) {
    const normalized = conversionData.state.toLowerCase().trim();
    if (normalized) {
      userData.st = [await hashValue(normalized)];
      availableFields.push("state");
    }
  }

  if (conversionData.country) {
    const normalized = conversionData.country.toLowerCase().trim();
    if (normalized) {
      userData.country = [await hashValue(normalized)];
      availableFields.push("country");
    }
  }

  if (conversionData.zip) {
    const normalized = conversionData.zip.replace(/\s/g, '');
    if (normalized) {
      userData.zp = [await hashValue(normalized)];
      availableFields.push("zip");
    }
  }
  
  let piiQuality: string;
  if (availableFields.length === 0) {
    piiQuality = "none";
  } else if (availableFields.includes("email") || availableFields.includes("phone")) {
    piiQuality = "good";
  } else {
    piiQuality = "partial";
  }

  if (missingFields.length > 0 && process.env.NODE_ENV !== "test") {
    logger.debug(`[P0-01] Meta CAPI PII status for order ${orderId.slice(0, 8)}...`, {
      piiQuality,
      availableFieldCount: availableFields.length,
      totalPossibleFields: 8,
    });
  }

  return { userData, piiQuality };
}

export async function sendConversionToMeta(
  credentials: MetaCredentials | null,
  conversionData: ConversionData,
  eventId?: string
): Promise<ConversionApiResponse> {
  if (!credentials?.pixelId || !credentials?.accessToken) {
    throw new Error("Meta Pixel credentials not configured");
  }

  if (!/^\d{15,16}$/.test(credentials.pixelId)) {
    throw new Error("Invalid Meta Pixel ID format");
  }

  const eventTime = Math.floor(Date.now() / 1000);

  const { userData, piiQuality } = await buildHashedUserData(
    conversionData, 
    conversionData.orderId
  );

  if (piiQuality === "none") {
    logger.info(`[P0-01] Sending Meta conversion with no PII for order ${conversionData.orderId.slice(0, 8)}...`, {
      platform: "meta",
      piiQuality,
      note: "Conversion will still be recorded but may have lower match rate",
    });
  }

  const contents = conversionData.lineItems?.map((item) => ({
    id: item.productId,
    quantity: item.quantity,
    item_price: item.price,
  })) || [];

  const dedupeEventId = eventId || `${conversionData.orderId}_purchase_${eventTime}`;

  const eventPayload = {
    data: [
      {
        event_name: "Purchase",
        event_time: eventTime,
        event_id: dedupeEventId, 
        action_source: "website",
        user_data: userData,
        custom_data: {
          currency: conversionData.currency,
          value: conversionData.value,
          order_id: conversionData.orderId,
          contents,
          content_type: "product",
        },
      },
    ],
    ...(credentials.testEventCode && { test_event_code: credentials.testEventCode }),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), META_API_TIMEOUT_MS);

  try {

  const response = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${credentials.pixelId}/events`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
          "Authorization": `Bearer ${credentials.accessToken}`,
      },
        body: JSON.stringify({
          ...eventPayload,
          access_token: credentials.accessToken,
        }),
        signal: controller.signal,
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));

    let platformError: PlatformError;
    if (errorData.error) {
      platformError = parseMetaError(errorData);
    } else {
      platformError = classifyHttpError(response.status, errorData);
    }

    const enhancedError = new Error(`Meta API error: ${platformError.message}`) as Error & { 
      platformError: PlatformError;
    };
    enhancedError.platformError = platformError;
    throw enhancedError;
  }

  const result = await response.json();
  
  return {
    success: true,
    events_received: result.events_received,
    fbtrace_id: result.fbtrace_id,
    timestamp: new Date().toISOString(),
  };
} catch (error) {
  
  if (error instanceof Error) {
    if ((error as Error & { platformError?: PlatformError }).platformError) {
      throw error;
    }

    const platformError = classifyJsError(error);
    const enhancedError = new Error(error.message) as Error & { platformError: PlatformError };
    enhancedError.platformError = platformError;
    throw enhancedError;
  }
  throw error;
} finally {
  clearTimeout(timeoutId);
}
}

export function extractMetaError(error: unknown): PlatformError | null {
  if (error instanceof Error) {
    return (error as Error & { platformError?: PlatformError }).platformError || null;
  }
  return null;
}

/**
 * P0-6: Generate Custom Pixel (Web Pixel) code template for Meta (Facebook) Pixel
 * 
 * This generates code suitable for Shopify's Custom Pixel (manual) configuration.
 * The code runs in the Web Pixels sandbox and uses the Customer Privacy API.
 * 
 * Note: We recommend using our App Pixel (automatic) with server-side CAPI instead.
 * This template is provided for merchants who prefer manual configuration.
 */
export function generateMetaPixelCode(config: { pixelId: string }): string {
  if (!config.pixelId) {
    return "";
  }

  return `// Tracking Guardian - Meta (Facebook) Pixel Custom Pixel Template
// 
// 📋 使用说明：
// 1. 前往 Shopify 后台 → 设置 → 客户事件
// 2. 点击"添加自定义 Pixel"
// 3. 粘贴此代码并保存
// 4. 在 Meta Events Manager 验证事件是否正确接收
//
// ⚠️ 推荐：使用 Tracking Guardian App Pixel + 服务端 CAPI 可获得更高的匹配率（15-30%提升）

const META_PIXEL_ID = "${config.pixelId}";

// 加载 Meta Pixel SDK
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');

// 初始化 Pixel
fbq('init', META_PIXEL_ID);

// 监听 checkout_completed 事件
analytics.subscribe('checkout_completed', (event) => {
  // Customer Privacy API 检查
  // Meta Pixel 需要 marketing + analytics + saleOfData 同意
  const analyticsAllowed = customerPrivacy.analyticsProcessingAllowed();
  const marketingAllowed = customerPrivacy.marketingAllowed();
  const saleOfDataAllowed = customerPrivacy.saleOfDataAllowed();
  
  if (!marketingAllowed || !analyticsAllowed) {
    console.log('[Tracking Guardian] Meta Pixel: 用户未授权营销/分析追踪，跳过');
    return;
  }
  
  if (!saleOfDataAllowed) {
    console.log('[Tracking Guardian] Meta Pixel: 用户不允许数据销售，跳过');
    return;
  }
  
  const checkout = event.data?.checkout;
  if (!checkout) return;
  
  const orderId = checkout.order?.id || checkout.token;
  const value = parseFloat(checkout.totalPrice?.amount || 0);
  const currency = checkout.currencyCode || 'USD';
  
  const contents = (checkout.lineItems || []).map(item => ({
    id: item.variant?.product?.id || item.id,
    quantity: item.quantity || 1,
    item_price: parseFloat(item.variant?.price?.amount || 0),
  }));
  
  const numItems = contents.reduce((sum, item) => sum + item.quantity, 0);
  
  // Meta Purchase 事件
  // 使用 eventID 进行去重（与服务端 CAPI 配合使用时很重要）
  const eventID = orderId + '_purchase_' + Date.now();
  
  fbq('track', 'Purchase', {
    value: value,
    currency: currency,
    content_ids: contents.map(c => c.id),
    contents: contents,
    content_type: 'product',
    num_items: numItems,
    order_id: orderId,
  }, { eventID: eventID });
  
  console.log('[Tracking Guardian] Meta Purchase event sent:', orderId, 'eventID:', eventID);
});

// 可选：监听其他漏斗事件
analytics.subscribe('checkout_started', (event) => {
  const marketingAllowed = customerPrivacy.marketingAllowed();
  const saleOfDataAllowed = customerPrivacy.saleOfDataAllowed();
  
  if (!marketingAllowed || !saleOfDataAllowed) return;
  
  const checkout = event.data?.checkout;
  if (!checkout) return;
  
  fbq('track', 'InitiateCheckout', {
    value: parseFloat(checkout.totalPrice?.amount || 0),
    currency: checkout.currencyCode || 'USD',
    num_items: (checkout.lineItems || []).reduce((sum, item) => sum + (item.quantity || 1), 0),
  });
});

console.log('[Tracking Guardian] Meta Pixel Custom Pixel initialized');
`;
}
