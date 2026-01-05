

import { Prisma } from "@prisma/client";
import { logger } from "../utils/logger.server";
import prisma from "../db.server";

export type AnalyticsEvent =
  | "app_install_completed"
  | "audit_started"
  | "audit_completed"
  | "migration_plan_viewed"
  | "pixel_destination_created"
  | "verification_started"
  | "verification_passed"
  | "pixel_live_enabled"
  | "subscription_started"
  | "subscription_upgraded";

export interface AnalyticsEventData {
  shopId: string;
  shopDomain: string;
  event: AnalyticsEvent;
  metadata?: Record<string, unknown>;
  timestamp?: Date;
}

export async function trackEvent(data: AnalyticsEventData): Promise<void> {
  try {
    const timestamp = data.timestamp || new Date();

    logger.info("[Analytics] Track event", {
      shopId: data.shopId,
      shopDomain: data.shopDomain,
      event: data.event,
      metadata: data.metadata,
      timestamp: timestamp.toISOString(),
    });

  } catch (error) {
    logger.error("[Analytics] Failed to track event", {
      error: error instanceof Error ? error.message : String(error),
      event: data.event,
      shopId: data.shopId,
    });
  }
}

export interface ActivationStatus {
  d1: boolean;
  d2: boolean;
  d3: boolean;
  d7: boolean;
}

export async function getActivationStatus(shopId: string): Promise<ActivationStatus> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      ScanReports: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true },
      },
      pixelConfigs: {
        where: { environment: "test", isActive: true },
        select: { id: true },
      },
      _count: {
        select: {
          pixelConfigs: {
            where: { environment: "live", isActive: true },
          },
          VerificationRun: {
            where: {
              status: "completed",
              summaryJson: {
                path: ["successfulEvents"],
                not: Prisma.JsonNull,
              },
            },
          },
        },
      },
    },
  });

  const hasCompletedAudit =
    shop?.ScanReports?.[0]?.status === "completed";

  const hasTestDestination = (shop?.pixelConfigs?.length || 0) > 0;

  const hasLiveDestination = (shop?._count?.pixelConfigs || 0) > 0;
  const hasCompletedVerification = (shop?._count?.VerificationRun || 0) > 0;
  const d3 = hasLiveDestination && hasCompletedVerification;

  const d7 = false;

  return {
    d1: hasCompletedAudit,
    d2: hasTestDestination,
    d3,
    d7,
  };
}

