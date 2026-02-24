import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import type { TFunction } from "i18next";
import { authenticate } from "../../shopify.server";
import { i18nServer } from "../../i18n.server";
import prisma from "../../db.server";
import { isPlanAtLeast } from "../../utils/plans";
import { getPixelEventIngestionUrl } from "../../utils/config.server";

function getPresetTemplates(t: TFunction) {
  return [
    {
      id: "standard",
      name: t("pixels.loader.templates.standard.name"),
      description: t("pixels.loader.templates.standard.description"),
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
      name: t("pixels.loader.templates.advanced.name"),
      description: t("pixels.loader.templates.advanced.description"),
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
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const t = await i18nServer.getFixedT(request);
  const shopDomain = session.shop;
  const presetTemplates = getPresetTemplates(t);
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
        presets: presetTemplates,
        custom: [],
      },
      isStarterOrAbove: false,
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
      presets: presetTemplates,
      custom: [],
    },
    isStarterOrAbove,
    backendUrlInfo,
  });
};
