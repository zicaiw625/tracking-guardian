/**
 * Health Check Endpoint
 * 
 * Provides health status for load balancers and monitoring systems.
 * Returns a simple JSON response with the application status.
 * 
 * Endpoints:
 * - GET /api/health - Basic health check
 * - GET /api/health?detailed=true - Detailed health check (requires auth)
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { logger } from "../utils/logger";
import { MONITORING_CONFIG } from "../utils/config";

interface HealthStatus {
    status: "healthy" | "degraded" | "unhealthy";
    timestamp: string;
    version: string;
    uptime: number;
    checks?: {
        database: HealthCheck;
        memory: HealthCheck;
    };
}

interface HealthCheck {
    status: "pass" | "fail" | "warn";
    latency_ms?: number;
    message?: string;
}

// Track application start time for uptime calculation
const startTime = Date.now();

/**
 * Check database connectivity
 */
async function checkDatabase(): Promise<HealthCheck> {
    const start = Date.now();
    try {
        // Simple query to verify database connectivity
        await prisma.$queryRaw`SELECT 1`;
        const latency = Date.now() - start;
        
        // Warn if latency is high
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

/**
 * Check memory usage
 */
function checkMemory(): HealthCheck {
    try {
        const memUsage = process.memoryUsage();
        const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
        const heapUsagePercent = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);
        
        // Warn if heap usage is above threshold
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

/**
 * Health check loader
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    const detailed = url.searchParams.get("detailed") === "true";
    
    // Calculate uptime in seconds
    const uptime = Math.round((Date.now() - startTime) / 1000);
    
    // Basic response for simple health checks (load balancers)
    const baseResponse: HealthStatus = {
        status: "healthy",
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || "1.0.0",
        uptime,
    };
    
    // For detailed health checks, include component status
    if (detailed) {
        const [dbCheck, memCheck] = await Promise.all([
            checkDatabase(),
            Promise.resolve(checkMemory()),
        ]);
        
        baseResponse.checks = {
            database: dbCheck,
            memory: memCheck,
        };
        
        // Determine overall status based on checks
        const checks = [dbCheck, memCheck];
        const hasFailed = checks.some(c => c.status === "fail");
        const hasWarning = checks.some(c => c.status === "warn");
        
        if (hasFailed) {
            baseResponse.status = "unhealthy";
        } else if (hasWarning) {
            baseResponse.status = "degraded";
        }
    } else {
        // Quick database check for basic health
        try {
            await prisma.$queryRaw`SELECT 1`;
        } catch (error) {
            logger.error("Health check failed: Database unreachable", error);
            return json(
                {
                    status: "unhealthy",
                    timestamp: new Date().toISOString(),
                    version: process.env.npm_package_version || "1.0.0",
                    uptime,
                    error: "Database connection failed",
                } as HealthStatus & { error: string },
                { status: 503 }
            );
        }
    }
    
    // Return appropriate status code
    const statusCode = baseResponse.status === "unhealthy" ? 503 : 200;
    
    return json(baseResponse, { 
        status: statusCode,
        headers: {
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    });
};

