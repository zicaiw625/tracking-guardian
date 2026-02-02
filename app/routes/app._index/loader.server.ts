import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import { getPixelEventIngestionUrl } from "../../utils/config.server";
import prisma from "../../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const backendUrlInfo = getPixelEventIngestionUrl();
  
  const shopDomain = session.shop;
  const { getExistingWebPixels, isOurWebPixel, needsSettingsUpgrade } = await import("../../services/migration.server");
  
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, ingestionSecret: true },
  });
  
  let hasIngestionSecret = false;
  let hasWebPixel = false;
  let webPixelHasIngestionKey = false;
  
  if (shop) {
    hasIngestionSecret = !!shop.ingestionSecret;
    
    try {
      const existingPixels = await getExistingWebPixels(admin);
      const ourPixel = existingPixels.find((p) => {
        try {
          const settings = JSON.parse(p.settings || "{}");
          return isOurWebPixel(settings, shopDomain);
        } catch {
          return false;
        }
      });
      
      if (ourPixel) {
        hasWebPixel = true;
        if (ourPixel.settings) {
          try {
            const pixelSettings = JSON.parse(ourPixel.settings);
            if (!needsSettingsUpgrade(pixelSettings)) {
              webPixelHasIngestionKey = typeof pixelSettings.ingestion_key === "string" && pixelSettings.ingestion_key.length > 0;
            }
          } catch {
            webPixelHasIngestionKey = false;
          }
        }
      }
    } catch {
      void 0;
    }
  }
  
  return json({
    shopDomain,
    backendUrlInfo,
    dataConnection: {
      hasIngestionSecret,
      hasWebPixel,
      webPixelHasIngestionKey,
    },
  });
};
