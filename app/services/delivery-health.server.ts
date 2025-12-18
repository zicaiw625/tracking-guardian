/**
 * Delivery Health Service
 * 
 * Monitors the health of conversion event delivery to advertising platforms.
 * 
 * What this service does:
 * - Calculates send success rate (sent vs attempted)
 * - Identifies delivery failures and their causes
 * - Tracks delivery latency
 * - Sends alerts when success rate drops below threshold
 * 
 * What this service does NOT do:
 * - Pull data from platform APIs (would require Platform Reporting API access)
 * - Compare Shopify orders with platform-reported conversions
 * - Validate if platforms actually recorded the conversions
 * 
 * For true reconciliation with platform data, you would need to:
 * 1. Integrate with platform Reporting APIs (Google Ads API, Meta Marketing API)
 * 2. Pull conversion reports from each platform
 * 3. Compare platform-reported conversions with our logs
 */

import prisma from "../db.server";
import { sendAlert } from "./notification.server";
import type { 
  AlertConfig,
  AlertSettings,
  AlertChannel,
} from "../types";

// ==========================================
// Types
// ==========================================

export interface DeliveryHealthResult {
  platform: string;
  reportDate: Date;
  totalAttempted: number;
  totalSent: number;
  totalFailed: number;
  successRate: number;
  failureReasons: Record<string, number>;
  avgLatencyMs: number | null;
}

export interface DeliveryHealthSummary {
  platform: string;
  last7DaysAttempted: number;
  last7DaysSent: number;
  avgSuccessRate: number;
  topFailureReasons: Array<{ reason: string; count: number }>;
}

export interface DeliveryHealthReport {
  id: string;
  platform: string;
  reportDate: Date;
  totalAttempted: number;
  totalSent: number;
  successRate: number;
  alertSent: boolean;
}

// ==========================================
// Helper Functions
// ==========================================

/**
 * Safely parse alert config from Prisma model to typed AlertConfig
 */
function parseAlertConfig(dbConfig: {
  id: string;
  channel: string;
  settings: unknown;
  discrepancyThreshold: number;
  minOrdersForAlert: number;
  isEnabled: boolean;
}): AlertConfig | null {
  const validChannels: AlertChannel[] = ["email", "slack", "telegram"];
  
  if (!validChannels.includes(dbConfig.channel as AlertChannel)) {
    console.warn(`Invalid alert channel: ${dbConfig.channel}`);
    return null;
  }
  
  if (!dbConfig.settings || typeof dbConfig.settings !== "object") {
    console.warn(`Invalid alert settings for config ${dbConfig.id}`);
    return null;
  }
  
  return {
    id: dbConfig.id,
    channel: dbConfig.channel as AlertChannel,
    settings: dbConfig.settings as AlertSettings,
    discrepancyThreshold: dbConfig.discrepancyThreshold,
    minOrdersForAlert: dbConfig.minOrdersForAlert,
    isEnabled: dbConfig.isEnabled,
  };
}

/**
 * Categorize error messages into failure reasons
 */
function categorizeFailureReason(errorMessage: string | null): string {
  if (!errorMessage) return "unknown";
  
  const lowerError = errorMessage.toLowerCase();
  
  if (lowerError.includes("401") || lowerError.includes("unauthorized") || lowerError.includes("token")) {
    return "token_expired";
  }
  if (lowerError.includes("429") || lowerError.includes("rate limit")) {
    return "rate_limited";
  }
  if (lowerError.includes("5") && (lowerError.includes("00") || lowerError.includes("02") || lowerError.includes("03"))) {
    return "platform_error";
  }
  if (lowerError.includes("timeout") || lowerError.includes("network")) {
    return "network_error";
  }
  if (lowerError.includes("invalid") || lowerError.includes("validation")) {
    return "validation_error";
  }
  if (lowerError.includes("credential") || lowerError.includes("decrypt")) {
    return "config_error";
  }
  
  return "other";
}

// ==========================================
// Main Functions
// ==========================================

/**
 * Run daily delivery health check for a shop
 */
