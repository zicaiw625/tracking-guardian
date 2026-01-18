import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { randomUUID } from "crypto";
import { validateCronAuth, verifyReplayProtection } from "../cron/auth";
import { withCronLock } from "../utils/cron-lock";
import { cronSuccessResponse, cronSkippedResponse, cronErrorResponse } from "../utils/responses";
import { logger } from "../utils/logger.server";
import { runAllShopAlertChecks } from "../services/alert-dispatcher.server";
import { cleanupExpiredData } from "../cron/tasks/cleanup";
import { validateInput } from "../schemas/api-schemas";
import { CronRequestSchema } from "../schemas/api-schemas";
import { runAllShopsDeliveryHealthCheck } from "../services/delivery-health.server";
import { runAllShopsReconciliation } from "../services/reconciliation.server";
import { readJsonWithSizeLimit } from "../utils/body-size-guard";

async function handleCron(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const startTime = Date.now();

  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "POST") {
    return cronErrorResponse(requestId, Date.now() - startTime, "Method not allowed", 405);
  }

  const authError = validateCronAuth(request);
  if (authError) {
    return authError;
  }

  const cronSecret = process.env.CRON_SECRET || "";
  const replayCheck = verifyReplayProtection(request, cronSecret);
  if (!replayCheck.valid) {
    logger.warn("Cron request failed replay protection", {
      requestId,
      error: replayCheck.error,
    });
    return cronErrorResponse(
      requestId,
      Date.now() - startTime,
      replayCheck.error || "Replay protection failed",
      403
    );
  }

  let requestBody: unknown = null;
  try {
    if (request.headers.get("Content-Type")?.includes("application/json")) {
      requestBody = await readJsonWithSizeLimit(request);
    }
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    logger.warn("Failed to parse cron request body", { requestId, error });
  }

  let cronRequest: { task?: string; force?: boolean } = { task: "all" };
  try {
    const validationResult = validateInput(CronRequestSchema, requestBody);
    if (validationResult.success) {
      cronRequest = validationResult.data;
    } else {
      logger.warn("Invalid cron request schema", { requestId, errors: validationResult.errors });
    }
  } catch (error) {
    logger.warn("Failed to validate cron request schema", { requestId, error });
  }

  const task = cronRequest.task || "all";
  const instanceId = `${process.env.HOSTNAME || "unknown"}-${requestId}`;

  const lockResult = await withCronLock(`cron:${task}`, instanceId, async () => {
    const results: Record<string, unknown> = {
      requestId,
      task,
      timestamp: new Date().toISOString(),
    };

    try {
      if (task === "all" || task === "delivery_health") {
        logger.info("[Cron] Running delivery health checks", { requestId });
        const healthResults = await runAllShopsDeliveryHealthCheck();
        results.delivery_health = {
          status: "completed",
          shopsProcessed: healthResults.length,
          successful: healthResults.filter((r) => r.success).length,
          failed: healthResults.filter((r) => !r.success).length,
        };
      }

      if (task === "all" || task === "reconciliation") {
        logger.info("[Cron] Running reconciliation tasks", { requestId });
        const reconciliationResult = await runAllShopsReconciliation();
        results.reconciliation = {
          status: "completed",
          processed: reconciliationResult.processed,
          succeeded: reconciliationResult.succeeded,
          failed: reconciliationResult.failed,
          reportsGenerated: reconciliationResult.results.length,
        };
      }

      if (task === "all" || task === "process_gdpr") {
        logger.info("[Cron] Processing GDPR jobs", { requestId });
        results.process_gdpr = {
          status: "skipped",
          message: "GDPR requests are processed synchronously via webhook handlers",
        };
      }

      if (task === "all" || task === "cleanup") {
        logger.info("[Cron] Running cleanup tasks", { requestId });
        const cleanupResult = await cleanupExpiredData();
        results.cleanup = cleanupResult;
      }

      if (task === "all" || task === "alerts") {
        logger.info("[Cron] Running all shop alert checks", { requestId });
        await runAllShopAlertChecks();
        results.alerts = { status: "completed" };
      }

      return results;
    } catch (error) {
      logger.error("Cron task execution failed", { requestId, task, error });
      throw error;
    }
  });

  const durationMs = Date.now() - startTime;

  if (!lockResult.executed) {
    logger.info("Cron task skipped - lock held by another instance", {
      requestId,
      task,
      reason: lockResult.reason,
    });
    return cronSkippedResponse(requestId, durationMs, lockResult.reason);
  }

  if (lockResult.result) {
    logger.info("Cron task completed successfully", {
      requestId,
      task,
      durationMs,
    });
    return cronSuccessResponse({
      ...lockResult.result,
      requestId,
      durationMs,
    });
  }

  return cronErrorResponse(
    requestId,
    durationMs,
    "Task execution completed but no result returned",
    500
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => handleCron(request);
export const action = async ({ request }: ActionFunctionArgs) => handleCron(request);
