/**
 * 告警检查定时任务
 * 对应设计方案 4.6 Monitoring - 告警功能
 * 
 * 运行频率: 每小时一次
 * 功能:
 * - 检查所有活跃店铺的告警条件
 * - 发送触发的告警通知
 * - 清理过期的 EventNonce 记录
 */

import { runAllShopAlertChecks } from "../../services/alert-dispatcher.server";
import { cleanupExpiredNonces } from "../../services/capi-dedup.server";
import { logger } from "../../utils/logger.server";

export interface AlertCheckResult {
  success: boolean;
  shopsChecked: number;
  alertsTriggered: number;
  alertsSent: number;
  noncesCleanedUp: number;
  duration: number;
  errors: string[];
}

/**
 * 执行告警检查任务
 */
export async function runAlertCheckTask(): Promise<AlertCheckResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  logger.info("Starting alert check cron task");

  let shopsChecked = 0;
  let alertsTriggered = 0;
  let alertsSent = 0;
  let noncesCleanedUp = 0;

  try {
    // 1. 运行所有店铺的告警检查
    const alertResult = await runAllShopAlertChecks();
    shopsChecked = alertResult.shopsChecked;
    alertsTriggered = alertResult.totalTriggered;
    alertsSent = alertResult.totalSent;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(`Alert checks failed: ${errorMessage}`);
    logger.error("Alert check task failed", { error });
  }

  try {
    // 2. 清理过期的 EventNonce 记录
    noncesCleanedUp = await cleanupExpiredNonces();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(`Nonce cleanup failed: ${errorMessage}`);
    logger.error("Nonce cleanup failed", { error });
  }

  const duration = Date.now() - startTime;

  logger.info("Alert check cron task completed", {
    shopsChecked,
    alertsTriggered,
    alertsSent,
    noncesCleanedUp,
    duration,
    errorCount: errors.length,
  });

  return {
    success: errors.length === 0,
    shopsChecked,
    alertsTriggered,
    alertsSent,
    noncesCleanedUp,
    duration,
    errors,
  };
}

/**
 * Cron 入口点
 */
export default async function handler(): Promise<AlertCheckResult> {
  return runAlertCheckTask();
}

