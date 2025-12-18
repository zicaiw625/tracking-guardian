// Reconciliation service for comparing Shopify orders with ad platform conversions

import prisma from "../db.server";
import { sendAlert } from "./notification.server";

export interface ReconciliationResult {
  platform: string;
  reportDate: Date;
  shopifyOrders: number;
  shopifyRevenue: number;
  platformConversions: number;
  platformRevenue: number;
  orderDiscrepancy: number;
  revenueDiscrepancy: number;
}

// Run daily reconciliation for a shop
export async function runDailyReconciliation(shopId: string): Promise<ReconciliationResult[]> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    include: {
      pixelConfigs: {
        where: { isActive: true },
      },
      alertConfigs: {
        where: { isEnabled: true },
      },
    },
  });

  if (!shop) {
    throw new Error("Shop not found");
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const results: ReconciliationResult[] = [];

  // Get Shopify orders for yesterday
  const conversionLogs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: {
        gte: yesterday,
        lt: today,
      },
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
      if (
        orderDiscrepancy > alertConfig.discrepancyThreshold &&
        shopifyOrders >= alertConfig.minOrdersForAlert
      ) {
        await sendAlert(alertConfig, {
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
): Promise<any[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return prisma.reconciliationReport.findMany({
    where: {
      shopId,
      reportDate: {
        gte: startDate,
      },
    },
    orderBy: { reportDate: "desc" },
  });
}

// Get reconciliation summary for dashboard
export async function getReconciliationSummary(shopId: string) {
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
  const summary: Record<
    string,
    {
      totalShopifyOrders: number;
      totalPlatformConversions: number;
      avgDiscrepancy: number;
      reports: any[];
    }
  > = {};

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
    summary[report.platform].reports.push(report);
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

// Cron job handler for daily reconciliation
export async function runAllShopsReconciliation() {
  const activeShops = await prisma.shop.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  const results = [];

  for (const shop of activeShops) {
    try {
      const shopResults = await runDailyReconciliation(shop.id);
      results.push({ shopId: shop.id, success: true, results: shopResults });
    } catch (error) {
      console.error(`Reconciliation failed for shop ${shop.id}:`, error);
      results.push({
        shopId: shop.id,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return results;
}

