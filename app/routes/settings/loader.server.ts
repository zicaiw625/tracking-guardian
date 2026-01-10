import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";
import { checkTokenExpirationIssues } from "../../services/retry.server";

import { getEventMonitoringStats, getMissingParamsStats, getEventVolumeStats } from "../../services/monitoring.server";
import { logger } from "../../utils/logger.server";
import type { SettingsLoaderData, AlertConfigDisplay, PixelConfigDisplay } from "./types";

export async function settingsLoader({ request }: LoaderFunctionArgs) {
  try {
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
    const alertConfigsFromShop: Array<{
      id: string;
      channel: string;
      settings: unknown;
      frequency: string;
      discrepancyThreshold: number;
      isEnabled: boolean;
    }> = [];
    let tokenIssues = { hasIssues: false, affectedPlatforms: [] as string[] };
    if (shop) {
      try {
        tokenIssues = await checkTokenExpirationIssues(shop.id);
      } catch (error) {
        logger.error("Failed to check token expiration issues", { error, shopId: shop.id });
      }
    }
    const hasActiveGraceWindow =
      shop?.previousIngestionSecret &&
      shop?.previousSecretExpiry &&
      new Date() < shop.previousSecretExpiry;
    const alertConfigs: AlertConfigDisplay[] = [];
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
        const totalWithMissingParams = missingParamsStats.reduce((sum, s) => sum + s.count, 0);
        const missingParamsRate =
          monitoringStats.totalEvents > 0
            ? (totalWithMissingParams / monitoringStats.totalEvents) * 100
            : 0;
        currentMonitoringData = {
          failureRate: monitoringStats.failureRate,
          missingParamsRate,
          volumeDrop: volumeStats.isDrop ? Math.abs(volumeStats.changePercent) : 0,
        };
      } catch (error) {
        logger.error("Failed to fetch monitoring data for preview", { error });
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
      pcdStatusMessage: "v1.0 版本不包含任何 PCD/PII 处理功能",
      currentMonitoringData,
    };
    return json(data);
  } catch (error) {
    logger.error("Settings loader error", error);
    throw error;
  }
}

export type { SettingsLoaderData };
