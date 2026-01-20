import { Prisma } from "@prisma/client";
import { logger } from "../utils/logger.server";
import prisma from "../db.server";
import { generateSimpleId } from "../utils/helpers";
import { sanitizePII } from "./event-log.server";

export type AnalyticsEvent =
  | "app_onboarding_started"
  | "app_install_completed"
  | "app_audit_completed"
  | "audit_started"
  | "audit_completed"
  | "migration_plan_viewed"
  | "cfg_pixel_created"
  | "cfg_pixel_live_enabled"
  | "pixel_destination_created"
  | "px_event_received"
  | "px_ingest_accepted_count"
  | "px_validate_failed_count"
  | "px_dedup_dropped_count"
  | "px_destination_ok_count"
  | "px_destination_fail_count"
  | "px_destination_latency_ms"
  | "verification_started"
  | "ver_run_completed"
  | "verification_passed"
  | "pixel_live_enabled"
  | "app_paywall_viewed"
  | "app_upgrade_clicked"
  | "subscription_started"
  | "app_subscription_created"
  | "app_subscription_failed"
  | "subscription_upgraded";

export interface AnalyticsEventData {
  shopId: string;
  shopDomain: string;
  event: AnalyticsEvent;
  metadata?: Record<string, unknown>;
  timestamp?: Date;
  eventId?: string;
}

function toSnakeCaseKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function normalizeMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeMetadataValue(item));
  }
  if (value instanceof Date || value === null || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record).map(([key, entryValue]) => [
      toSnakeCaseKey(key),
      normalizeMetadataValue(entryValue),
    ])
  );
}

function normalizeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  return normalizeMetadataValue(metadata) as Record<string, unknown>;
}

export async function trackEvent(data: AnalyticsEventData): Promise<void> {
  try {
    const timestamp = data.timestamp || new Date();
    const normalizedMetadata = normalizeMetadata(data.metadata);
    const sanitizedMetadata = sanitizePII(normalizedMetadata) as Record<string, unknown> | undefined;
    logger.info("[Analytics] Track event", {
      shopId: data.shopId,
      shopDomain: data.shopDomain,
      event: data.event,
      metadata: sanitizedMetadata,
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
