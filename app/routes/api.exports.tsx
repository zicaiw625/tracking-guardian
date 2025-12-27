import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
type ExportType = "conversions" | "audit" | "receipts" | "jobs" | "scan";
type ExportFormat = "csv" | "json";
const EXPORT_LIMITS = {
    conversions: 10000,
    audit: 5000,
    receipts: 10000,
    jobs: 5000,
    scan: 50,
};
const FIELD_DEFINITIONS = {
    conversions: {
        id: { description: "Unique conversion log ID", pii: false },
        orderId: { description: "Shopify order ID (normalized)", pii: false },
        orderNumber: { description: "Human-readable order number", pii: false },
        orderValue: { description: "Order value in currency", pii: false },
        currency: { description: "Currency code (ISO 4217)", pii: false },
        platform: { description: "Ad platform (google/meta/tiktok)", pii: false },
        eventType: { description: "Event type (purchase)", pii: false },
        status: { description: "Processing status", pii: false },
        attempts: { description: "Number of send attempts", pii: false },
        clientSideSent: { description: "Whether pixel event was received", pii: false },
        serverSideSent: { description: "Whether CAPI was sent", pii: false },
        createdAt: { description: "Log creation timestamp", pii: false },
        sentAt: { description: "When successfully sent", pii: false },
        errorMessage: { description: "Error message if failed", pii: false },
    },
    audit: {
        id: { description: "Unique audit log ID", pii: false },
        actorType: { description: "Who performed the action", pii: false },
        actorId: { description: "Actor identifier", pii: true, note: "May contain staff email" },
        action: { description: "Action performed", pii: false },
        resourceType: { description: "Type of resource affected", pii: false },
        resourceId: { description: "ID of affected resource", pii: false },
        ipAddress: { description: "Request IP address", pii: true, note: "Network identifier" },
        userAgent: { description: "Browser/client info", pii: true, note: "Device fingerprint component" },
        createdAt: { description: "Action timestamp", pii: false },
    },
    receipts: {
        id: { description: "Unique receipt ID", pii: false },
        orderId: { description: "Order ID from pixel event", pii: false },
        eventType: { description: "Event type", pii: false },
        checkoutToken: { description: "Checkout token for verification", pii: false },
        pixelTimestamp: { description: "When pixel fired", pii: false },
        isTrusted: { description: "Whether event was trusted", pii: false },
        trustLevel: { description: "Trust verification level", pii: false },
        signatureStatus: { description: "Signature validation status", pii: false },
        createdAt: { description: "Receipt creation timestamp", pii: false },
    },
    jobs: {
        id: { description: "Unique job ID", pii: false },
        orderId: { description: "Order ID", pii: false },
        orderNumber: { description: "Order number", pii: false },
        orderValue: { description: "Order value", pii: false },
        currency: { description: "Currency code", pii: false },
        status: { description: "Job status", pii: false },
        attempts: { description: "Processing attempts", pii: false },
        platformResults: { description: "Per-platform results", pii: false },
        trustMetadata: { description: "Trust verification data", pii: false },
        createdAt: { description: "Job creation timestamp", pii: false },
        completedAt: { description: "Job completion timestamp", pii: false },
    },
    scan: {
        id: { description: "Unique scan report ID", pii: false },
        riskScore: { description: "Risk score 0-100", pii: false },
        scriptTags: { description: "Detected ScriptTags", pii: false },
        identifiedPlatforms: { description: "Detected tracking platforms", pii: false },
        riskItems: { description: "Risk details and recommendations", pii: false },
        status: { description: "Scan status", pii: false },
        createdAt: { description: "Scan timestamp", pii: false },
    },
};
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session, admin } = await authenticate.admin(request);
    if (!admin) {
        return new Response("Unauthorized", { status: 401 });
    }
    const shop = await prisma.shop.findUnique({
        where: { shopDomain: session.shop },
    });
    if (!shop) {
        return new Response("Shop not found", { status: 404 });
    }
    const url = new URL(request.url);
    const exportType = (url.searchParams.get("type") || "conversions") as ExportType;
    const format = (url.searchParams.get("format") || "json") as ExportFormat;
    const includeMeta = url.searchParams.get("include_meta") === "true";
    const startDate = url.searchParams.get("start_date");
    const endDate = url.searchParams.get("end_date");
    const dateFilter: {
        gte?: Date;
        lte?: Date;
    } = {};
    if (startDate) {
        dateFilter.gte = new Date(startDate);
    }
    if (endDate) {
        dateFilter.lte = new Date(endDate);
    }
    logger.info(`Data export requested: ${exportType} in ${format} for ${shop.shopDomain}`);
    try {
        let data: unknown[];
        let filename: string;
        let fieldDefs: Record<string, unknown>;
        switch (exportType) {
            case "conversions": {
                const logs = await prisma.conversionLog.findMany({
                    where: {
                        shopId: shop.id,
                        ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}),
                    },
                    select: {
                        id: true,
                        orderId: true,
                        orderNumber: true,
                        orderValue: true,
                        currency: true,
                        platform: true,
                        eventType: true,
                        eventId: true,
                        status: true,
                        attempts: true,
                        clientSideSent: true,
                        serverSideSent: true,
                        createdAt: true,
                        sentAt: true,
                        errorMessage: true,
                    },
                    orderBy: { createdAt: "desc" },
                    take: EXPORT_LIMITS.conversions,
                });
                data = logs.map((log: typeof logs[number]) => ({
                    ...log,
                    orderValue: Number(log.orderValue),
                    createdAt: log.createdAt.toISOString(),
                    sentAt: log.sentAt?.toISOString() || null,
                }));
                filename = `conversions_${shop.shopDomain}_${new Date().toISOString().split("T")[0]}`;
                fieldDefs = FIELD_DEFINITIONS.conversions;
                break;
            }
            case "audit": {
                const logs = await prisma.auditLog.findMany({
                    where: {
                        shopId: shop.id,
                        ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}),
                    },
                    select: {
                        id: true,
                        actorType: true,
                        actorId: true,
                        action: true,
                        resourceType: true,
                        resourceId: true,
                        previousValue: true,
                        newValue: true,
                        metadata: true,
                        ipAddress: true,
                        userAgent: true,
                        createdAt: true,
                    },
                    orderBy: { createdAt: "desc" },
                    take: EXPORT_LIMITS.audit,
                });
                data = logs.map((log: typeof logs[number]) => ({
                    ...log,
                    createdAt: log.createdAt.toISOString(),
                    previousValue: log.previousValue ? "[REDACTED]" : null,
                    newValue: log.newValue ? "[REDACTED]" : null,
                }));
                filename = `audit_${shop.shopDomain}_${new Date().toISOString().split("T")[0]}`;
                fieldDefs = FIELD_DEFINITIONS.audit;
                break;
            }
            case "receipts": {
                const receipts = await prisma.pixelEventReceipt.findMany({
                    where: {
                        shopId: shop.id,
                        ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}),
                    },
                    select: {
                        id: true,
                        orderId: true,
                        eventType: true,
                        eventId: true,
                        checkoutToken: true,
                        pixelTimestamp: true,
                        isTrusted: true,
                        trustLevel: true,
                        signatureStatus: true,
                        usedCheckoutTokenFallback: true,
                        createdAt: true,
                    },
                    orderBy: { createdAt: "desc" },
                    take: EXPORT_LIMITS.receipts,
                });
                data = receipts.map((receipt: typeof receipts[number]) => ({
                    ...receipt,
                    pixelTimestamp: receipt.pixelTimestamp.toISOString(),
                    createdAt: receipt.createdAt.toISOString(),
                }));
                filename = `receipts_${shop.shopDomain}_${new Date().toISOString().split("T")[0]}`;
                fieldDefs = FIELD_DEFINITIONS.receipts;
                break;
            }
            case "jobs": {
                const jobs = await prisma.conversionJob.findMany({
                    where: {
                        shopId: shop.id,
                        ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}),
                    },
                    select: {
                        id: true,
                        orderId: true,
                        orderNumber: true,
                        orderValue: true,
                        currency: true,
                        status: true,
                        attempts: true,
                        platformResults: true,
                        trustMetadata: true,
                        consentEvidence: true,
                        createdAt: true,
                        completedAt: true,
                        errorMessage: true,
                    },
                    orderBy: { createdAt: "desc" },
                    take: EXPORT_LIMITS.jobs,
                });
                data = jobs.map((job: typeof jobs[number]) => ({
                    ...job,
                    orderValue: Number(job.orderValue),
                    createdAt: job.createdAt.toISOString(),
                    completedAt: job.completedAt?.toISOString() || null,
                }));
                filename = `jobs_${shop.shopDomain}_${new Date().toISOString().split("T")[0]}`;
                fieldDefs = FIELD_DEFINITIONS.jobs;
                break;
            }
            case "scan": {

                const scans = await prisma.scanReport.findMany({
                    where: {
                        shopId: shop.id,
                        ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}),
                    },
                    select: {
                        id: true,
                        riskScore: true,
                        scriptTags: true,
                        identifiedPlatforms: true,
                        riskItems: true,
                        status: true,
                        createdAt: true,
                    },
                    orderBy: { createdAt: "desc" },
                    take: EXPORT_LIMITS.scan,
                });

                const latestScan = scans[0];
                const migrationSummary = latestScan ? {
                    shopDomain: shop.shopDomain,
                    scanDate: latestScan.createdAt.toISOString(),
                    riskScore: latestScan.riskScore,
                    riskLevel: latestScan.riskScore > 60 ? "高风险" : latestScan.riskScore > 30 ? "中风险" : "低风险",
                    identifiedPlatforms: latestScan.identifiedPlatforms || [],
                    scriptTagCount: Array.isArray(latestScan.scriptTags) ? latestScan.scriptTags.length : 0,
                    recommendations: generateMigrationRecommendations(latestScan),
                    migrationDeadlines: {
                        scriptTagPlus: "2025-08-28",
                        scriptTagNonPlus: "2026-08-26",
                        additionalScriptsPlus: "2025-08-28",
                    },
                } : null;

                data = scans.map((scan: typeof scans[number]) => ({
                    ...scan,
                    createdAt: scan.createdAt.toISOString(),
                }));

                if (format === "json" && migrationSummary) {
                    const output = {
                        exportedAt: new Date().toISOString(),
                        shop: shop.shopDomain,
                        type: "scan",
                        migrationSummary,
                        scanHistory: data,
                        fieldDefinitions: FIELD_DEFINITIONS.scan,
                    };
                    return new Response(JSON.stringify(output, null, 2), {
                        status: 200,
                        headers: {
                            "Content-Type": "application/json",
                            "Content-Disposition": `attachment; filename="scan_report_${shop.shopDomain}_${new Date().toISOString().split("T")[0]}.json"`,
                        },
                    });
                }

                filename = `scan_report_${shop.shopDomain}_${new Date().toISOString().split("T")[0]}`;
                fieldDefs = FIELD_DEFINITIONS.scan;
                break;
            }
            default:
                return new Response(`Invalid export type: ${exportType}`, { status: 400 });
        }
        if (format === "json") {
            const output = includeMeta
                ? {
                    exportedAt: new Date().toISOString(),
                    shop: shop.shopDomain,
                    type: exportType,
                    count: data.length,
                    fieldDefinitions: fieldDefs,
                    retentionPolicy: `${shop.dataRetentionDays} days`,
                    data,
                }
                : data;
            return new Response(JSON.stringify(output, null, 2), {
                status: 200,
                headers: {
                    "Content-Type": "application/json",
                    "Content-Disposition": `attachment; filename="${filename}.json"`,
                },
            });
        }
        if (data.length === 0) {
            return new Response("", {
                status: 200,
                headers: {
                    "Content-Type": "text/csv",
                    "Content-Disposition": `attachment; filename="${filename}.csv"`,
                },
            });
        }
        const headers = Object.keys(data[0] as Record<string, unknown>);
        const csvRows = [
            headers.join(","),
            ...data.map(row => headers.map(header => {
                const value = (row as Record<string, unknown>)[header];
                if (value === null || value === undefined)
                    return "";
                if (typeof value === "object")
                    return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
                if (typeof value === "string" && (value.includes(",") || value.includes('"') || value.includes("\n"))) {
                    return `"${value.replace(/"/g, '""')}"`;
                }
                return String(value);
            }).join(",")),
        ];
        return new Response(csvRows.join("\n"), {
            status: 200,
            headers: {
                "Content-Type": "text/csv",
                "Content-Disposition": `attachment; filename="${filename}.csv"`,
            },
        });
    }
    catch (error) {
        logger.error(`Export failed for ${shop.shopDomain}:`, error);
        return new Response("Export failed", { status: 500 });
    }
};
export function getFieldDefinitions(): Record<string, unknown> {
    return {
        version: "1.0",
        generatedAt: new Date().toISOString(),
        types: FIELD_DEFINITIONS,
        notes: {
            pii: "Fields marked as PII may contain personally identifiable information",
            retention: "Data retention is configurable per shop (default 90 days)",
            deletion: "All data is subject to GDPR deletion requests via shop/redact webhook",
        },
    };
}

