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
      // P0-1: Only select non-sensitive fields for alertConfigs
      // Excludes: settings (legacy, may contain sensitive data), settingsEncrypted
      alertConfigs: {
        select: {
          id: true,
          channel: true,
          discrepancyThreshold: true,
          isEnabled: true,
          // Note: 'settings' field excluded - frontend doesn't need it for display
          // and it may contain sensitive webhook URLs or tokens
        },
      },
      // P0-1: Only select non-sensitive fields for pixelConfigs
      // Excludes: credentials, credentialsEncrypted, clientConfig, eventMappings
      pixelConfigs: {
        where: { isActive: true },
        select: {
          id: true,
          platform: true,
          platformId: true,
          serverSideEnabled: true,
          clientSideEnabled: true,
          isActive: true,
          updatedAt: true, // Used as lastTestedAt proxy in frontend
        },
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

  // P0-1: Explicitly map fields to avoid exposing sensitive data
  // Use explicit mapping instead of type assertion to ensure type safety
  const alertConfigs: AlertConfigDisplay[] = shop?.alertConfigs.map((config) => ({
    id: config.id,
    channel: config.channel,
    discrepancyThreshold: config.discrepancyThreshold,
    isEnabled: config.isEnabled,
  })) ?? [];

  const pixelConfigs: PixelConfigDisplay[] = shop?.pixelConfigs.map((config) => ({
    id: config.id,
    platform: config.platform,
    platformId: config.platformId,
    serverSideEnabled: config.serverSideEnabled,
    clientSideEnabled: config.clientSideEnabled,
    isActive: config.isActive,
    lastTestedAt: config.updatedAt, // Map updatedAt to lastTestedAt for frontend
  })) ?? [];

  const data: SettingsLoaderData = {
    shop: shop
      ? {
          id: shop.id,
          domain: shopDomain,
          plan: shop.plan,
          alertConfigs,
          pixelConfigs,
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

