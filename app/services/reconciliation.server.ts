/**
 * Reconciliation Service
 * 
 * Compares Shopify orders with platform conversion data to identify tracking gaps.
 * Generates daily reports and triggers alerts when discrepancies exceed thresholds.
 * 
 * This service:
 * 1. Queries Shopify orders (paid) for a given period
 * 2. Compares with ConversionLog entries for each platform
 * 3. Calculates discrepancy rates (order count and revenue)
 * 4. Creates ReconciliationReport records
 * 5. Triggers alerts if discrepancy exceeds configured thresholds
 */

import prisma from "../db.server";
import { sendAlert } from "./notification.server";
import { logger } from "../utils/logger";
import type { AlertChannel, AlertSettings } from "../types";

// ==========================================
// Types
// ==========================================

export interface ReconciliationResult {
  shopId: string;
  platform: string;
  reportDate: Date;
  shopifyOrders: number;
  shopifyRevenue: number;
  platformConversions: number;
  platformRevenue: number;
  orderDiscrepancy: number;
  revenueDiscrepancy: number;
  alertSent: boolean;
}

export interface ReconciliationSummary {
  [platform: string]: {
    totalShopifyOrders: number;
    totalPlatformConversions: number;
    totalShopifyRevenue: number;
    totalPlatformRevenue: number;
    avgDiscrepancy: number;
    reports: Array<{
      id: string;
      reportDate: Date;
      orderDiscrepancy: number;
      revenueDiscrepancy: number;
      alertSent: boolean;
    }>;
  };
}

// ==========================================
// P0-02: Shopify Order Data Fetching
// ==========================================

/**
 * P0-02: Fetch real order count and revenue from Shopify Admin API
 * 
 * This provides the "ground truth" for reconciliation - what Shopify
 * actually recorded as paid orders in the given time period.
 */
