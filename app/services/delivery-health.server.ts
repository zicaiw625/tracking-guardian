import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { extractPlatformFromPayload } from "../utils/common";
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
        logger.warn(`Invalid alert channel: ${dbConfig.channel}`);
        return null;
    }
    if (!dbConfig.settings || typeof dbConfig.settings !== "object") {
        logger.warn(`Invalid alert settings for config ${dbConfig.id}`);
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
        },
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const alertConfigs: Array<{
        id: string;
        channel: string;
        settings: unknown;
        discrepancyThreshold: number;
        minOrdersForAlert: number;
        isEnabled: boolean;
    }> = [];
    if (!shop || !shop.isActive) {
        throw new Error("Shop not found or inactive");
    }
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    yesterday.setUTCHours(0, 0, 0, 0);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const pixelReceipts = await prisma.pixelEventReceipt.findMany({
        where: {
            shopId,
            createdAt: { gte: yesterday, lt: today },
            eventType: { in: ["purchase", "checkout_completed"] },
        },
        select: {
            createdAt: true,
            payloadJson: true,
        },
    });
    const platformGroups = new Map<string, typeof pixelReceipts>();
    for (const receipt of pixelReceipts) {
        const payload = receipt.payloadJson as Record<string, unknown> | null;
        const platform = extractPlatformFromPayload(payload);
        if (!platform) continue;
        const existing = platformGroups.get(platform) || [];
        existing.push(receipt);
        platformGroups.set(platform, existing);
    }
    const results: DeliveryHealthResult[] = [];
    for (const [platform, receipts] of platformGroups) {
        const totalAttempted = receipts.length;
        let totalSent = 0;
        for (const receipt of receipts) {
            const payload = receipt.payloadJson as Record<string, unknown> | null;
            const data = payload?.data as Record<string, unknown> | undefined;
            const hasValue = data?.value !== undefined && data?.value !== null;
            const hasCurrency = !!data?.currency;
            if (hasValue && hasCurrency) {
                totalSent++;
            }
        }
        const totalFailed = totalAttempted - totalSent;
        const successRate = totalAttempted > 0 ? totalSent / totalAttempted : 0;
        const failureReasons: Record<string, number> = {};
        if (totalFailed > 0) {
            failureReasons["missing_params"] = totalFailed;
        }
        const result: DeliveryHealthResult = {
            platform,
            reportDate: yesterday,
            totalAttempted,
            totalSent,
            totalFailed,
            successRate,
            failureReasons,
            avgLatencyMs: null,
        };
        results.push(result);
    }
    return results;
}
export async function getDeliveryHealthHistory(shopId: string, _days = 30): Promise<DeliveryHealthReport[]> {
    return [];
}
export async function getDeliveryHealthSummary(shopId: string): Promise<Record<string, DeliveryHealthSummary>> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
    sevenDaysAgo.setUTCHours(0, 0, 0, 0);
    const receipts = await prisma.pixelEventReceipt.findMany({
        where: {
            shopId,
            createdAt: { gte: sevenDaysAgo },
            eventType: { in: ["purchase", "checkout_completed"] },
        },
        select: {
            payloadJson: true,
        },
    });
    const summary: Record<string, DeliveryHealthSummary> = {};
    const platformReceipts = new Map<string, typeof receipts>();
    for (const receipt of receipts) {
        const payload = receipt.payloadJson as Record<string, unknown> | null;
        const platform = extractPlatformFromPayload(payload);
        if (!platform) continue;
        const existing = platformReceipts.get(platform) || [];
        existing.push(receipt);
        platformReceipts.set(platform, existing);
    }
    for (const [platform, pReceipts] of platformReceipts) {
        const attempted = pReceipts.length;
        let sent = 0;
        for (const receipt of pReceipts) {
            const payload = receipt.payloadJson as Record<string, unknown> | null;
            const data = payload?.data as Record<string, unknown> | undefined;
            const hasValue = data?.value !== undefined && data?.value !== null;
            const hasCurrency = !!data?.currency;
            if (hasValue && hasCurrency) {
                sent++;
            }
        }
        const topFailureReasons: Array<{ reason: string; count: number }> = [];
        if (attempted > sent) {
            topFailureReasons.push({ reason: "missing_params", count: attempted - sent });
        }
        const avgSuccessRate = attempted > 0 ? sent / attempted : 0;
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
export interface DeliveryHealthJobResult {
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
    logger.info(`Starting delivery health check for ${activeShops.length} active shops`);
    const BATCH_SIZE = 10;
    const results: DeliveryHealthJobResult[] = [];
    for (let i = 0; i < activeShops.length; i += BATCH_SIZE) {
        const batch = activeShops.slice(i, i + BATCH_SIZE);
        logger.info(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(activeShops.length / BATCH_SIZE)}`);
        const batchPromises = batch.map(async (shop): Promise<DeliveryHealthJobResult> => {
            try {
                const shopResults = await runDailyDeliveryHealthCheck(shop.id);
                return { shopId: shop.id, success: true, results: shopResults };
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : "Unknown error";
                logger.error(`Delivery health check failed for shop ${shop.id}: ${errorMessage}`);
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
    logger.info(`Delivery health check complete: ${successful} successful, ${failed} failed`);
    return results;
}
export { runDailyDeliveryHealthCheck as runDailyReconciliation, runAllShopsDeliveryHealthCheck as runAllShopsReconciliation, getDeliveryHealthHistory as getReconciliationHistory, getDeliveryHealthSummary as getReconciliationSummary, };
