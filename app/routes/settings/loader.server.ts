import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";
import { checkTokenExpirationIssues } from "../../services/retry.server";

import { getEventMonitoringStats, getMissingParamsStats, getEventVolumeStats } from "../../services/monitoring.server";
import { getHMACSecurityStats } from "../../services/security-monitoring.server";
import { logger } from "../../utils/logger.server";
import type { SettingsLoaderData, AlertConfigDisplay, PixelConfigDisplay } from "./types";

export async function settingsLoader({ request }: LoaderFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;
    let shop;
    let hasSettingsColumn = true;
    try {
      shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: {
          id: true,
          plan: true,
          ingestionSecret: true,
          previousIngestionSecret: true,
          previousSecretExpiry: true,
          weakConsentMode: true,
          consentStrategy: true,
          dataRetentionDays: true,
          settings: true,
          pixelConfigs: {
            where: { isActive: true },
            select: {
              id: true,
              platform: true,
              platformId: true,
              serverSideEnabled: true,
              clientSideEnabled: true,
              isActive: true,
              updatedAt: true,
              environment: true,
              configVersion: true,
              rollbackAllowed: true,
            },
          },
        },
      });
    } catch (error) {
      if (error instanceof Error && (error.message.includes("settings") && (error.message.includes("does not exist") || error.message.includes("P2022")))) {
        logger.error("Shop.settings column does not exist. Database migration required. Please run: ALTER TABLE \"Shop\" ADD COLUMN IF NOT EXISTS \"settings\" JSONB;", { shopDomain, error: error.message });
        hasSettingsColumn = false;
        shop = await prisma.shop.findUnique({
          where: { shopDomain },
          select: {
            id: true,
              plan: true,
              ingestionSecret: true,
              previousIngestionSecret: true,
              previousSecretExpiry: true,
              weakConsentMode: true,
              consentStrategy: true,
              dataRetentionDays: true,
              pixelConfigs: {
                where: { isActive: true },
                select: {
                  id: true,
                  platform: true,
                  platformId: true,
                  serverSideEnabled: true,
                  clientSideEnabled: true,
                  isActive: true,
                  updatedAt: true,
                  environment: true,
                  configVersion: true,
                  rollbackAllowed: true,
                },
              },
            },
          });
          if (shop) {
            (shop as { settings?: unknown }).settings = null;
          }
      } else {
        throw error;
      }
    }
    let tokenIssues = { hasIssues: false, affectedPlatforms: [] as string[] };
    if (shop) {
      try {
        tokenIssues = await checkTokenExpirationIssues(shop.id);
      } catch (error) {
        logger.error("Failed to check token expiration issues", { error, shopId: shop.id });
      }
    }
    const now = new Date();
    const hasActiveGraceWindow =
      shop?.previousIngestionSecret &&
      shop?.previousSecretExpiry &&
      now < shop.previousSecretExpiry;
    const hasExpiredPreviousSecret =
      shop?.previousIngestionSecret &&
      shop?.previousSecretExpiry &&
      now >= shop.previousSecretExpiry;
    
    if (shop && hasExpiredPreviousSecret) {
      try {
        await prisma.shop.update({
          where: { id: shop.id },
          data: {
            previousIngestionSecret: null,
            previousSecretExpiry: null,
          },
        });
        shop.previousIngestionSecret = null;
        shop.previousSecretExpiry = null;
      } catch (error) {
        logger.error("Failed to cleanup expired previous ingestion secret", { shopId: shop.id, error });
      }
    }
    const alertConfigs: AlertConfigDisplay[] = [];
    if (hasSettingsColumn && (shop as { settings?: unknown })?.settings) {
      try {
        const settings = (shop as { settings?: unknown }).settings as Record<string, unknown>;
        const configs = (settings.alertConfigs as Array<Record<string, unknown>>) || [];
        for (const config of configs) {
          alertConfigs.push({
            id: (config.id as string) || `alert_${Date.now()}`,
            channel: (config.channel as "email" | "slack" | "telegram") || "email",
            isEnabled: (config.enabled as boolean) || false,
            discrepancyThreshold: ((config.thresholds as Record<string, number>)?.failureRate || 0.1) * 100,
            frequency: (config.frequency as "instant" | "daily" | "weekly") || "daily",
            settings: config as Record<string, unknown>,
          });
        }
      } catch (error) {
        logger.warn("Failed to parse alert configs from settings", { shopDomain, error });
      }
    }
    const pixelConfigs: PixelConfigDisplay[] = shop?.pixelConfigs?.map((config: {
      id: string;
      platform: string;
      platformId: string | null;
      serverSideEnabled: boolean;
      clientSideEnabled: boolean;
      isActive: boolean;
      updatedAt: Date;
      environment: string;
      configVersion: number;
      rollbackAllowed: boolean;
    }) => ({
      id: config.id,
      platform: config.platform,
      platformId: config.platformId,
      serverSideEnabled: config.serverSideEnabled,
      clientSideEnabled: config.clientSideEnabled,
      isActive: config.isActive,
      environment: config.environment as "test" | "live" | undefined,
      configVersion: config.configVersion,
      rollbackAllowed: config.rollbackAllowed,
      lastTestedAt: config.updatedAt,
    })) ?? [];
    let currentMonitoringData: {
      failureRate: number;
      missingParamsRate: number;
      volumeDrop: number;
    } | null = null;
    if (shop) {
      try {
        const [monitoringStats, missingParamsStats, volumeStats] = await Promise.all([
          getEventMonitoringStats(shop.id, 24),
          getMissingParamsStats(shop.id, 24),
          getEventVolumeStats(shop.id),
        ]);
        const missingParamsRate = missingParamsStats.missingParamsRate;
        const volumeDrop = volumeStats.changePercent < 0 ? Math.abs(volumeStats.changePercent) : 0;
        currentMonitoringData = {
          failureRate: monitoringStats.failureRate,
          missingParamsRate,
          volumeDrop,
        };
      } catch (error) {
        logger.error("Failed to fetch monitoring data for preview", { error });
      }
    }
    let hmacSecurityStats = null;
    if (shop) {
      try {
        hmacSecurityStats = await getHMACSecurityStats(shop.id, 24);
      } catch (error) {
        logger.error("Failed to get HMAC security stats", { error });
      }
    }
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
            hasExpiredPreviousSecret: !!hasExpiredPreviousSecret,
            graceWindowExpiry: hasActiveGraceWindow && shop.previousSecretExpiry
              ? shop.previousSecretExpiry
              : null,
            weakConsentMode: shop.weakConsentMode,
            consentStrategy: shop.consentStrategy || "strict",
            dataRetentionDays: shop.dataRetentionDays,
          }
        : null,
      tokenIssues,
      pcdApproved: false,
      pcdStatusMessage: "我们不收集终端客户 PII；read_orders 仅用于对账验收且字段最小化；再购等需 PCD 审批后启用。",
      currentMonitoringData,
      hmacSecurityStats,
    };
    return json(data);
  } catch (error) {
    logger.error("Settings loader error", error);
    throw error;
  }
}

export type { SettingsLoaderData };
