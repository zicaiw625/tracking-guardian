import prisma from "../db.server";
import { sendAlert } from "./notification.server";
import { logger } from "../utils/logger.server";
import { getShopByIdWithDecryptedFields } from "../utils/shop-access";
import { apiVersion } from "../shopify.server";
import type { AlertChannel, AlertSettings } from "../types";
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
async function getShopifyOrderStats(shopDomain: string, accessToken: string | null, startDate: Date, endDate: Date): Promise<{
    count: number;
    revenue: number;
} | null> {
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
    const dateQuery = `financial_status:paid created_at:>=${startDate.toISOString()} created_at:<${endDate.toISOString()}`;
    async function makeRequest(cursor: string | null = null, retryCount = 0): Promise<{
        data: {
            ordersCount?: {
                count: number;
            };
            orders?: {
                edges: Array<{
                    node: {
                        totalPriceSet: {
                            shopMoney: {
                                amount: string;
                            };
                        };
                    };
                }>;
                pageInfo: {
                    hasNextPage: boolean;
                    endCursor: string | null;
                };
            };
        } | null;
        errors?: unknown[];
    }> {
        const response = await fetch(`https:
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": accessToken!,
            },
            body: JSON.stringify({
                query,
                variables: { query: dateQuery, cursor }
            }),
        });
        if (response.status === 429) {
            const retryAfter = parseInt(response.headers.get("Retry-After") || "2", 10);
            const maxRetries = 3;
            if (retryCount < maxRetries) {
                logger.warn(`[P1-03] Rate limited by Shopify for ${shopDomain}, ` +
                    `retrying in ${retryAfter}s (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                return makeRequest(cursor, retryCount + 1);
            }
            else {
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
        let totalRevenue = 0;
        let orderCount = 0;
        let cursor: string | null = null;
        let hasMorePages = true;
        let pageCount = 0;
        const maxPages = 10;
        while (hasMorePages && pageCount < maxPages) {
            const result = await makeRequest(cursor);
            if (result.errors || !result.data) {
                logger.error(`Shopify GraphQL errors for ${shopDomain}`, undefined, { errors: result.errors });
                if (pageCount > 0) {
                    logger.warn(`[P1-03] Returning partial data for ${shopDomain} after ${pageCount} pages`);
                    return { count: orderCount, revenue: totalRevenue };
                }
                return null;
            }
            if (pageCount === 0 && result.data.ordersCount) {
                orderCount = result.data.ordersCount.count;
            }
            interface OrderEdge {
                node: {
                    totalPriceSet: {
                        shopMoney: {
                            amount: string;
                        };
                    };
                };
            }
            const pageRevenue = result.data.orders?.edges?.reduce((sum: number, edge: OrderEdge) => sum + parseFloat(edge.node.totalPriceSet?.shopMoney?.amount || "0"), 0) || 0;
            totalRevenue += pageRevenue;
            hasMorePages = result.data.orders?.pageInfo?.hasNextPage || false;
            cursor = result.data.orders?.pageInfo?.endCursor || null;
            pageCount++;
        }
        if (hasMorePages) {
            logger.warn(`[P1-03] Shop ${shopDomain} has more than ${maxPages * 250} orders, ` +
                `revenue calculation truncated at ${pageCount} pages`);
        }
        logger.debug(`[P1-03] Fetched Shopify stats for ${shopDomain}: ` +
            `${orderCount} orders, $${totalRevenue.toFixed(2)} revenue (${pageCount} pages)`);
        return { count: orderCount, revenue: totalRevenue };
    }
    catch (error) {
        logger.error(`Failed to fetch Shopify orders for ${shopDomain}`, error);
        return null;
    }
}
export async function runDailyReconciliation(shopId: string): Promise<ReconciliationResult[]> {
    const decryptedShop = await getShopByIdWithDecryptedFields(shopId);
    if (!decryptedShop || !decryptedShop.isActive) {
        logger.debug(`Skipping reconciliation for inactive shop: ${shopId}`);
        return [];
    }
    if (!decryptedShop.accessToken) {
        logger.warn(`[P0-02] Cannot run reconciliation for shop ${decryptedShop.shopDomain}: ` +
            "accessToken decryption failed. Shop may need to re-authenticate.");
        return [];
    }
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

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const reportDate = new Date(yesterday);
    const platforms = [...new Set(shopWithRelations.pixelConfigs.map(c => c.platform))];
    if (platforms.length === 0) {
        logger.debug(`No active platforms for shop ${shopId}`);
        return [];
    }
    const shopifyStats = await getShopifyOrderStats(decryptedShop.shopDomain, decryptedShop.accessToken, yesterday, today);
    const shopifyOrderCount = shopifyStats?.count ?? 0;
    const shopifyRevenue = shopifyStats?.revenue ?? 0;
    if (!shopifyStats) {
        logger.warn(`Could not fetch Shopify order data for ${decryptedShop.shopDomain}, using ConversionLog data`);
    }
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
    for (const platform of platforms) {
        const platformLogs = conversionLogs.filter(l => l.platform === platform);
        const sentOrders = platformLogs
            .filter(l => l.status === "sent")
            .reduce((sum, l) => sum + l._count, 0);
        const sentRevenue = platformLogs
            .filter(l => l.status === "sent")
            .reduce((sum, l) => sum + Number(l._sum.orderValue || 0), 0);
        const totalOrders = shopifyStats ? shopifyOrderCount : platformLogs.reduce((sum, l) => sum + l._count, 0);
        const totalRevenue = shopifyStats ? shopifyRevenue : platformLogs.reduce((sum, l) => sum + Number(l._sum.orderValue || 0), 0);
        const orderDiscrepancy = totalOrders > 0
            ? (totalOrders - sentOrders) / totalOrders
            : 0;
        const revenueDiscrepancy = totalRevenue > 0
            ? (totalRevenue - sentRevenue) / totalRevenue
            : 0;
        let alertSent = false;
        const matchingAlerts = shopWithRelations.alertConfigs.filter(a => totalOrders >= a.minOrdersForAlert && orderDiscrepancy >= a.discrepancyThreshold);
        if (matchingAlerts.length > 0) {
            for (const alertConfig of matchingAlerts) {
                try {
                    await sendAlert({
                        id: alertConfig.id,
                        channel: alertConfig.channel as AlertChannel,
                        settings: alertConfig.settings as unknown as AlertSettings,
                        discrepancyThreshold: alertConfig.discrepancyThreshold,
                        minOrdersForAlert: alertConfig.minOrdersForAlert,
                        isEnabled: true,
                    }, {
                        platform,
                        reportDate,
                        shopifyOrders: totalOrders,
                        platformConversions: sentOrders,
                        orderDiscrepancy,
                        revenueDiscrepancy,
                        shopDomain: decryptedShop.shopDomain,
                    });
                    alertSent = true;
                }
                catch (error) {
                    logger.error(`Failed to send reconciliation alert`, error, {
                        shopId,
                        platform,
                        alertConfigId: alertConfig.id,
                    });
                }
            }
        }
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
        }
        catch (error) {
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
export async function getReconciliationHistory(shopId: string, days: number = 30): Promise<Array<{
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
    cutoffDate.setUTCDate(cutoffDate.getUTCDate() - days);
    cutoffDate.setUTCHours(0, 0, 0, 0);
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
export async function getReconciliationSummary(shopId: string, days: number = 30): Promise<ReconciliationSummary> {
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
    for (const platform of Object.keys(summary)) {
        const platformSummary = summary[platform];
        if (platformSummary.reports.length > 0) {
            const totalDiscrepancy = platformSummary.reports.reduce((sum, r) => sum + r.orderDiscrepancy, 0);
            platformSummary.avgDiscrepancy = totalDiscrepancy / platformSummary.reports.length;
        }
    }
    return summary;
}
export async function getLatestReconciliation(shopId: string): Promise<Map<string, ReconciliationResult>> {
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

export type GapReason =
    | "no_pixel_receipt"
    | "consent_denied"
    | "network_timeout"
    | "trust_check_failed"
    | "billing_limit"
    | "platform_error"
    | "unknown";

export interface GapAnalysis {
    reason: GapReason;
    count: number;
    percentage: number;
    description: string;
}

export interface ReconciliationDashboardData {

    period: {
        startDate: Date;
        endDate: Date;
        days: number;
    };

    overview: {
        totalWebhookOrders: number;
        totalPixelReceipts: number;
        totalGap: number;
        gapPercentage: number;
        totalSentToPlatforms: number;
        matchRate: number;
    };

    gapAnalysis: GapAnalysis[];

    platformBreakdown: Array<{
        platform: string;
        webhookOrders: number;
        pixelReceipts: number;
        sentToPlatform: number;
        gap: number;
        gapPercentage: number;
    }>;

    dailyTrend: Array<{
        date: string;
        webhookOrders: number;
        pixelReceipts: number;
        gap: number;
    }>;

    recommendation: {
        currentStrategy: string;
        suggestedStrategy: string | null;
        reason: string | null;
    };
}

export async function getReconciliationDashboardData(
    shopId: string,
    days: number = 7
): Promise<ReconciliationDashboardData> {

    const endDate = new Date();
    endDate.setUTCHours(0, 0, 0, 0);
    const startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - days);

    const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: { consentStrategy: true },
    });
    const currentStrategy = shop?.consentStrategy || "strict";

    const conversionJobs = await prisma.conversionJob.findMany({
        where: {
            shopId,
            createdAt: {
                gte: startDate,
                lt: endDate,
            },
        },
        select: {
            id: true,
            orderId: true,
            status: true,
            errorMessage: true,
            createdAt: true,
            trustMetadata: true,
            consentEvidence: true,
            capiInput: true,
        },
    });

    const pixelReceipts = await prisma.pixelEventReceipt.findMany({
        where: {
            shopId,
            eventType: "purchase",
            createdAt: {
                gte: startDate,
                lt: endDate,
            },
        },
        select: {
            orderId: true,
            isTrusted: true,
            consentState: true,
            createdAt: true,
            checkoutToken: true,
        },
    });

    const conversionLogs = await prisma.conversionLog.findMany({
        where: {
            shopId,
            eventType: "purchase",
            createdAt: {
                gte: startDate,
                lt: endDate,
            },
        },
        select: {
            orderId: true,
            platform: true,
            status: true,
            errorMessage: true,
            createdAt: true,
        },
    });

    const receiptByOrderId = new Map(
        pixelReceipts.map(r => [r.orderId, r])
    );

    const receiptByToken = new Map(
        pixelReceipts
            .filter(r => r.checkoutToken)
            .map(r => [r.checkoutToken!, r])
    );

    function findReceiptForJob(job: { orderId: string; capiInput: unknown }): typeof pixelReceipts[0] | undefined {

        const byOrderId = receiptByOrderId.get(job.orderId);
        if (byOrderId) return byOrderId;

        if (job.capiInput && typeof job.capiInput === 'object') {
            const capiInput = job.capiInput as Record<string, unknown>;
            const webhookCheckoutToken = typeof capiInput.checkoutToken === 'string'
                ? capiInput.checkoutToken
                : null;
            if (webhookCheckoutToken) {
                const byToken = receiptByToken.get(webhookCheckoutToken);
                if (byToken) return byToken;
            }
        }

        return undefined;
    }

    const gapReasonCounts: Record<GapReason, number> = {
        no_pixel_receipt: 0,
        consent_denied: 0,
        network_timeout: 0,
        trust_check_failed: 0,
        billing_limit: 0,
        platform_error: 0,
        unknown: 0,
    };

    for (const job of conversionJobs) {

        const receipt = findReceiptForJob(job);

        if (!receipt) {

            gapReasonCounts.no_pixel_receipt++;
        } else if (job.status === "limit_exceeded") {
            gapReasonCounts.billing_limit++;
        } else if (job.status === "failed" || job.status === "dead_letter") {
            const errorMsg = (job.errorMessage || "").toLowerCase();
            if (errorMsg.includes("consent") || errorMsg.includes("sale_of_data")) {
                gapReasonCounts.consent_denied++;
            } else if (errorMsg.includes("trust") || errorMsg.includes("untrusted")) {
                gapReasonCounts.trust_check_failed++;
            } else if (errorMsg.includes("timeout") || errorMsg.includes("network")) {
                gapReasonCounts.network_timeout++;
            } else if (errorMsg.includes("platform") || errorMsg.includes("api")) {
                gapReasonCounts.platform_error++;
            } else {
                gapReasonCounts.unknown++;
            }
        }
    }

    const totalWebhookOrders = conversionJobs.length;
    const totalPixelReceipts = pixelReceipts.length;
    const totalGap = Math.max(0, totalWebhookOrders - totalPixelReceipts);
    const gapPercentage = totalWebhookOrders > 0
        ? (totalGap / totalWebhookOrders) * 100
        : 0;

    const sentLogs = conversionLogs.filter(l => l.status === "sent");
    const totalSentToPlatforms = new Set(sentLogs.map(l => l.orderId)).size;
    const matchRate = totalWebhookOrders > 0
        ? (totalSentToPlatforms / totalWebhookOrders) * 100
        : 0;

    const totalGapCount = Object.values(gapReasonCounts).reduce((a, b) => a + b, 0);
    const gapAnalysis: GapAnalysis[] = [];

    const reasonDescriptions: Record<GapReason, string> = {
        no_pixel_receipt: "用户未到达感谢页（提前关闭、upsell 中断等）",
        consent_denied: "用户未授权追踪同意（GDPR/CCPA）",
        network_timeout: "网络中断或请求超时",
        trust_check_failed: "像素事件信任检查未通过",
        billing_limit: "月度用量已达计费上限",
        platform_error: "平台 API 发送失败",
        unknown: "未知原因",
    };

    for (const [reason, count] of Object.entries(gapReasonCounts)) {
        if (count > 0) {
            gapAnalysis.push({
                reason: reason as GapReason,
                count,
                percentage: totalGapCount > 0 ? (count / totalGapCount) * 100 : 0,
                description: reasonDescriptions[reason as GapReason],
            });
        }
    }
    gapAnalysis.sort((a, b) => b.count - a.count);

    const platforms = [...new Set(conversionLogs.map(l => l.platform))];
    const platformBreakdown = platforms.map(platform => {
        const platformLogs = conversionLogs.filter(l => l.platform === platform);
        const sentCount = platformLogs.filter(l => l.status === "sent").length;
        const uniqueOrders = new Set(platformLogs.map(l => l.orderId)).size;
        const gap = uniqueOrders - sentCount;

        return {
            platform,
            webhookOrders: uniqueOrders,
            pixelReceipts: receiptByOrderId.size,
            sentToPlatform: sentCount,
            gap: Math.max(0, gap),
            gapPercentage: uniqueOrders > 0 ? (gap / uniqueOrders) * 100 : 0,
        };
    });

    const dailyStats = new Map<string, { webhook: number; pixel: number }>();
    for (let d = new Date(startDate); d < endDate; d.setUTCDate(d.getUTCDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        dailyStats.set(dateStr, { webhook: 0, pixel: 0 });
    }

    for (const job of conversionJobs) {
        const dateStr = new Date(job.createdAt).toISOString().split("T")[0];
        const stat = dailyStats.get(dateStr);
        if (stat) stat.webhook++;
    }

    for (const receipt of pixelReceipts) {
        const dateStr = new Date(receipt.createdAt).toISOString().split("T")[0];
        const stat = dailyStats.get(dateStr);
        if (stat) stat.pixel++;
    }

    const dailyTrend = Array.from(dailyStats.entries()).map(([date, stat]) => ({
        date,
        webhookOrders: stat.webhook,
        pixelReceipts: stat.pixel,
        gap: Math.max(0, stat.webhook - stat.pixel),
    }));

    let suggestedStrategy: string | null = null;
    let suggestionReason: string | null = null;

    if (currentStrategy === "strict" && gapPercentage > 15) {
        suggestedStrategy = "balanced";
        suggestionReason = `当前缺口率 ${gapPercentage.toFixed(1)}% 较高，切换到 balanced 策略可提高覆盖率`;
    } else if (currentStrategy === "balanced" && gapPercentage < 5) {
        suggestedStrategy = "strict";
        suggestionReason = `当前匹配率良好（缺口 ${gapPercentage.toFixed(1)}%），可考虑切换到 strict 策略增强数据质量`;
    }

    return {
        period: {
            startDate,
            endDate,
            days,
        },
        overview: {
            totalWebhookOrders,
            totalPixelReceipts,
            totalGap,
            gapPercentage,
            totalSentToPlatforms,
            matchRate,
        },
        gapAnalysis,
        platformBreakdown,
        dailyTrend,
        recommendation: {
            currentStrategy,
            suggestedStrategy,
            reason: suggestionReason,
        },
    };
}
