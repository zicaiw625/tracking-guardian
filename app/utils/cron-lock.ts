import prisma from "../db.server";
import { logger } from "./logger";
const LOCK_TIMEOUT_MS = 10 * 60 * 1000;
const STALE_LOCK_THRESHOLD_MS = 15 * 60 * 1000;
interface CronLockResult {
    acquired: boolean;
    lockId?: string;
    reason?: string;
    existingLockAge?: number;
}
interface CronLockRecord {
    id: string;
    lockType: string;
    acquiredAt: Date;
    expiresAt: Date;
    instanceId: string;
}
export async function acquireCronLock(lockType: string, instanceId: string, timeoutMs: number = LOCK_TIMEOUT_MS): Promise<CronLockResult> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + timeoutMs);
    try {
        await cleanupStaleLocks(lockType);
        const lockKey = `cron_lock:${lockType}`;
        const existingLock = await prisma.webhookLog.findFirst({
            where: {
                shopDomain: lockKey,
                topic: "CRON_LOCK",
                receivedAt: {
                    gt: new Date(now.getTime() - LOCK_TIMEOUT_MS),
                },
            },
            orderBy: { receivedAt: "desc" },
        });
        if (existingLock) {
            const lockAge = now.getTime() - existingLock.receivedAt.getTime();
            logger.info(`[P1-03] Cron lock exists for ${lockType}`, {
                existingWebhookId: existingLock.webhookId,
                lockAge,
                lockAgeSeconds: Math.round(lockAge / 1000),
            });
            return {
                acquired: false,
                reason: `Lock held by another instance (age: ${Math.round(lockAge / 1000)}s)`,
                existingLockAge: lockAge,
            };
        }
        const lockRecord = await prisma.webhookLog.create({
            data: {
                shopDomain: lockKey,
                webhookId: instanceId,
                topic: "CRON_LOCK",
                status: "processing",
                orderId: null,
                receivedAt: now,
                processedAt: null,
            },
        });
        logger.info(`[P1-03] Acquired cron lock for ${lockType}`, {
            instanceId,
            lockId: lockRecord.id,
            expiresAt: expiresAt.toISOString(),
        });
        return {
            acquired: true,
            lockId: lockRecord.id,
        };
    }
    catch (error) {
        if ((error as {
            code?: string;
        })?.code === "P2002") {
            logger.info(`[P1-03] Cron lock contention for ${lockType} - another instance acquired it`);
            return {
                acquired: false,
                reason: "Lock acquired by another instance (race condition)",
            };
        }
        logger.error(`[P1-03] Error acquiring cron lock for ${lockType}`, error);
        return {
            acquired: false,
            reason: `Error acquiring lock: ${error instanceof Error ? error.message : "unknown"}`,
        };
    }
}
export async function releaseCronLock(lockType: string, lockId: string): Promise<boolean> {
    try {
        await prisma.webhookLog.update({
            where: { id: lockId },
            data: {
                status: "processed",
                processedAt: new Date(),
            },
        });
        logger.info(`[P1-03] Released cron lock for ${lockType}`, { lockId });
        return true;
    }
    catch (error) {
        logger.error(`[P1-03] Error releasing cron lock for ${lockType}`, error, { lockId });
        return false;
    }
}
async function cleanupStaleLocks(lockType: string): Promise<number> {
    const lockKey = `cron_lock:${lockType}`;
    const staleThreshold = new Date(Date.now() - STALE_LOCK_THRESHOLD_MS);
    try {
        const result = await prisma.webhookLog.deleteMany({
            where: {
                shopDomain: lockKey,
                topic: "CRON_LOCK",
                status: "processing",
                receivedAt: {
                    lt: staleThreshold,
                },
            },
        });
        if (result.count > 0) {
            logger.warn(`[P1-03] Cleaned up ${result.count} stale cron locks for ${lockType}`);
        }
        return result.count;
    }
    catch (error) {
        logger.error(`[P1-03] Error cleaning up stale locks for ${lockType}`, error);
        return 0;
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
