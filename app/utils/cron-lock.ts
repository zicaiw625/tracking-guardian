import { randomUUID } from "crypto";
import { logger } from "./logger.server";
import { getRedisClient } from "./redis-client";

const LOCK_TIMEOUT_MS = 10 * 60 * 1000;

interface CronLockResult {
    acquired: boolean;
    lockId?: string;
    reason?: string;
    existingLockAge?: number;
}

export async function acquireCronLock(lockType: string, instanceId: string, timeoutMs: number = LOCK_TIMEOUT_MS): Promise<CronLockResult> {
    const lockKey = `cron_lock:${lockType}`;
    const lockValue = `${instanceId}:${randomUUID()}`;
    try {
        const redis = await getRedisClient();
        const acquired = await redis.setNX(lockKey, lockValue, timeoutMs);
        if (acquired) {
            logger.info(`[P1-03] Acquired cron lock for ${lockType}`, {
                instanceId,
                lockId: lockValue,
                expiresInMs: timeoutMs,
            });
            return {
                acquired: true,
                lockId: lockValue,
            };
        }
        const existingValue = await redis.get(lockKey);
        const ttl = await redis.ttl(lockKey);
        const remainingTtl = ttl > 0 ? ttl * 1000 : 0;
        logger.info(`[P1-03] Cron lock exists for ${lockType}`, {
            existingLockValue: existingValue?.substring(0, 50),
            remainingTtlMs: remainingTtl,
            remainingTtlSeconds: Math.round(remainingTtl / 1000),
        });
        return {
            acquired: false,
            reason: `Lock held by another instance (expires in ${Math.round(remainingTtl / 1000)}s)`,
            existingLockAge: timeoutMs - remainingTtl,
        };
    } catch (error) {
        logger.error(`[P1-03] Error acquiring cron lock for ${lockType}`, error);
        return {
            acquired: false,
            reason: `Error acquiring lock: ${error instanceof Error ? error.message : "unknown"}`,
        };
    }
}

export async function releaseCronLock(lockType: string, lockId: string): Promise<boolean> {
    const lockKey = `cron_lock:${lockType}`;
    try {
        const redis = await getRedisClient();
        const existingValue = await redis.get(lockKey);
        if (existingValue === lockId) {
            await redis.del(lockKey);
            logger.info(`[P1-03] Released cron lock for ${lockType}`, { lockId });
            return true;
        } else if (existingValue) {
            logger.warn(`[P1-03] Attempted to release lock with mismatched lockId for ${lockType}`, {
                lockId,
                existingValue: existingValue.substring(0, 50),
            });
            return false;
        } else {
            logger.warn(`[P1-03] Attempted to release non-existent lock for ${lockType}`, { lockId });
            return false;
        }
    } catch (error) {
        logger.error(`[P1-03] Error releasing cron lock for ${lockType}`, error, { lockId });
        return false;
    }
}
export async function withCronLock<T>(lockType: string, instanceId: string, job: () => Promise<T>): Promise<{
    executed: boolean;
    result?: T;
    lockSkipped?: boolean;
    reason?: string;
}> {
    const lockResult = await acquireCronLock(lockType, instanceId);
    if (!lockResult.acquired) {
        return {
            executed: false,
            lockSkipped: true,
            reason: lockResult.reason,
        };
    }
    try {
        const result = await job();
        return {
            executed: true,
            result,
        };
    }
    finally {
        if (lockResult.lockId) {
            await releaseCronLock(lockType, lockResult.lockId);
        }
    }
}
