import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";
import { checkTokenExpirationIssues } from "../../services/retry.server";
import { getCachedTypOspStatus, refreshTypOspStatus } from "../../services/checkout-profile.server";
import { getEventMonitoringStats, getEventVolumeStats } from "../../services/monitoring.server";
import { logger } from "../../utils/logger.server";
import type { SettingsLoaderData, PixelConfigDisplay, AlertConfigDisplay, TypOspStatusDisplay } from "./types";

export async function settingsLoader({ request }: LoaderFunctionArgs) {
  try {
    const { session, admin } = await authenticate.admin(request);
    const shopDomain = session.shop;
    let shop: {
      id: string;
      plan: string | null;
      ingestionSecret: string | null;
      previousIngestionSecret: string | null;
      previousSecretExpiry: Date | null;
      consentStrategy: string | null;
      dataRetentionDays: number;
      settings?: unknown;
      pixelConfigs: Array<{
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
      }>;
    } | null;
    try {
      shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: {
          id: true,
          plan: true,
          ingestionSecret: true,
          previousIngestionSecret: true,
          previousSecretExpiry: true,
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
        shop = (await prisma.shop.findUnique({
          where: { shopDomain },
          select: {
            id: true,
            plan: true,
            ingestionSecret: true,
            previousIngestionSecret: true,
            previousSecretExpiry: true,
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
        })) as typeof shop;
        if (shop) {
          shop.settings = null;
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
      volumeDrop: number;
    } | null = null;
    if (shop) {
      try {
        const [monitoringStats, volumeStats] = await Promise.all([
          getEventMonitoringStats(shop.id, 24),
          getEventVolumeStats(shop.id),
        ]);
        const volumeDrop = volumeStats.changePercent < 0 ? Math.abs(volumeStats.changePercent) : 0;
        currentMonitoringData = {
          failureRate: monitoringStats.failureRate,
          volumeDrop,
        };
      } catch (error) {
        logger.error("Failed to fetch monitoring data for preview", { error });
      }
    }
    const pixelStrictOrigin = ["true", "1", "yes"].includes(
      (process.env.PIXEL_STRICT_ORIGIN ?? "").toLowerCase().trim()
    );
    const alertChannelsEnabled = ["true", "1", "yes"].includes(
      (process.env.ALERT_CHANNELS_ENABLED ?? "").toLowerCase().trim()
    );
    let typOspStatus: TypOspStatusDisplay | null = null;
    if (shop && admin) {
      try {
        const cached = await getCachedTypOspStatus(shop.id);
        if (cached.isStale) {
          const result = await refreshTypOspStatus(admin, shop.id);
          typOspStatus = {
            typOspPagesEnabled: result.typOspPagesEnabled,
            status: result.status,
            unknownReason: result.status === "unknown" ? result.unknownReason ?? null : null,
          };
        } else {
          typOspStatus = {
            typOspPagesEnabled: cached.typOspPagesEnabled,
            status: cached.status,
            unknownReason: null,
          };
        }
      } catch (error) {
        logger.error("Failed to get typOsp status for settings", { shopId: shop.id, error });
      }
    }
    const rawSettings = (shop && "settings" in shop && shop.settings && typeof shop.settings === "object") ? shop.settings as Record<string, unknown> : null;
    const rawAlertConfigs = rawSettings?.alertConfigs && Array.isArray(rawSettings.alertConfigs) ? rawSettings.alertConfigs : [];
    const alertConfigs: AlertConfigDisplay[] = rawAlertConfigs.map((c: unknown, i: number) => {
      const item = c && typeof c === "object" ? c as Record<string, unknown> : {};
      return {
        id: typeof item.id === "string" ? item.id : `alert-${i}`,
        channel: typeof item.channel === "string" ? item.channel : "email",
        settings: item.settings && typeof item.settings === "object" ? item.settings as Record<string, unknown> : null,
        frequency: typeof item.frequency === "string" ? item.frequency : undefined,
        discrepancyThreshold: typeof item.discrepancyThreshold === "number" ? item.discrepancyThreshold : 10,
        isEnabled: typeof item.isEnabled === "boolean" ? item.isEnabled : true,
      };
    });
    const data: SettingsLoaderData = {
      shop: shop
        ? {
            id: shop.id,
            domain: shopDomain,
            plan: shop.plan || "free",
            alertConfigs,
            pixelConfigs,
            hasIngestionSecret:
              !!shop.ingestionSecret && shop.ingestionSecret.length > 0,
            hasActiveGraceWindow: !!hasActiveGraceWindow,
            hasExpiredPreviousSecret: !!hasExpiredPreviousSecret,
            graceWindowExpiry: hasActiveGraceWindow && shop.previousSecretExpiry
              ? shop.previousSecretExpiry
              : null,
            consentStrategy: shop.consentStrategy || "strict",
            dataRetentionDays: shop.dataRetentionDays,
          }
        : null,
      tokenIssues,
      pcdApproved: false,
      pcdStatusMessage: "我们不收集终端客户 PII，当前公开上架版本不会从 Shopify 读取订单明细或访问 PCD。未来如引入基于订单的验收/对账或再购等功能，将在获得 PCD 审批后单独启用并更新隐私文档。",
      typOspStatus,
      pixelStrictOrigin,
      alertChannelsEnabled,
      currentMonitoringData,
      hmacSecurityStats: null,
    };
    return json(data);
  } catch (error) {
    logger.error("Settings loader error", error);
    throw error;
  }
}

export type { SettingsLoaderData };
