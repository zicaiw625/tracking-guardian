// Reconciliation service for comparing Shopify orders with ad platform conversions

import prisma from "../db.server";
import { sendAlert } from "./notification.server";
import type { 
  ReconciliationResult, 
  ReconciliationSummary,
  ReconciliationReportData,
  AlertConfig,
  AlertSettings,
  AlertChannel,
} from "../types";

/**
 * Safely parse alert config from Prisma model to typed AlertConfig
 * Prisma stores Json fields as unknown, this function validates the structure
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
  
  // Basic validation of settings structure
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

// Re-export types
export type { ReconciliationResult, ReconciliationSummary, ReconciliationReportData };

// Run daily reconciliation for a shop
export async function runDailyReconciliation(shopId: string): Promise<ReconciliationResult[]> {
  // Optimized query: only select fields we need
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      id: true,
      shopDomain: true,
      isActive: true,
      pixelConfigs: {
        where: { isActive: true },
        select: {
          id: true,
          platform: true,
        },
      },
      alertConfigs: {
        where: { isEnabled: true },
        select: {
          id: true,
          channel: true,
          settings: true,
          discrepancyThreshold: true,
          minOrdersForAlert: true,
          isEnabled: true,
        },
      },
    },
  });

  if (!shop) {
    throw new Error("Shop not found");
  }

  if (!shop.isActive) {
    throw new Error("Shop is not active");
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const results: ReconciliationResult[] = [];

  // Optimized query: only select fields needed for aggregation
  // Uses the composite index [shopId, createdAt]
  const conversionLogs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: {
        gte: yesterday,
        lt: today,
      },
    },
    select: {
      orderId: true,
      orderValue: true,
      platform: true,
      status: true,
    },
  });

  // Group by platform
  const platformGroups = new Map<string, typeof conversionLogs>();
  for (const log of conversionLogs) {
    const existing = platformGroups.get(log.platform) || [];
    existing.push(log);
    platformGroups.set(log.platform, existing);
  }

  // Process each platform
  for (const [platform, logs] of platformGroups) {
    const uniqueOrders = new Set(logs.map((l) => l.orderId));
    const shopifyOrders = uniqueOrders.size;
    const shopifyRevenue = logs.reduce(
      (sum, l) => sum + Number(l.orderValue),
      0
    );

    // Count successful sends as platform conversions
    const successfulLogs = logs.filter((l) => l.status === "sent");
    const uniqueSuccessfulOrders = new Set(successfulLogs.map((l) => l.orderId));
    const platformConversions = uniqueSuccessfulOrders.size;
    const platformRevenue = successfulLogs.reduce(
      (sum, l) => sum + Number(l.orderValue),
      0
    );

    // Calculate discrepancies
    const orderDiscrepancy =
      shopifyOrders > 0
        ? (shopifyOrders - platformConversions) / shopifyOrders
        : 0;
    const revenueDiscrepancy =
      shopifyRevenue > 0
        ? (shopifyRevenue - platformRevenue) / shopifyRevenue
        : 0;

    const result: ReconciliationResult = {
      platform,
      reportDate: yesterday,
      shopifyOrders,
      shopifyRevenue,
      platformConversions,
      platformRevenue,
      orderDiscrepancy,
      revenueDiscrepancy,
    };

    results.push(result);

    // Save to database
    await prisma.reconciliationReport.upsert({
      where: {
        shopId_platform_reportDate: {
          shopId,
          platform,
          reportDate: yesterday,
        },
      },
      update: {
        shopifyOrders,
        shopifyRevenue,
        platformConversions,
        platformRevenue,
        orderDiscrepancy,
        revenueDiscrepancy,
        status: "completed",
      },
      create: {
        shopId,
        platform,
        reportDate: yesterday,
        shopifyOrders,
        shopifyRevenue,
        platformConversions,
        platformRevenue,
        orderDiscrepancy,
        revenueDiscrepancy,
        status: "completed",
      },
    });

    // Check if alert is needed
    for (const alertConfig of shop.alertConfigs) {
      const typedAlertConfig = parseAlertConfig(alertConfig);
      
      // Skip invalid configs
      if (!typedAlertConfig) {
        continue;
      }
      
      if (
        orderDiscrepancy > typedAlertConfig.discrepancyThreshold &&
        shopifyOrders >= typedAlertConfig.minOrdersForAlert
      ) {
        await sendAlert(typedAlertConfig, {
          platform,
          reportDate: yesterday,
          shopifyOrders,
          platformConversions,
          orderDiscrepancy,
          revenueDiscrepancy,
          shopDomain: shop.shopDomain,
        });

        // Mark alert as sent
        await prisma.reconciliationReport.update({
          where: {
            shopId_platform_reportDate: {
              shopId,
              platform,
              reportDate: yesterday,
            },
          },
          data: { alertSent: true },
        });
      }
    }
  }

  return results;
}

// Get reconciliation history for a shop
export async function getReconciliationHistory(
  shopId: string,
  days = 30
): Promise<ReconciliationReportData[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Uses composite index [shopId, reportDate] for efficient querying
  const reports = await prisma.reconciliationReport.findMany({
    where: {
      shopId,
      reportDate: {
        gte: startDate,
      },
    },
    select: {
      id: true,
      platform: true,
      reportDate: true,
      shopifyOrders: true,
      shopifyRevenue: true,
      platformConversions: true,
      platformRevenue: true,
      orderDiscrepancy: true,
      revenueDiscrepancy: true,
      alertSent: true,
    },
    orderBy: { reportDate: "desc" },
  });

  return reports.map((report) => ({
    id: report.id,
    platform: report.platform,
    reportDate: report.reportDate,
    shopifyOrders: report.shopifyOrders,
    shopifyRevenue: Number(report.shopifyRevenue),
    platformConversions: report.platformConversions,
    platformRevenue: Number(report.platformRevenue),
    orderDiscrepancy: report.orderDiscrepancy,
    revenueDiscrepancy: report.revenueDiscrepancy,
    alertSent: report.alertSent,
  }));
}

// Get reconciliation summary for dashboard
export async function getReconciliationSummary(
  shopId: string
): Promise<Record<string, ReconciliationSummary>> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const reports = await prisma.reconciliationReport.findMany({
    where: {
      shopId,
      reportDate: {
        gte: sevenDaysAgo,
      },
    },
  });

  // Group by platform
  const summary: Record<string, ReconciliationSummary> = {};

  for (const report of reports) {
    if (!summary[report.platform]) {
      summary[report.platform] = {
        totalShopifyOrders: 0,
        totalPlatformConversions: 0,
        avgDiscrepancy: 0,
        reports: [],
      };
    }

    summary[report.platform].totalShopifyOrders += report.shopifyOrders;
    summary[report.platform].totalPlatformConversions +=
      report.platformConversions;
    summary[report.platform].reports.push({
      id: report.id,
      platform: report.platform,
      reportDate: report.reportDate,
      shopifyOrders: report.shopifyOrders,
      shopifyRevenue: Number(report.shopifyRevenue),
      platformConversions: report.platformConversions,
      platformRevenue: Number(report.platformRevenue),
      orderDiscrepancy: report.orderDiscrepancy,
      revenueDiscrepancy: report.revenueDiscrepancy,
      alertSent: report.alertSent,
    });
  }

  // Calculate averages
  for (const platform of Object.keys(summary)) {
    const platformData = summary[platform];
    if (platformData.reports.length > 0) {
      platformData.avgDiscrepancy =
        platformData.reports.reduce((sum, r) => sum + r.orderDiscrepancy, 0) /
        platformData.reports.length;
    }
  }

  return summary;
}

// Result type for reconciliation
interface ReconciliationJobResult {
  shopId: string;
  success: boolean;
  results?: ReconciliationResult[];
  error?: string;
}

// Cron job handler for daily reconciliation
// Uses Promise.allSettled for concurrent processing with error isolation
export async function runAllShopsReconciliation(): Promise<ReconciliationJobResult[]> {
  const activeShops = await prisma.shop.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  console.log(`Starting reconciliation for ${activeShops.length} active shops`);

  // Process shops in batches to avoid overwhelming the database
  const BATCH_SIZE = 10;
  const results: ReconciliationJobResult[] = [];

  for (let i = 0; i < activeShops.length; i += BATCH_SIZE) {
    const batch = activeShops.slice(i, i + BATCH_SIZE);
    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(activeShops.length / BATCH_SIZE)}`);

    // Process batch concurrently
    const batchPromises = batch.map(async (shop): Promise<ReconciliationJobResult> => {
      try {
        const shopResults = await runDailyReconciliation(shop.id);
        return { shopId: shop.id, success: true, results: shopResults };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error(`Reconciliation failed for shop ${shop.id}:`, errorMessage);
        return {
          shopId: shop.id,
          success: false,
          error: errorMessage,
        };
      }
    });

    const batchResults = await Promise.allSettled(batchPromises);
    
    // Process settled results
    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        // This shouldn't happen since we catch errors above, but handle it anyway
        console.error(`Unexpected promise rejection:`, result.reason);
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
  console.log(`Reconciliation complete: ${successful} successful, ${failed} failed`);

  return results;
}