interface ScanData {
    riskScore: number;
    scriptTags: unknown;
    identifiedPlatforms: unknown;
    riskItems: unknown;
}

function generateMigrationRecommendations(scan: ScanData): string[] {
    const recommendations: string[] = [];
    const platforms = Array.isArray(scan.identifiedPlatforms) ? scan.identifiedPlatforms : [];
    const scriptTags = Array.isArray(scan.scriptTags) ? scan.scriptTags : [];

    if (scriptTags.length > 0) {
        recommendations.push(`检测到 ${scriptTags.length} 个 ScriptTag，建议迁移到 Web Pixel`);
        recommendations.push("ScriptTag API 将于 2025-08-28（Plus）/ 2026-08-26（非 Plus）停止工作");
    }

    if (platforms.includes("google")) {
        recommendations.push("Google: 配置 GA4 Measurement Protocol API 实现服务端追踪");
    }
    if (platforms.includes("meta")) {
        recommendations.push("Meta: 配置 Conversions API 实现服务端追踪");
    }
    if (platforms.includes("tiktok")) {
        recommendations.push("TikTok: 配置 Events API 实现服务端追踪");
    }
    if (platforms.includes("bing")) {
        recommendations.push("Bing: 建议使用 Microsoft 官方 Shopify 应用");
    }
    if (platforms.includes("clarity")) {
        recommendations.push("Clarity: 建议在主题中直接添加 Clarity 代码");
    }

    if (scan.riskScore > 60) {
        recommendations.push("⚠️ 高风险：强烈建议立即开始迁移");
    } else if (scan.riskScore > 30) {
        recommendations.push("⚡ 中风险：建议尽快规划迁移");
    } else {
        recommendations.push("✅ 低风险：追踪配置状态良好");
    }

    recommendations.push("使用 Tracking Guardian 一键安装 Web Pixel 并配置服务端追踪");

    return recommendations;
}