export async function runDailyDeliveryHealthCheck(shopId: string): Promise<DeliveryHealthResult[]> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      id: true,
      shopDomain: true,
      isActive: true,
      pixelConfigs: {
        where: { isActive: true },
        select: { platform: true },
      },
      alertConfigs: {
        where: { isEnabled: true },
      },
    },
  });

  if (!shop || !shop.isActive) {
    throw new Error("Shop not found or inactive");
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get all conversion logs for yesterday
  const conversionLogs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: { gte: yesterday, lt: today },
    },
    select: {
      platform: true,
      status: true,
      errorMessage: true,
      createdAt: true,
      sentAt: true,
    },
  });

  // Group by platform
  const platformGroups = new Map<string, typeof conversionLogs>();
  for (const log of conversionLogs) {
    const existing = platformGroups.get(log.platform) || [];
    existing.push(log);
    platformGroups.set(log.platform, existing);
  }

  const results: DeliveryHealthResult[] = [];

  for (const [platform, logs] of platformGroups) {
    const totalAttempted = logs.length;
    const sentLogs = logs.filter((l) => l.status === "sent");
    const totalSent = sentLogs.length;
    const totalFailed = logs.filter((l) => l.status === "failed" || l.status === "dead_letter").length;
    const successRate = totalAttempted > 0 ? totalSent / totalAttempted : 0;

    // Categorize failure reasons
    const failureReasons: Record<string, number> = {};
    for (const log of logs) {
      if (log.status === "failed" || log.status === "dead_letter") {
        const reason = categorizeFailureReason(log.errorMessage);
        failureReasons[reason] = (failureReasons[reason] || 0) + 1;
      }
    }

    // Calculate average latency for successful sends
    let avgLatencyMs: number | null = null;
    const latencies: number[] = [];
    for (const log of sentLogs) {
      if (log.sentAt && log.createdAt) {
        latencies.push(log.sentAt.getTime() - log.createdAt.getTime());
      }
    }
    if (latencies.length > 0) {
      avgLatencyMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    }

    const result: DeliveryHealthResult = {
      platform,
      reportDate: yesterday,
      totalAttempted,
      totalSent,
      totalFailed,
      successRate,
      failureReasons,
      avgLatencyMs,
    };

    results.push(result);

    // Save to database (reusing ReconciliationReport table for now)
    await prisma.reconciliationReport.upsert({
      where: {
        shopId_platform_reportDate: { shopId, platform, reportDate: yesterday },
      },
      update: {
        shopifyOrders: totalAttempted,
        platformConversions: totalSent,
        orderDiscrepancy: 1 - successRate,
        status: "completed",
      },
      create: {
        shopId,
        platform,
        reportDate: yesterday,
        shopifyOrders: totalAttempted,
        shopifyRevenue: 0,
        platformConversions: totalSent,
        platformRevenue: 0,
        orderDiscrepancy: 1 - successRate,
        revenueDiscrepancy: 0,
        status: "completed",
      },
    });

    // Check if alert is needed (low success rate)
    const failureRate = 1 - successRate;
    for (const alertConfig of shop.alertConfigs) {
      const typedAlertConfig = parseAlertConfig(alertConfig);
      if (!typedAlertConfig) continue;

      if (
        failureRate > typedAlertConfig.discrepancyThreshold &&
        totalAttempted >= typedAlertConfig.minOrdersForAlert
      ) {
        await sendAlert(typedAlertConfig, {
          platform,
          reportDate: yesterday,
          shopifyOrders: totalAttempted,
          platformConversions: totalSent,
          orderDiscrepancy: failureRate,
          revenueDiscrepancy: 0,
          shopDomain: shop.shopDomain,
        });

        await prisma.reconciliationReport.update({
          where: {
            shopId_platform_reportDate: { shopId, platform, reportDate: yesterday },
          },
          data: { alertSent: true },
        });
      }
    }
  }

  return results;
}

/**
 * Get delivery health history for a shop
 */
export async function getDeliveryHealthHistory(
  shopId: string,
  days = 30
): Promise<DeliveryHealthReport[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const reports = await prisma.reconciliationReport.findMany({
    where: {
      shopId,
      reportDate: { gte: startDate },
    },
    select: {
      id: true,
      platform: true,
      reportDate: true,
      shopifyOrders: true,
      platformConversions: true,
      orderDiscrepancy: true,
      alertSent: true,
    },
    orderBy: { reportDate: "desc" },
  });

  return reports.map((r) => ({
    id: r.id,
    platform: r.platform,
    reportDate: r.reportDate,
    totalAttempted: r.shopifyOrders,
    totalSent: r.platformConversions,
    successRate: 1 - r.orderDiscrepancy,
    alertSent: r.alertSent,
  }));
}

