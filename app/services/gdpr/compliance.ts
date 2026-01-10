import { logger } from "../../utils/logger.server";
import type { GDPRComplianceResult, GDPRDeletionSummary } from "./types";

export async function checkGDPRCompliance(): Promise<GDPRComplianceResult> {
  logger.warn("[GDPR] checkGDPRCompliance called but GDPR job queue is no longer supported. GDPR requests are now processed synchronously via webhook handlers.");
  return {
    isCompliant: true,
    pendingCount: 0,
    overdueCount: 0,
    oldestPendingAge: null,
    warnings: [],
    criticals: [],
  };
}

export async function getGDPRDeletionSummary(
  _startDate: Date,
  _endDate: Date
): Promise<GDPRDeletionSummary> {
  logger.warn("[GDPR] getGDPRDeletionSummary called but GDPR job queue is no longer supported. GDPR requests are now processed synchronously via webhook handlers.");
  return {
    totalJobsCompleted: 0,
    byJobType: {},
    totalRecordsDeleted: 0,
    deletionsByTable: {},
  };
}
