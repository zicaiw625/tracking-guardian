
/**
 * 产品分析服务 - 跟踪用户行为事件
 * 
 * 用于跟踪 Free → Paid 核心漏斗和产品激活指标
 */

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

/**
 * 记录用户行为事件
 */
export async function trackEvent(data: AnalyticsEventData): Promise<void> {
  try {
    const timestamp = data.timestamp || new Date();
    
    // 这里可以集成第三方分析服务（如 Mixpanel, Amplitude 等）
    // 目前先记录到日志，后续可以扩展为数据库存储或发送到分析服务
    
    logger.info("[Analytics] Track event", {
      shopId: data.shopId,
      shopDomain: data.shopDomain,
      event: data.event,
      metadata: data.metadata,
      timestamp: timestamp.toISOString(),
    });

    // TODO: 如果需要在数据库中存储事件，可以创建 AnalyticsEvent 表
    // 目前先通过日志记录，便于后续集成分析服务
  } catch (error) {
    logger.error("[Analytics] Failed to track event", {
      error: error instanceof Error ? error.message : String(error),
      event: data.event,
      shopId: data.shopId,
    });
  }
}

/**
 * 获取用户激活状态
 */
export interface ActivationStatus {
  d1: boolean; // 完成 Audit（免费激活）
  d2: boolean; // 至少 1 个 destination 开 Test
  d3: boolean; // 通过验收并开 Live（付费激活）
  d7: boolean; // Monitoring 近 7 天无重大告警（留存前置）
}

export async function getActivationStatus(shopId: string): Promise<ActivationStatus> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      scanReports: {
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
          verificationRuns: {
            where: {
              status: "completed",
              summaryJson: {
                path: ["successfulEvents"],
                not: null,
              },
            },
          },
        },
      },
    },
  });

  const hasCompletedAudit =
    shop?.scanReports?.[0]?.status === "completed";

  const hasTestDestination = (shop?.pixelConfigs?.length || 0) > 0;

  const hasLiveDestination = (shop?._count?.pixelConfigs || 0) > 0;
  const hasCompletedVerification = (shop?._count?.verificationRuns || 0) > 0;
  const d3 = hasLiveDestination && hasCompletedVerification;

  // D7: 检查近 7 天是否有重大告警
  // TODO: 实现告警检查逻辑
  const d7 = false; // 暂时返回 false，后续实现

  return {
    d1: hasCompletedAudit,
    d2: hasTestDestination,
    d3,
    d7,
  };
}

