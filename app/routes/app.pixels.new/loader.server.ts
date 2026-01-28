import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";
import { isPlanAtLeast } from "../../utils/plans";
import { FEATURE_FLAGS, getPixelEventIngestionUrl } from "../../utils/config.server";

const PRESET_TEMPLATES = [
  {
    id: "standard",
    name: "标准配置（v1）",
    description: "适用于大多数电商店铺的标准事件映射（GA4/Meta/TikTok）",
    platforms: ["google", "meta", "tiktok"],
    eventMappings: {
      google: {
        checkout_completed: "purchase",
      },
      meta: {
        checkout_completed: "Purchase",
      },
      tiktok: {
        checkout_completed: "CompletePayment",
      },
    },
    isPublic: true,
    usageCount: 0,
  },
  {
    id: "advanced",
    name: "高级配置（v1.1+）",
    description: "包含更多事件类型的完整映射（v1.1+ 将支持 Pinterest/Snapchat）",
    platforms: ["google", "meta", "tiktok"],
    eventMappings: {
      google: {
        checkout_completed: "purchase",
        checkout_started: "begin_checkout",
        product_added_to_cart: "add_to_cart",
      },
      meta: {
        checkout_completed: "Purchase",
        checkout_started: "InitiateCheckout",
        product_added_to_cart: "AddToCart",
      },
      tiktok: {
        checkout_completed: "CompletePayment",
        checkout_started: "InitiateCheckout",
        product_added_to_cart: "AddToCart",
      },
    },
    isPublic: true,
    usageCount: 0,
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      shopDomain: true,
      plan: true,
      ingestionSecret: true,
      webPixelId: true,
      updatedAt: true,
    },
  });
  if (!shop) {
    return json({
      shop: null,
      templates: {
        presets: PRESET_TEMPLATES,
        custom: [],
      },
      isStarterOrAbove: false,
      trackingApiEnabled: FEATURE_FLAGS.TRACKING_API,
      backendUrlInfo: getPixelEventIngestionUrl(),
    });
  }
  const isStarterOrAbove = isPlanAtLeast(shop.plan, "starter");
  const backendUrlInfo = getPixelEventIngestionUrl();
  return json({
    shop: {
      id: shop.id,
      domain: shop.shopDomain,
      webPixelId: shop.webPixelId,
      hasIngestionSecret: !!shop.ingestionSecret,
      lastRotatedAt: shop.updatedAt ? shop.updatedAt.toISOString() : null,
    },
    templates: {
      presets: PRESET_TEMPLATES,
      custom: [],
    },
    isStarterOrAbove,
    trackingApiEnabled: FEATURE_FLAGS.TRACKING_API,
    backendUrlInfo,
  });
};