async function getShopifyOrderStats(
  shopDomain: string,
  accessToken: string | null,
  startDate: Date,
  endDate: Date
): Promise<{ count: number; revenue: number } | null> {
  if (!accessToken) {
    logger.warn(`No access token for shop ${shopDomain}, skipping Shopify order fetch`);
    return null;
  }
  
  const query = `
    query OrdersStats($query: String!) {
      ordersCount(query: $query) {
        count
      }
      orders(first: 250, query: $query) {
        edges {
          node {
            totalPriceSet {
              shopMoney {
                amount
              }
            }
          }
        }
        pageInfo {
          hasNextPage
        }
      }
    }
  `;
  
  // Query for paid orders in the date range
  const dateQuery = `financial_status:paid created_at:>=${startDate.toISOString()} created_at:<${endDate.toISOString()}`;
  
  try {
    const response = await fetch(
      `https://${shopDomain}/admin/api/2024-01/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({ query, variables: { query: dateQuery } }),
      }
    );
    
    if (!response.ok) {
      logger.error(`Shopify API error for ${shopDomain}: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    
    if (data.errors) {
      logger.error(`Shopify GraphQL errors for ${shopDomain}`, undefined, { errors: data.errors });
      return null;
    }
    
    const count = data.data?.ordersCount?.count || 0;
    
    // Sum up revenue from order edges
    interface OrderEdge {
      node: {
        totalPriceSet: {
          shopMoney: {
            amount: string;
          };
        };
      };
    }
    const revenue = data.data?.orders?.edges?.reduce(
      (sum: number, edge: OrderEdge) => 
        sum + parseFloat(edge.node.totalPriceSet?.shopMoney?.amount || "0"),
      0
    ) || 0;
    
    // Note: If hasNextPage is true, this revenue is incomplete
    // For full accuracy with large order volumes, we'd need to paginate
    const hasNextPage = data.data?.orders?.pageInfo?.hasNextPage;
    if (hasNextPage) {
      logger.warn(`Shop ${shopDomain} has more than 250 orders in period, revenue may be incomplete`);
    }
    
    return { count, revenue };
  } catch (error) {
    logger.error(`Failed to fetch Shopify orders for ${shopDomain}`, error);
    return null;
  }
}

// ==========================================
// Core Reconciliation Functions
// ==========================================

/**
 * Run daily reconciliation for a single shop
 * P0-02: Now compares real Shopify orders with conversion logs
 */
export async function runDailyReconciliation(shopId: string): Promise<ReconciliationResult[]> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    include: {
      pixelConfigs: {
        where: { isActive: true, serverSideEnabled: true },
        select: { platform: true },
      },
      alertConfigs: {
        where: { isEnabled: true },
        select: {
          id: true,
          channel: true,
          settings: true,
          discrepancyThreshold: true,
          minOrdersForAlert: true,
        },
      },
    },
  });

  if (!shop || !shop.isActive) {
    logger.debug(`Skipping reconciliation for inactive shop: ${shopId}`);
    return [];
  }

  const results: ReconciliationResult[] = [];
  
  // Calculate date range for yesterday (UTC)
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const reportDate = new Date(yesterday);
  
  // Get distinct platforms from pixel configs
  const platforms = [...new Set(shop.pixelConfigs.map(c => c.platform))];
  
  if (platforms.length === 0) {
    logger.debug(`No active platforms for shop ${shopId}`);
    return [];
  }

  // P0-02: Get real Shopify order data for the period
  const shopifyStats = await getShopifyOrderStats(
    shop.shopDomain,
    shop.accessToken,
    yesterday,
    today
  );
  
  // P0-02: Use real Shopify data if available, otherwise fall back to ConversionLog data
  const shopifyOrderCount = shopifyStats?.count ?? 0;
  const shopifyRevenue = shopifyStats?.revenue ?? 0;
  
  if (!shopifyStats) {
    logger.warn(`Could not fetch Shopify order data for ${shop.shopDomain}, using ConversionLog data`);
  }

  // Get Shopify conversion logs for the period
  const conversionLogs = await prisma.conversionLog.groupBy({
    by: ["platform", "status"],
    where: {
      shopId,
      createdAt: {
        gte: yesterday,
        lt: today,
      },
      eventType: "purchase",
    },
    _count: true,
    _sum: {
      orderValue: true,
    },
  });

  // Process each platform
  for (const platform of platforms) {
    // Calculate platform-specific metrics from ConversionLog
    const platformLogs = conversionLogs.filter(l => l.platform === platform);
    
    // P0-02: sentOrders = what we successfully sent to the platform
    const sentOrders = platformLogs
      .filter(l => l.status === "sent")
      .reduce((sum, l) => sum + l._count, 0);
    const sentRevenue = platformLogs
      .filter(l => l.status === "sent")
      .reduce((sum, l) => sum + Number(l._sum.orderValue || 0), 0);
    
    // P0-02: Use real Shopify data for comparison
    // shopifyOrderCount = total paid orders in Shopify (ground truth)
    // sentOrders = what we sent to this platform
    const totalOrders = shopifyStats ? shopifyOrderCount : platformLogs.reduce((sum, l) => sum + l._count, 0);
    const totalRevenue = shopifyStats ? shopifyRevenue : platformLogs.reduce((sum, l) => sum + Number(l._sum.orderValue || 0), 0);

    // P0-02: Calculate discrepancy: how many Shopify orders did we NOT send to the platform
    const orderDiscrepancy = totalOrders > 0 
      ? (totalOrders - sentOrders) / totalOrders 
      : 0;
    const revenueDiscrepancy = totalRevenue > 0 
      ? (totalRevenue - sentRevenue) / totalRevenue 
      : 0;

    // Check if we should send an alert
    let alertSent = false;
    const matchingAlerts = shop.alertConfigs.filter(
      a => totalOrders >= a.minOrdersForAlert && orderDiscrepancy >= a.discrepancyThreshold
    );

    if (matchingAlerts.length > 0) {
      for (const alertConfig of matchingAlerts) {
        try {
          // P0-01: Fixed sendAlert signature - now passes AlertConfig and AlertData correctly
          await sendAlert(
            {
              id: alertConfig.id,
              channel: alertConfig.channel as AlertChannel,
              settings: alertConfig.settings as AlertSettings,
              discrepancyThreshold: alertConfig.discrepancyThreshold,
              minOrdersForAlert: alertConfig.minOrdersForAlert,
              isEnabled: true,
            },
            {
              platform,
              reportDate,
              shopifyOrders: totalOrders,
              platformConversions: sentOrders,
              orderDiscrepancy,
              revenueDiscrepancy,
              shopDomain: shop.shopDomain,
            }
          );
          alertSent = true;
        } catch (error) {
          logger.error(`Failed to send reconciliation alert`, error, {
            shopId,
            platform,
            alertConfigId: alertConfig.id,
          });
        }
      }
    }

    // Create or update reconciliation report
    const report = await prisma.reconciliationReport.upsert({
      where: {
        shopId_platform_reportDate: {
          shopId,
          platform,
          reportDate,
        },
      },
      update: {
        shopifyOrders: totalOrders,
        shopifyRevenue: totalRevenue,
        platformConversions: sentOrders,
        platformRevenue: sentRevenue,
        orderDiscrepancy,
        revenueDiscrepancy,
        status: "completed",
        alertSent,
      },
      create: {
        shopId,
        platform,
        reportDate,
        shopifyOrders: totalOrders,
        shopifyRevenue: totalRevenue,
        platformConversions: sentOrders,
        platformRevenue: sentRevenue,
        orderDiscrepancy,
        revenueDiscrepancy,
        status: "completed",
        alertSent,
      },
    });

    results.push({
      shopId,
      platform,
      reportDate,
      shopifyOrders: totalOrders,
      shopifyRevenue: totalRevenue,
      platformConversions: sentOrders,
      platformRevenue: sentRevenue,
      orderDiscrepancy,
      revenueDiscrepancy,
      alertSent,
    });

    logger.info(`Reconciliation completed for ${shop.shopDomain}/${platform}`, {
      shopifyOrders: totalOrders,
      platformConversions: sentOrders,
      orderDiscrepancy: (orderDiscrepancy * 100).toFixed(1) + "%",
    });
  }

  return results;
}

