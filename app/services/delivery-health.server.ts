import prisma from "../db.server";
import { sendAlert } from "./notification.server";
import type { AlertConfig, AlertSettings, AlertChannel, } from "../types";
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
    topFailureReasons: Array<{
        reason: string;
        count: number;
    }>;
}
export interface DeliveryHealthReport {
    id: string;
    platform: string;
    reportDate: Date;
    shopifyOrders: number;
    platformConversions: number;
    orderDiscrepancy: number;
    alertSent: boolean;
}
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
function categorizeFailureReason(errorMessage: string | null): string {
    if (!errorMessage)
        return "unknown";
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
        const failureReasons: Record<string, number> = {};
        for (const log of logs) {
            if (log.status === "failed" || log.status === "dead_letter") {
                const reason = categorizeFailureReason(log.errorMessage);
                failureReasons[reason] = (failureReasons[reason] || 0) + 1;
            }
        }
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
        const failureRate = 1 - successRate;
        for (const alertConfig of shop.alertConfigs) {
            const typedAlertConfig = parseAlertConfig(alertConfig);
            if (!typedAlertConfig)
                continue;
            if (failureRate > typedAlertConfig.discrepancyThreshold &&
                totalAttempted >= typedAlertConfig.minOrdersForAlert) {
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
export async function getDeliveryHealthHistory(shopId: string, days = 30): Promise<DeliveryHealthReport[]> {
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
        shopifyOrders: r.shopifyOrders,
        platformConversions: r.platformConversions,
        orderDiscrepancy: r.orderDiscrepancy,
        alertSent: r.alertSent,
    }));
}
export async function getDeliveryHealthSummary(shopId: string): Promise<Record<string, DeliveryHealthSummary>> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
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
    const reports = await prisma.reconciliationReport.findMany({
        where: {
            shopId,
            reportDate: { gte: sevenDaysAgo },
        },
    });
    const summary: Record<string, DeliveryHealthSummary> = {};
    const platformLogs = new Map<string, typeof logs>();
    for (const log of logs) {
        const existing = platformLogs.get(log.platform) || [];
        existing.push(log);
        platformLogs.set(log.platform, existing);
    }
    for (const [platform, pLogs] of platformLogs) {
        const attempted = pLogs.length;
        const sent = pLogs.filter((l) => l.status === "sent").length;
        const reasonCounts: Record<string, number> = {};
        for (const log of pLogs) {
            if (log.status === "failed" || log.status === "dead_letter") {
                const reason = categorizeFailureReason(log.errorMessage);
                reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
            }
        }
        const topFailureReasons = Object.entries(reasonCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([reason, count]) => ({ reason, count }));
        const platformReports = reports.filter((r) => r.platform === platform);
        const avgSuccessRate = platformReports.length > 0
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
interface DeliveryHealthJobResult {
    shopId: string;
    success: boolean;
    results?: DeliveryHealthResult[];
    error?: string;
}
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
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : "Unknown error";
                console.error(`Delivery health check failed for shop ${shop.id}:`, errorMessage);
                return { shopId: shop.id, success: false, error: errorMessage };
            }
        });
        const batchResults = await Promise.allSettled(batchPromises);
        for (const result of batchResults) {
            if (result.status === "fulfilled") {
                results.push(result.value);
            }
            else {
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
export { runDailyDeliveryHealthCheck as runDailyReconciliation, runAllShopsDeliveryHealthCheck as runAllShopsReconciliation, getDeliveryHealthHistory as getReconciliationHistory, getDeliveryHealthSummary as getReconciliationSummary, };
