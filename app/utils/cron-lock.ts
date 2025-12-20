/**
 * P1-03: Cron Execution Mutex Lock
 * 
 * Prevents concurrent cron job execution when multiple instances are running.
 * Uses database-based locking to ensure only one cron job runs at a time.
 * 
 * Why this is needed:
 * - In a multi-instance deployment (e.g., Vercel, multiple Render instances),
 *   the same cron job could be triggered on all instances simultaneously
 * - Without locking, jobs like processConversionJobs could process the same
 *   records multiple times, causing duplicate CAPI sends
 * - The lock also prevents re-entry if a cron job runs longer than the interval
 */

import prisma from "../db.server";
import { logger } from "./logger";

// Lock configuration
const LOCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes max lock duration
const STALE_LOCK_THRESHOLD_MS = 15 * 60 * 1000; // Consider lock stale after 15 minutes

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

/**
 * Attempt to acquire a distributed lock for cron execution
 * 
 * @param lockType - Type of cron job (e.g., "main", "cleanup", "reconciliation")
 * @param instanceId - Unique identifier for this instance/request
 * @param timeoutMs - How long the lock should be held (default: LOCK_TIMEOUT_MS)
 */
export async function acquireCronLock(
  lockType: string,
  instanceId: string,
  timeoutMs: number = LOCK_TIMEOUT_MS
): Promise<CronLockResult> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + timeoutMs);
  
  try {
    // First, try to clean up any stale locks
    await cleanupStaleLocks(lockType);
    
    // Try to acquire the lock using a unique constraint
    // This uses a "CronLock" table that we'll create
    // For now, we'll use WebhookLog as a makeshift lock table
    const lockKey = `cron_lock:${lockType}`;
    
    // Check if there's an existing non-expired lock
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
      
      // Lock exists and is not expired
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
    
    // Try to create a new lock
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
    
  } catch (error) {
    // If we get a unique constraint violation, another instance got the lock
    if ((error as { code?: string })?.code === "P2002") {
      logger.info(`[P1-03] Cron lock contention for ${lockType} - another instance acquired it`);
      return {
        acquired: false,
        reason: "Lock acquired by another instance (race condition)",
      };
    }
    
    // For other errors, log and return as if lock not acquired (safe fallback)
    logger.error(`[P1-03] Error acquiring cron lock for ${lockType}`, error);
    
    // In case of error, we could either:
    // 1. Return false (safe, but might skip cron if DB is down)
    // 2. Return true (risky, might cause duplicates)
    // We choose safe approach
    return {
      acquired: false,
      reason: `Error acquiring lock: ${error instanceof Error ? error.message : "unknown"}`,
    };
  }
}

/**
 * Release a cron lock
 */
export async function releaseCronLock(
  lockType: string,
  lockId: string
): Promise<boolean> {
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
  } catch (error) {
    logger.error(`[P1-03] Error releasing cron lock for ${lockType}`, error, { lockId });
    return false;
  }
}

/**
 * Clean up stale locks that were never released (e.g., instance crashed)
 */
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
  } catch (error) {
    logger.error(`[P1-03] Error cleaning up stale locks for ${lockType}`, error);
    return 0;
  }
}

/**
 * Wrapper function to run cron job with lock protection
 */
export async function withCronLock<T>(
  lockType: string,
  instanceId: string,
  job: () => Promise<T>
): Promise<{ executed: boolean; result?: T; lockSkipped?: boolean; reason?: string }> {
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
  } finally {
    if (lockResult.lockId) {
      await releaseCronLock(lockType, lockResult.lockId);
    }
  }
}

