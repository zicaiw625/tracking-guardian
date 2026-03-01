import { jsonWithCors } from "../cors";
import { getShopForPixelVerificationWithConfigs } from "../key-validation";
import { buildShopAllowedDomains } from "~/utils/origin-validation.server";
import { logger } from "~/utils/logger.server";
import { rejectionTracker } from "../rejection-tracker.server";
import { shouldRecordRejection } from "../stats-sampling";
import type { IngestContext, IngestMiddleware, MiddlewareResult } from "./types";

export const shopLoadingMiddleware: IngestMiddleware = async (
  context: IngestContext
): Promise<MiddlewareResult> => {
  if (!context.shopDomain) {
    return {
      continue: false,
      response: jsonWithCors(
        { error: "Invalid request" },
        { status: 400, request: context.request, requestId: context.requestId }
      ),
    };
  }

  const rawEnvironment = (context.validatedEvents[0]?.payload.data as { environment?: string })?.environment;
  const environment = rawEnvironment === "test" || rawEnvironment === "live" ? rawEnvironment : "live";
  const shop = await getShopForPixelVerificationWithConfigs(context.shopDomain, environment);

  if (!shop || !shop.isActive) {
    if (shouldRecordRejection(context.isProduction, false, "shop_not_found")) {
      rejectionTracker.record({
        requestId: context.requestId,
        shopDomain: context.shopDomain,
        reason: "shop_not_found",
        timestamp: Date.now(),
      });
    }
    if (context.isProduction) {
      logger.warn(`Shop not found or inactive for ingest`, {
        requestId: context.requestId,
        shopDomain: context.shopDomain,
        exists: !!shop,
        isActive: shop?.isActive,
      });
      return {
        continue: false,
        response: jsonWithCors(
          { error: "Invalid request" },
          { status: 401, request: context.request, requestId: context.requestId }
        ),
      };
    }
    return {
      continue: false,
      response: jsonWithCors(
        { error: "Shop not found or inactive" },
        { status: 401, request: context.request, requestId: context.requestId }
      ),
    };
  }

  // Ensure secrets are decrypted and expiry is respected
  // Note: getShopForPixelVerificationWithConfigs should handle this, but we reinforce it here per review
  if (shop.previousIngestionSecret && shop.previousSecretExpiry && new Date() > shop.previousSecretExpiry) {
    shop.previousIngestionSecret = null;
  }
  if (shop.pendingIngestionSecret && shop.pendingSecretExpiry && new Date() > shop.pendingSecretExpiry) {
    shop.pendingIngestionSecret = null;
  }


  const shopAllowedDomains = buildShopAllowedDomains({
    shopDomain: shop.shopDomain,
    primaryDomain: shop.primaryDomain,
    storefrontDomains: shop.storefrontDomains,
  });

  const pixelConfigs = shop.pixelConfigs;
  let mode: "purchase_only" | "full_funnel" = "purchase_only";
  for (const config of pixelConfigs) {
    if (config.clientConfig && typeof config.clientConfig === 'object') {
      if ('mode' in config.clientConfig) {
        const configMode = config.clientConfig.mode;
        if (configMode === 'full_funnel') {
          mode = "full_funnel";
          break;
        } else if (configMode === 'purchase_only') {
          mode = "purchase_only";
        }
      }
    }
  }
  const enabledConfigs = pixelConfigs.filter((config: { clientSideEnabled?: boolean | null }) => config.clientSideEnabled === true);

  return {
    continue: true,
    context: {
      ...context,
      shop,
      shopAllowedDomains,
      environment,
      mode,
      enabledPixelConfigs: enabledConfigs,
    },
  };
};
