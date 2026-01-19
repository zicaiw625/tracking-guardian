import type { LoaderFunctionArgs } from "@remix-run/node";
import { timingSafeEqual } from "crypto";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { MONITORING_CONFIG, isStrictSecurityMode } from "../utils/config";
import { jsonApi } from "../utils/security-headers";

interface BasicHealthStatus {
    status: "healthy" | "degraded" | "unhealthy";
}

interface DetailedHealthStatus extends BasicHealthStatus {
    timestamp?: string;
    version: string;
    uptime: number;
    checks: {
        database: HealthCheck;
        memory: HealthCheck;
    };
}

interface HealthCheck {
    status: "pass" | "fail" | "warn";
    latency_ms?: number;
    message?: string;
}

const startTime = Date.now();

async function checkDatabase(): Promise<HealthCheck> {
    const start = Date.now();
    try {
        await prisma.$queryRaw`SELECT 1`;
        const latency = Date.now() - start;
        if (latency > MONITORING_CONFIG.HIGH_LATENCY_THRESHOLD_MS) {
            return {
                status: "warn",
                latency_ms: latency,
                message: "Database latency is high",
            };
        }
        return {
            status: "pass",
            latency_ms: latency,
        };
    } catch (error) {
        logger.error("Health check: Database connection failed", error);
        return {
            status: "fail",
            latency_ms: Date.now() - start,
            message: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

function checkMemory(): HealthCheck {
    try {
        const memUsage = process.memoryUsage();
        const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
        const heapUsagePercent = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);
        if (heapUsagePercent > MONITORING_CONFIG.HIGH_HEAP_USAGE_PERCENT) {
            return {
                status: "warn",
                message: `Heap usage: ${heapUsedMB}MB / ${heapTotalMB}MB (${heapUsagePercent}%)`,
            };
        }
        return {
            status: "pass",
            message: `Heap: ${heapUsedMB}MB / ${heapTotalMB}MB`,
        };
    } catch (error) {
        return {
            status: "fail",
            message: error instanceof Error ? error.message : "Failed to check memory",
        };
    }
}

function validateDetailedHealthAuth(request: Request): boolean {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret && !isStrictSecurityMode()) {
        return true;
    }
    if (!cronSecret) {
        logger.warn("CRON_SECRET not configured - detailed health check disabled");
        return false;
    }
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
        return false;
    }
    const expectedHeader = `Bearer ${cronSecret}`;
    if (authHeader.length !== expectedHeader.length) {
        return false;
    }
    try {
        const authBuffer = Buffer.from(authHeader);
        const expectedBuffer = Buffer.from(expectedHeader);
        return timingSafeEqual(authBuffer, expectedBuffer);
    } catch {
        return false;
    }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    const detailedRequested = url.searchParams.get("detailed") === "true";
    const isAuthenticated = detailedRequested ? validateDetailedHealthAuth(request) : false;
    const detailed = detailedRequested && isAuthenticated;
    if (detailedRequested && !isAuthenticated) {
        const clientIP = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            || request.headers.get("x-real-ip")
            || "unknown";
        logger.warn("Unauthorized detailed health check attempt - downgrading to basic", {
            clientIP,
            hasAuthHeader: !!request.headers.get("Authorization"),
        });
    }
    if (detailed) {
        const uptime = Math.round((Date.now() - startTime) / 1000);
        const [dbCheck, memCheck] = await Promise.all([
            checkDatabase(),
            Promise.resolve(checkMemory()),
        ]);
        const checks = [dbCheck, memCheck];
        const hasFailed = checks.some(c => c.status === "fail");
        const hasWarning = checks.some(c => c.status === "warn");
        const status = hasFailed ? "unhealthy" : (hasWarning ? "degraded" : "healthy");
        const detailedResponse: DetailedHealthStatus = {
            status,
            timestamp: new Date().toISOString(),
            version: process.env.npm_package_version || "1.0.0",
            uptime,
            checks: {
                database: dbCheck,
                memory: memCheck,
            },
        };
        const statusCode = status === "unhealthy" ? 503 : 200;
            return jsonApi(detailedResponse, {
                status: statusCode,
            });
    } else {
        try {
            await prisma.$queryRaw`SELECT 1`;
            const basicResponse: BasicHealthStatus = {
                status: "healthy",
            };
            return jsonApi(basicResponse, {
                status: 200,
            });
        } catch (error) {
            logger.error("Health check failed: Database unreachable", error);
            const errorResponse: BasicHealthStatus = {
                status: "unhealthy",
            };
            return jsonApi(errorResponse, { status: 503 });
        }
    }
};
