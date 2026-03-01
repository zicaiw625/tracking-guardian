import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import { getDashboardData } from "../../services/dashboard.server";
import { getPixelEventIngestionUrl } from "../../utils/config.server";
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { getPixelDiagnosticSignals } from "../../lib/pixel-events/pixel-diagnostics-tracker.server";

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
    select: {
      id: true,
      ingestionSecret: true,
      pendingIngestionSecret: true,
      pendingSecretExpiry: true,
      previousIngestionSecret: true,
      previousSecretExpiry: true,
    },
  });
  
  let hasIngestionSecret = false;
  let hasWebPixel = false;
  let webPixelHasIngestionKey = false;
  let recentMissingIngestionKeySignal = false;
  let recentBackendDiagnosticSignal = false;
  let recentDiagnosticAt: string | null = null;
  let pendingSecretRotation = false;
  let previousSecretGraceMinutesRemaining = 0;
  
  if (shop) {
    hasIngestionSecret = !!shop.ingestionSecret;
    pendingSecretRotation =
      Boolean(shop.pendingIngestionSecret) &&
      Boolean(shop.pendingSecretExpiry) &&
      new Date() < shop.pendingSecretExpiry!;
    if (shop.previousIngestionSecret && shop.previousSecretExpiry) {
      const remainingMs = shop.previousSecretExpiry.getTime() - Date.now();
      previousSecretGraceMinutesRemaining = Math.max(0, Math.ceil(remainingMs / 60000));
    }

    try {
      const diagnostic = await getPixelDiagnosticSignals(shopDomain);
      recentMissingIngestionKeySignal = diagnostic.counts.missing_ingestion_key > 0;
      recentBackendDiagnosticSignal =
        diagnostic.counts.backend_unavailable > 0 ||
        diagnostic.counts.backend_url_not_injected > 0;
      recentDiagnosticAt = diagnostic.latest
        ? new Date(diagnostic.latest.timestamp).toISOString()
        : null;
    } catch (error) {
      logger.warn("Failed to load recent pixel diagnostic signals", {
        shopDomain,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    
    try {
      const existingPixels = await getExistingWebPixels(admin);
      const ourPixel = existingPixels.find((p) => {
        try {
          const settings = JSON.parse(p.settings || "{}");
          return isOurWebPixel(settings, shopDomain);
        } catch (e) {
          logger.warn("Failed to parse pixel settings", { error: e, pixelId: p.id });
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
          } catch (e) {
            logger.warn("Failed to parse our pixel settings", { error: e, pixelId: ourPixel.id });
            webPixelHasIngestionKey = false;
          }
        }
      }
    } catch (e) {
      logger.error("Failed to check existing web pixels", e, { shopDomain });
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
      webPixelHasIngestionKey: webPixelHasIngestionKey && !recentMissingIngestionKeySignal,
      recentMissingIngestionKeySignal,
      recentBackendDiagnosticSignal,
      recentDiagnosticAt,
      pendingSecretRotation,
      previousSecretGraceMinutesRemaining,
    },
  });
};