/**
 * Run reconciliation for all active shops
 * Called by the daily cron job
 */
export async function runAllShopsReconciliation(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  results: ReconciliationResult[];
}> {
  const activeShops = await prisma.shop.findMany({
    where: { isActive: true },
    select: { id: true, shopDomain: true },
  });

  let succeeded = 0;
  let failed = 0;
  const allResults: ReconciliationResult[] = [];

  for (const shop of activeShops) {
    try {
      const results = await runDailyReconciliation(shop.id);
      allResults.push(...results);
      succeeded++;
    } catch (error) {
      logger.error(`Reconciliation failed for shop ${shop.shopDomain}`, error);
      failed++;
    }
  }

  logger.info(`Daily reconciliation completed`, {
    processed: activeShops.length,
    succeeded,
    failed,
    reportsGenerated: allResults.length,
  });

  return {
    processed: activeShops.length,
    succeeded,
    failed,
    results: allResults,
  };
}

// ==========================================
// Query Functions (for UI)
// ==========================================

/**
 * Get reconciliation history for a shop
 */
export async function getReconciliationHistory(
  shopId: string,
  days: number = 30
): Promise<Array<{
  id: string;
  platform: string;
  reportDate: Date;
  shopifyOrders: number;
  shopifyRevenue: number;
  platformConversions: number;
  platformRevenue: number;
  orderDiscrepancy: number;
  revenueDiscrepancy: number;
  alertSent: boolean;
}>> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const reports = await prisma.reconciliationReport.findMany({
    where: {
      shopId,
      reportDate: { gte: cutoffDate },
    },
    orderBy: { reportDate: "desc" },
  });

  return reports.map(report => ({
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

/**
 * Get reconciliation summary grouped by platform
 */
export async function getReconciliationSummary(
  shopId: string,
  days: number = 30
): Promise<ReconciliationSummary> {
  const history = await getReconciliationHistory(shopId, days);
  
  const summary: ReconciliationSummary = {};
  
  for (const report of history) {
    if (!summary[report.platform]) {
      summary[report.platform] = {
        totalShopifyOrders: 0,
        totalPlatformConversions: 0,
        totalShopifyRevenue: 0,
        totalPlatformRevenue: 0,
        avgDiscrepancy: 0,
        reports: [],
      };
    }
    
    const platformSummary = summary[report.platform];
    platformSummary.totalShopifyOrders += report.shopifyOrders;
    platformSummary.totalPlatformConversions += report.platformConversions;
    platformSummary.totalShopifyRevenue += report.shopifyRevenue;
    platformSummary.totalPlatformRevenue += report.platformRevenue;
    platformSummary.reports.push({
      id: report.id,
      reportDate: report.reportDate,
      orderDiscrepancy: report.orderDiscrepancy,
      revenueDiscrepancy: report.revenueDiscrepancy,
      alertSent: report.alertSent,
    });
  }
  
  // Calculate average discrepancy for each platform
  for (const platform of Object.keys(summary)) {
    const platformSummary = summary[platform];
    if (platformSummary.reports.length > 0) {
      const totalDiscrepancy = platformSummary.reports.reduce(
        (sum, r) => sum + r.orderDiscrepancy,
        0
      );
      platformSummary.avgDiscrepancy = totalDiscrepancy / platformSummary.reports.length;
    }
  }
  
  return summary;
}

/**
 * Get the latest reconciliation report for each platform
 */
export async function getLatestReconciliation(
  shopId: string
): Promise<Map<string, ReconciliationResult>> {
  const latestReports = await prisma.reconciliationReport.findMany({
    where: { shopId },
    orderBy: { reportDate: "desc" },
    distinct: ["platform"],
  });

  const result = new Map<string, ReconciliationResult>();
  
  for (const report of latestReports) {
    result.set(report.platform, {
      shopId: report.shopId,
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
  
  return result;
}
