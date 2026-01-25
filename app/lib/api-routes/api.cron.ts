import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { randomUUID } from "crypto";
import { validateCronAuth, verifyReplayProtection } from "../../cron/auth";
import { acquireCronLock, releaseCronLock, withCronLock } from "../../utils/cron-lock";
import { acceptedResponse, cronSuccessResponse, cronSkippedResponse, cronErrorResponse } from "../../utils/responses";
import { logger } from "../../utils/logger.server";
import { runAllShopAlertChecks } from "../../services/alert-dispatcher.server";
import { cleanupExpiredData } from "../../cron/tasks/cleanup";
import { validateInput , CronRequestSchema } from "../../schemas/api-schemas";
import { processConversionJobs } from "../../services/conversion-job.server";
import { runAllShopsDeliveryHealthCheck } from "../../services/delivery-health.server";
import { runAllShopsReconciliation } from "../../services/reconciliation.server";
import { readTextWithLimit } from "../../utils/body-reader";

function shouldRunAsync(request: Request): boolean {
  const url = new URL(request.url);
  const asyncParam = url.searchParams.get("async");
  if (asyncParam === "1" || asyncParam === "true") return true;
  const prefer = request.headers.get("Prefer") || "";
  return prefer.toLowerCase().includes("respond-async");
}

async function runCronTasks(task: string, requestId: string): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {
    requestId,
    task,
    timestamp: new Date().toISOString(),
  };

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

  if (task === "all" || task === "process_conversion") {
    logger.info("[Cron] Running process conversion jobs", { requestId });
    const conversionResult = await processConversionJobs();
    if (conversionResult.errors.length > 0) {
      logger.warn("[Cron] Process conversion errors", {
        requestId,
        errorCount: conversionResult.errors.length,
        errors: conversionResult.errors,
      });
    }
    results.process_conversion = {
      processed: conversionResult.processed,
      succeeded: conversionResult.succeeded,
      failed: conversionResult.failed,
      errorCount: conversionResult.errors.length,
    };
  }

  if (task === "all" || task === "process_event_delivery") {
    logger.info("[Cron] Running event delivery processing", { requestId });
    const { processEventDelivery } = await import("../../cron/tasks/event-delivery");
    const deliveryResult = await processEventDelivery();
    results.process_event_delivery = deliveryResult;
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
}

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
  const replayCheck = await verifyReplayProtection(request, cronSecret);
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
  const contentType = request.headers.get("Content-Type");
  const contentLength = request.headers.get("Content-Length");
  const maxBodySize = 64 * 1024;
  
  if (contentType?.includes("application/json")) {
    try {
      const bodyText = await readTextWithLimit(request, maxBodySize);
      const trimmedBody = bodyText.trim();
      if (trimmedBody) {
        requestBody = JSON.parse(trimmedBody);
      } else {
        logger.debug("Cron request has empty JSON body, using defaults", { requestId });
      }
    } catch (error) {
      if (error instanceof Response) {
        logger.error("Cron request body parsing returned error response", {
          requestId,
          status: error.status,
          contentType,
          contentLength,
        });
        return error;
      }
      if (error instanceof SyntaxError) {
        logger.warn("Cron request has invalid JSON body", {
          requestId,
          error: error.message,
          contentType,
          contentLength,
        });
        return cronErrorResponse(
          requestId,
          Date.now() - startTime,
          "Invalid JSON body",
          400
        );
      }
      logger.warn("Failed to parse cron request body", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else if (contentLength && parseInt(contentLength, 10) > 0) {
    logger.warn("Cron request has body but no JSON content type", {
      requestId,
      contentType,
      contentLength,
    });
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

  if (shouldRunAsync(request)) {
    const lockType = `cron:${task}`;
    const lock = await acquireCronLock(lockType, instanceId);
    const durationMs = Date.now() - startTime;

    if (!lock.acquired || !lock.lockId) {
      if (lock.lockError) {
        logger.error("Cron task failed - unable to acquire lock due to error", {
          requestId,
          task,
          reason: lock.reason,
        });
        return cronErrorResponse(
          requestId,
          durationMs,
          lock.reason || "Unable to acquire cron lock",
          503
        );
      }
      logger.info("Cron task skipped - lock held by another instance", {
        requestId,
        task,
        reason: lock.reason,
      });
      return cronSkippedResponse(requestId, durationMs, lock.reason);
    }

    const lockId = lock.lockId;
    logger.info("Cron task accepted for async execution", { requestId, task });

    void (async () => {
      const jobStart = Date.now();
      try {
        const result = await runCronTasks(task, requestId);
        logger.info("Cron async task completed successfully", {
          requestId,
          task,
          durationMs: Date.now() - jobStart,
        });
        void result;
      } catch (error) {
        logger.error("Cron async task execution failed", { requestId, task, error });
      } finally {
        await releaseCronLock(lockType, lockId);
      }
    })();

    return acceptedResponse({
      success: true,
      accepted: true,
      requestId,
      task,
      durationMs,
    });
  }

  const lockResult = await withCronLock(`cron:${task}`, instanceId, async () => {
    try {
      return await runCronTasks(task, requestId);
    } catch (error) {
      logger.error("Cron task execution failed", { requestId, task, error });
      throw error;
    }
  });

  const durationMs = Date.now() - startTime;

  if (!lockResult.executed) {
    if (lockResult.lockError) {
      logger.error("Cron task failed - unable to acquire lock due to error", {
        requestId,
        task,
        reason: lockResult.reason,
      });
      return cronErrorResponse(
        requestId,
        durationMs,
        lockResult.reason || "Unable to acquire cron lock",
        503
      );
    }
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
