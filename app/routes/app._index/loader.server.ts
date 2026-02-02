import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import { getDashboardData } from "../../services/dashboard.server";
import { getPixelEventIngestionUrl } from "../../utils/config.server";
import prisma from "../../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const data = await getDashboardData(session.shop);
  const { checkCustomerAccountsEnabled } = await import("../../services/customer-accounts.server");
  const customerAccountsStatus = await checkCustomerAccountsEnabled(admin);
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
    ...data,
    customerAccountsEnabled: customerAccountsStatus.enabled,
    shopDomain,
    backendUrlInfo,
    dataConnection: {
      hasIngestionSecret,
      hasWebPixel,
      webPixelHasIngestionKey,
    },
  });
};
