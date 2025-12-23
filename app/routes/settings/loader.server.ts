/**
 * Settings Loader
 *
 * Shared loader for settings routes.
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";
import { checkTokenExpirationIssues } from "../../services/retry.server";
import { PCD_CONFIG } from "../../utils/config";
import type { SettingsLoaderData, AlertConfigDisplay, PixelConfigDisplay } from "./types";

export async function settingsLoader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      plan: true,
      ingestionSecret: true,
      previousIngestionSecret: true,
      previousSecretExpiry: true,
      piiEnabled: true,
      pcdAcknowledged: true,
      weakConsentMode: true,
      consentStrategy: true,
      dataRetentionDays: true,
      alertConfigs: true,
      pixelConfigs: {
        where: { isActive: true },
      },
    },
  });

  let tokenIssues = { hasIssues: false, affectedPlatforms: [] as string[] };
  if (shop) {
    tokenIssues = await checkTokenExpirationIssues(shop.id);
  }

  const hasActiveGraceWindow =
    shop?.previousIngestionSecret &&
    shop?.previousSecretExpiry &&
    new Date() < shop.previousSecretExpiry;

  const data: SettingsLoaderData = {
    shop: shop
      ? {
          id: shop.id,
          domain: shopDomain,
          plan: shop.plan,
          alertConfigs: shop.alertConfigs as AlertConfigDisplay[],
          pixelConfigs: shop.pixelConfigs as PixelConfigDisplay[],
          hasIngestionSecret:
            !!shop.ingestionSecret && shop.ingestionSecret.length > 0,
          hasActiveGraceWindow: !!hasActiveGraceWindow,
          graceWindowExpiry: hasActiveGraceWindow
            ? shop.previousSecretExpiry
            : null,
          piiEnabled: shop.piiEnabled,
          pcdAcknowledged: shop.pcdAcknowledged,
          weakConsentMode: shop.weakConsentMode,
          consentStrategy: shop.consentStrategy || "strict",
          dataRetentionDays: shop.dataRetentionDays,
        }
      : null,
    tokenIssues,
    pcdApproved: PCD_CONFIG.APPROVED,
    pcdStatusMessage: PCD_CONFIG.STATUS_MESSAGE,
  };

  return json(data);
}

export type { SettingsLoaderData };

