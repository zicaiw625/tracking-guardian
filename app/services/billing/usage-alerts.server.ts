

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


export async function sendUsageAlertNotification(
  shopId: string,
  alerts: UsageAlert[]
): Promise<{ success: boolean; error?: string }> {
  try {
    
    
    
    
    
    
    
    

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

