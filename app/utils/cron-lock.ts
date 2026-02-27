import { randomUUID } from "crypto";
import { logger } from "./logger.server";
import { getRedisClientStrict } from "./redis-client.server";

const LOCK_TIMEOUT_MS = 10 * 60 * 1000;

interface CronLockResult {
    acquired: boolean;
    lockId?: string;
    reason?: string;
    existingLockAge?: number;
    lockError?: boolean;
}

export async function acquireCronLock(lockType: string, instanceId: string, timeoutMs: number = LOCK_TIMEOUT_MS): Promise<CronLockResult> {
    const lockKey = `cron_lock:${lockType}`;
    const lockValue = `${instanceId}:${randomUUID()}`;
    try {
        const redis = await getRedisClientStrict();
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
            lockError: true,
        };
    }
}

export async function releaseCronLock(lockType: string, lockId: string): Promise<boolean> {
    const lockKey = `cron_lock:${lockType}`;
    try {
        const redis = await getRedisClientStrict();
        const releaseScript = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
        const released = await redis.eval(releaseScript, [lockKey], [lockId]);
        if (Number(released) === 1) {
            logger.info(`[P1-03] Released cron lock for ${lockType}`, { lockId });
            return true;
        }
        const existingValue = await redis.get(lockKey);
        if (existingValue) {
            logger.warn(`[P1-03] Attempted to release lock with mismatched lockId for ${lockType}`, {
                lockId,
                existingValue: existingValue.substring(0, 50),
            });
            return false;
        }
        logger.warn(`[P1-03] Attempted to release non-existent lock for ${lockType}`, { lockId });
        return false;
    } catch (error) {
        logger.error(`[P1-03] Error releasing cron lock for ${lockType}`, error, { lockId });
        return false;
    }
}

async function extendCronLock(lockType: string, lockId: string, timeoutMs: number): Promise<boolean> {
    const lockKey = `cron_lock:${lockType}`;
    try {
        const redis = await getRedisClientStrict();
        const extendScript = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end";
        const extended = await redis.eval(extendScript, [lockKey], [lockId, String(timeoutMs)]);
        return Number(extended) === 1;
    } catch (error) {
        logger.warn(`[P1-03] Failed to extend cron lock for ${lockType}`, {
            lockId,
            error: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}

export async function withCronLock<T>(
    lockType: string,
    instanceId: string,
    job: () => Promise<T>,
    timeoutMs: number = LOCK_TIMEOUT_MS
): Promise<{
    executed: boolean;
    result?: T;
    lockSkipped?: boolean;
    reason?: string;
    lockError?: boolean;
}> {
    const lockResult = await acquireCronLock(lockType, instanceId, timeoutMs);
    if (!lockResult.acquired) {
        return {
            executed: false,
            lockSkipped: true,
            reason: lockResult.reason,
            lockError: lockResult.lockError,
        };
    }
    let stopped = false;
    const renewEveryMs = Math.max(30_000, Math.floor(timeoutMs / 2));
    const renewTimer = lockResult.lockId ? setInterval(() => {
        if (stopped || !lockResult.lockId) return;
        void extendCronLock(lockType, lockResult.lockId, timeoutMs);
    }, renewEveryMs) : null;

    try {
        const result = await job();
        return {
            executed: true,
            result,
        };
    }
    finally {
        stopped = true;
        if (renewTimer) {
            clearInterval(renewTimer);
        }
        if (lockResult.lockId) {
            await releaseCronLock(lockType, lockResult.lockId);
        }
    }
}
