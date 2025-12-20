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
import { getShopByIdWithDecryptedFields } from "../utils/shop-access";
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
 * P1-03: Enhanced with rate-limit handling and pagination
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
    query OrdersStats($query: String!, $cursor: String) {
      ordersCount(query: $query) {
        count
      }
      orders(first: 250, query: $query, after: $cursor) {
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
          endCursor
        }
      }
    }
  `;
  
  // Query for paid orders in the date range
  const dateQuery = `financial_status:paid created_at:>=${startDate.toISOString()} created_at:<${endDate.toISOString()}`;
  
  // P1-03: Helper function to make request with retry on rate limit
  async function makeRequest(cursor: string | null = null, retryCount = 0): Promise<{
    data: {
      ordersCount?: { count: number };
      orders?: {
        edges: Array<{ node: { totalPriceSet: { shopMoney: { amount: string } } } }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } | null;
    errors?: unknown[];
  }> {
    const response = await fetch(
      `https://${shopDomain}/admin/api/2024-01/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken!,
        },
        body: JSON.stringify({ 
          query, 
          variables: { query: dateQuery, cursor } 
        }),
      }
    );
    
    // P1-03: Handle rate limiting with exponential backoff
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get("Retry-After") || "2", 10);
      const maxRetries = 3;
      
      if (retryCount < maxRetries) {
        logger.warn(
          `[P1-03] Rate limited by Shopify for ${shopDomain}, ` +
          `retrying in ${retryAfter}s (attempt ${retryCount + 1}/${maxRetries})`
        );
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        return makeRequest(cursor, retryCount + 1);
      } else {
        logger.error(`[P1-03] Rate limit exceeded max retries for ${shopDomain}`);
        return { data: null, errors: [{ message: "Rate limit exceeded" }] };
      }
    }
    
    if (!response.ok) {
      logger.error(`Shopify API error for ${shopDomain}: ${response.status}`);
      return { data: null, errors: [{ message: `HTTP ${response.status}` }] };
    }
    
    return await response.json();
  }
  
  try {
    // P1-03: Paginate through all orders for accurate revenue
    let totalRevenue = 0;
    let orderCount = 0;
    let cursor: string | null = null;
    let hasMorePages = true;
    let pageCount = 0;
    const maxPages = 10; // Safety limit: 10 pages × 250 orders = 2500 orders max
    
    while (hasMorePages && pageCount < maxPages) {
      const result = await makeRequest(cursor);
      
      if (result.errors || !result.data) {
        logger.error(`Shopify GraphQL errors for ${shopDomain}`, undefined, { errors: result.errors });
        // Return partial data if we have some
        if (pageCount > 0) {
          logger.warn(`[P1-03] Returning partial data for ${shopDomain} after ${pageCount} pages`);
          return { count: orderCount, revenue: totalRevenue };
        }
        return null;
      }
      
      // Get count from first page only
      if (pageCount === 0 && result.data.ordersCount) {
        orderCount = result.data.ordersCount.count;
      }
      
      // Sum revenue from this page
      interface OrderEdge {
        node: {
          totalPriceSet: {
            shopMoney: {
              amount: string;
            };
          };
        };
      }
      const pageRevenue = result.data.orders?.edges?.reduce(
        (sum: number, edge: OrderEdge) => 
          sum + parseFloat(edge.node.totalPriceSet?.shopMoney?.amount || "0"),
        0
      ) || 0;
      totalRevenue += pageRevenue;
      
      // Check for more pages
      hasMorePages = result.data.orders?.pageInfo?.hasNextPage || false;
      cursor = result.data.orders?.pageInfo?.endCursor || null;
      pageCount++;
    }
    
    if (hasMorePages) {
      logger.warn(
        `[P1-03] Shop ${shopDomain} has more than ${maxPages * 250} orders, ` +
        `revenue calculation truncated at ${pageCount} pages`
      );
    }
    
    logger.debug(
      `[P1-03] Fetched Shopify stats for ${shopDomain}: ` +
      `${orderCount} orders, $${totalRevenue.toFixed(2)} revenue (${pageCount} pages)`
    );
    
    return { count: orderCount, revenue: totalRevenue };
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
 * P0-02 FIX: Uses decrypted accessToken for Admin API calls
 */
export async function runDailyReconciliation(shopId: string): Promise<ReconciliationResult[]> {
  // P0-02 FIX: Get shop with decrypted accessToken
  const decryptedShop = await getShopByIdWithDecryptedFields(shopId);
  
  if (!decryptedShop || !decryptedShop.isActive) {
    logger.debug(`Skipping reconciliation for inactive shop: ${shopId}`);
    return [];
  }
  
  // P0-02 FIX: Check if accessToken was decrypted successfully
  if (!decryptedShop.accessToken) {
    logger.warn(
      `[P0-02] Cannot run reconciliation for shop ${decryptedShop.shopDomain}: ` +
      "accessToken decryption failed. Shop may need to re-authenticate."
    );
    return [];
  }
  
  // Get related data (pixelConfigs, alertConfigs)
  const shopWithRelations = await prisma.shop.findUnique({
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

  if (!shopWithRelations) {
    logger.debug(`Shop not found after decryption: ${shopId}`);
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
  const platforms = [...new Set(shopWithRelations.pixelConfigs.map(c => c.platform))];
  
  if (platforms.length === 0) {
    logger.debug(`No active platforms for shop ${shopId}`);
    return [];
  }

  // P0-02 FIX: Use decrypted accessToken for Shopify API calls
  const shopifyStats = await getShopifyOrderStats(
    decryptedShop.shopDomain,
    decryptedShop.accessToken,
    yesterday,
    today
  );
  
  // P0-02: Use real Shopify data if available, otherwise fall back to ConversionLog data
  const shopifyOrderCount = shopifyStats?.count ?? 0;
  const shopifyRevenue = shopifyStats?.revenue ?? 0;
  
  if (!shopifyStats) {
    logger.warn(`Could not fetch Shopify order data for ${decryptedShop.shopDomain}, using ConversionLog data`);
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
    const matchingAlerts = shopWithRelations.alertConfigs.filter(
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
              shopDomain: decryptedShop.shopDomain,
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

    logger.info(`Reconciliation completed for ${decryptedShop.shopDomain}/${platform}`, {
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
