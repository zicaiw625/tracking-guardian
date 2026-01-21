import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { jsonApi } from "../../utils/security-headers";

interface ReadinessStatus {
    ready: boolean;
    checks: {
        database: boolean;
    };
}

export const loader = async ({ request: _request }: LoaderFunctionArgs) => {
    const checks = {
        database: false,
    };
    try {
        await prisma.$queryRaw`SELECT 1`;
        checks.database = true;
    } catch (error) {
        logger.warn("Readiness check: Database not ready", { error: String(error) });
    }
    const ready = Object.values(checks).every(Boolean);
    const response: ReadinessStatus = {
        ready,
        checks,
    };
    return jsonApi(response, {
        status: ready ? 200 : 503,
    });
};