/**
 * Get delivery health summary for dashboard
 */
export async function getDeliveryHealthSummary(
  shopId: string
): Promise<Record<string, DeliveryHealthSummary>> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Get conversion logs for failure reason analysis
  const logs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: { gte: sevenDaysAgo },
    },
    select: {
      platform: true,
      status: true,
      errorMessage: true,
    },
  });

  // Get reports for success rate
  const reports = await prisma.reconciliationReport.findMany({
    where: {
      shopId,
      reportDate: { gte: sevenDaysAgo },
    },
  });

  const summary: Record<string, DeliveryHealthSummary> = {};

  // Group logs by platform
  const platformLogs = new Map<string, typeof logs>();
  for (const log of logs) {
    const existing = platformLogs.get(log.platform) || [];
    existing.push(log);
    platformLogs.set(log.platform, existing);
  }

  for (const [platform, pLogs] of platformLogs) {
    const attempted = pLogs.length;
    const sent = pLogs.filter((l) => l.status === "sent").length;

    // Count failure reasons
    const reasonCounts: Record<string, number> = {};
    for (const log of pLogs) {
      if (log.status === "failed" || log.status === "dead_letter") {
        const reason = categorizeFailureReason(log.errorMessage);
        reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      }
    }

    // Sort by count
    const topFailureReasons = Object.entries(reasonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count }));

    // Calculate average success rate from reports
    const platformReports = reports.filter((r) => r.platform === platform);
    const avgSuccessRate =
      platformReports.length > 0
        ? platformReports.reduce((sum, r) => sum + (1 - r.orderDiscrepancy), 0) /
          platformReports.length
        : attempted > 0
          ? sent / attempted
          : 0;

    summary[platform] = {
      platform,
      last7DaysAttempted: attempted,
      last7DaysSent: sent,
      avgSuccessRate,
      topFailureReasons,
    };
  }

  return summary;
}

// ==========================================
// Cron Job Handler
// ==========================================

interface DeliveryHealthJobResult {
  shopId: string;
  success: boolean;
  results?: DeliveryHealthResult[];
  error?: string;
}

/**
 * Run delivery health check for all active shops
 * Called by cron job
 */
export async function runAllShopsDeliveryHealthCheck(): Promise<DeliveryHealthJobResult[]> {
  const activeShops = await prisma.shop.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  console.log(`Starting delivery health check for ${activeShops.length} active shops`);

  const BATCH_SIZE = 10;
  const results: DeliveryHealthJobResult[] = [];

  for (let i = 0; i < activeShops.length; i += BATCH_SIZE) {
    const batch = activeShops.slice(i, i + BATCH_SIZE);
    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(activeShops.length / BATCH_SIZE)}`);

    const batchPromises = batch.map(async (shop): Promise<DeliveryHealthJobResult> => {
      try {
        const shopResults = await runDailyDeliveryHealthCheck(shop.id);
        return { shopId: shop.id, success: true, results: shopResults };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error(`Delivery health check failed for shop ${shop.id}:`, errorMessage);
        return { shopId: shop.id, success: false, error: errorMessage };
      }
    });

    const batchResults = await Promise.allSettled(batchPromises);
    
    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        results.push({
          shopId: "unknown",
          success: false,
          error: result.reason?.message || "Unexpected error",
        });
      }
    }
  }

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  console.log(`Delivery health check complete: ${successful} successful, ${failed} failed`);

  return results;
}

// ==========================================
// Backwards compatibility exports
// ==========================================

// Re-export with old names for backwards compatibility
export {
  runDailyDeliveryHealthCheck as runDailyReconciliation,
  runAllShopsDeliveryHealthCheck as runAllShopsReconciliation,
  getDeliveryHealthHistory as getReconciliationHistory,
  getDeliveryHealthSummary as getReconciliationSummary,
};
