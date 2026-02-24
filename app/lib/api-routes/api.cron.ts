import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { randomUUID } from "crypto";
import { validateCronAuth, verifyReplayProtection } from "../../cron/auth";
import { withCronLock } from "../../utils/cron-lock";
import { cronSuccessResponse, cronSkippedResponse, cronErrorResponse } from "../../utils/responses";
import { logger } from "../../utils/logger.server";
import { cleanupExpiredData } from "../../cron/tasks/cleanup";
import { validateInput , CronRequestSchema } from "../../schemas/api-schemas";
import { readTextWithLimit } from "../../utils/body-reader";
import prisma from "../../db.server";
import { processIngestQueue, recoverStuckProcessingItems } from "../../lib/pixel-events/ingest-queue.server";
import { runDispatchWorker } from "../../services/dispatch/run-worker.server";
import { processGDPRJobs } from "../../services/gdpr/job-processor";
import { batchAggregateMetrics } from "../../services/dashboard-aggregation.server";
import { runAlertDetectionForAllShops } from "../../services/alert-detection.server";

async function runCronTasks(task: string, requestId: string): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {
    requestId,
    task,
    timestamp: new Date().toISOString(),
  };

  if (task === "all" || task === "process_gdpr") {
    logger.info("[Cron] Processing GDPR jobs", { requestId });
    const gdprResult = await processGDPRJobs();
    results.process_gdpr = gdprResult;
  }

  if (task === "all" || task === "cleanup") {
    logger.info("[Cron] Running cleanup tasks", { requestId });
    const cleanupResult = await cleanupExpiredData();
    results.cleanup = cleanupResult;
  }

  if (task === "all" || task === "ingest_worker") {
    logger.info("[Cron] Running ingest worker", { requestId });
    // P0-2: Recover stuck processing items
    const recovered = await recoverStuckProcessingItems();
    if (recovered > 0) {
      logger.info(`[Cron] Recovered ${recovered} stuck items`, { requestId });
    }
    const ingestResult = await processIngestQueue();
    results.ingest_worker = { ...ingestResult, recovered };
  }

  if (task === "all" || task === "dispatch_worker") {
    logger.info("[Cron] Running dispatch worker", { requestId });
    const dispatchResult = await runDispatchWorker();
    results.dispatch_worker = dispatchResult;
  }

  if (task === "all" || task === "aggregate_daily") {
    logger.info("[Cron] Running aggregate_daily", { requestId });
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    yesterday.setUTCHours(0, 0, 0, 0);
    const shops = await prisma.shop.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    const shopIds = shops.map((s) => s.id);
    const successCount = await batchAggregateMetrics(shopIds, yesterday);
    results.aggregate_daily = { shops: shopIds.length, successCount, date: yesterday.toISOString().split("T")[0] };
  }

  if (task === "all" || task === "alerts") {
    logger.info("[Cron] Running alerts", { requestId });
    const alertResult = await runAlertDetectionForAllShops();
    results.alerts = alertResult;
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
  const cronSecretPrevious = process.env.CRON_SECRET_PREVIOUS || "";
  const replayCheck = await verifyReplayProtection(request, [cronSecret, cronSecretPrevious]);
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

  // Default to an empty object to avoid treating an empty application/json body as null by schema validation
  let requestBody: unknown = {};
  const contentType = request.headers.get("Content-Type");
  const contentLength = request.headers.get("Content-Length");
  const maxBodySize = 64 * 1024;
  
  if (contentType?.includes("application/json")) {
    try {
      const bodyText = await readTextWithLimit(request, maxBodySize);
      const trimmedBody = bodyText.trim();
      if (trimmedBody) {
        requestBody = JSON.parse(trimmedBody);
        // Allow literal null body: treat it as "no parameters provided"
        if (requestBody === null) {
          requestBody = {};
        }
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
