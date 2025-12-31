/**
 * 使用量告警服务 - 接近限制时通知商家
 */

import { logger } from "~/utils/logger.server";
import { checkUsageApproachingLimit } from "./usage-tracking.server";
import type { PlanId } from "./plans";

export interface UsageAlert {
  type: "pixelDestinations" | "uiModules" | "eventCount" | "monthlyOrders";
  current: number;
  limit: number;
  percentage: number;
  message: string;
}

/**
 * 检查并生成使用量告警
 */
export async function checkUsageAlerts(
  shopId: string,
  planId: PlanId,
  threshold: number = 80
): Promise<{
  hasAlerts: boolean;
  alerts: UsageAlert[];
}> {
  try {
    const result = await checkUsageApproachingLimit(shopId, planId, threshold);

    if (!result.approaching) {
      return {
        hasAlerts: false,
        alerts: [],
      };
    }

    const alerts: UsageAlert[] = result.items.map((item) => {
      const typeNames: Record<typeof item.type, string> = {
        pixelDestinations: "像素目的地",
        uiModules: "UI 模块",
        eventCount: "事件量",
        monthlyOrders: "月度订单数",
      };

      return {
        type: item.type,
        current: item.current,
        limit: item.limit,
        percentage: item.percentage,
        message: `${typeNames[item.type]}使用量已达到 ${item.percentage}%（${item.current}/${item.limit}）。请考虑升级套餐以避免功能受限。`,
      };
    });

    return {
      hasAlerts: true,
      alerts,
    };
  } catch (error) {
    logger.error("Failed to check usage alerts", {
      shopId,
      planId,
      error,
    });
    return {
      hasAlerts: false,
      alerts: [],
    };
  }
}

/**
 * 发送使用量告警通知（邮件/应用内）
 */
export async function sendUsageAlertNotification(
  shopId: string,
  alerts: UsageAlert[]
): Promise<{ success: boolean; error?: string }> {
  try {
    // Note: 使用量告警通知实现
    // 当前实现仅记录日志，完整实现应该：
    // 1. 检查 AlertConfig 中的通知渠道配置
    // 2. 检查是否已发送过（避免重复通知）- 使用 lastAlertAt 字段
    // 3. 发送邮件通知 - 使用 notification.server.ts
    // 4. 发送 Slack/Telegram 通知 - 使用 alerts 模块
    // 5. 在应用内显示通知 - 创建 Notification 记录
    // 6. 更新 lastAlertAt 时间戳

    logger.info("Usage alerts generated", {
      shopId,
      alertCount: alerts.length,
    });

    return { success: true };
  } catch (error) {
    logger.error("Failed to send usage alert notification", {
      shopId,
      error,
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

