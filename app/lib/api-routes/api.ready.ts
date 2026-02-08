import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { jsonApi } from "../../utils/security-headers";
import { isStrictSecurityMode } from "../../utils/config.server";
import { getRedisClient, getRedisClientStrict } from "../../utils/redis-client.server";

interface ReadinessStatus {
  ready: boolean;
  checks: {
    database: boolean;
    redis: boolean;
  };
}

export const loader = async ({ request: _request }: LoaderFunctionArgs) => {
  const checks = {
    database: false,
    redis: false,
  };
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch (error) {
    logger.warn("Readiness check: Database not ready", { error: String(error) });
  }
  try {
    const strict = process.env.NODE_ENV === "production" && isStrictSecurityMode();
    const redis = strict ? await getRedisClientStrict() : await getRedisClient();
    await redis.set("tg:ready:ping", "1", { EX: 10 });
    checks.redis = true;
  } catch (error) {
    logger.warn("Readiness check: Redis not ready", { error: String(error) });
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
