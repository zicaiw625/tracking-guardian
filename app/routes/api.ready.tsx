/**
 * Readiness Check Endpoint
 * 
 * Used by Kubernetes/container orchestrators to determine if the app is ready
 * to receive traffic. This is different from health check - an app can be
 * healthy but not ready (e.g., still warming up caches).
 * 
 * Returns 200 when ready, 503 when not ready.
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { logger } from "../utils/logger";

interface ReadinessStatus {
    ready: boolean;
    timestamp: string;
    checks: {
        database: boolean;
    };
}

/**
 * Readiness check loader
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const checks = {
        database: false,
    };
    
    // Check database connectivity
    try {
        await prisma.$queryRaw`SELECT 1`;
        checks.database = true;
    } catch (error) {
        logger.warn("Readiness check: Database not ready", { error: String(error) });
    }
    
    // App is ready if all checks pass
    const ready = Object.values(checks).every(Boolean);
    
    const response: ReadinessStatus = {
        ready,
        timestamp: new Date().toISOString(),
        checks,
    };
    
    return json(response, { 
        status: ready ? 200 : 503,
        headers: {
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    });
};

