

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

export async function runAlertCheckTask(): Promise<AlertCheckResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  logger.info("Starting alert check cron task");

  let shopsChecked = 0;
  let alertsTriggered = 0;
  let alertsSent = 0;
  let noncesCleanedUp = 0;

  try {

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

export default async function handler(): Promise<AlertCheckResult> {
  return runAlertCheckTask();
}

