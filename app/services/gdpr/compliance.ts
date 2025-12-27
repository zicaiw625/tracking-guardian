

import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import type { GDPRComplianceResult, GDPRDeletionSummary } from "./types";

export async function checkGDPRCompliance(): Promise<GDPRComplianceResult> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const pendingJobs = await prisma.gDPRJob.findMany({
    where: {
      status: { in: ["queued", "processing", "failed"] },
    },
    select: {
      id: true,
      shopDomain: true,
      jobType: true,
      status: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const warnings: string[] = [];
  const criticals: string[] = [];
  let overdueCount = 0;
  let oldestPendingAge: number | null = null;

  for (const job of pendingJobs) {
    const ageMs = now.getTime() - job.createdAt.getTime();
    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

    if (oldestPendingAge === null || ageDays > oldestPendingAge) {
      oldestPendingAge = ageDays;
    }

    if (job.createdAt < thirtyDaysAgo) {
      overdueCount++;
      criticals.push(
        `[CRITICAL] GDPR ${job.jobType} for ${job.shopDomain} is ${ageDays} days old (> 30 day limit). Job ID: ${job.id}`
      );
    }

    else if (job.createdAt < sevenDaysAgo) {
      warnings.push(
        `[WARNING] GDPR ${job.jobType} for ${job.shopDomain} is ${ageDays} days old. Job ID: ${job.id}`
      );
    }
  }

  const isCompliant = criticals.length === 0;

  if (!isCompliant) {
    logger.error("[GDPR] Compliance violation detected!", {
      overdueCount,
      criticals: criticals.length,
      oldestPendingAge,
    });
  } else if (warnings.length > 0) {
    logger.warn("[GDPR] Compliance warnings:", {
      pendingCount: pendingJobs.length,
      warnings: warnings.length,
      oldestPendingAge,
    });
  }

  return {
    isCompliant,
    pendingCount: pendingJobs.length,
    overdueCount,
    oldestPendingAge,
    warnings,
    criticals,
  };
}

export async function getGDPRDeletionSummary(
  startDate: Date,
  endDate: Date
): Promise<GDPRDeletionSummary> {

  const completedJobs = await prisma.gDPRJob.findMany({
    where: {
      status: "completed",
      completedAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    select: {
      jobType: true,
      result: true,
    },
  });

  const byJobType: Record<string, number> = {};
  const deletionsByTable: Record<string, number> = {};
  let totalRecordsDeleted = 0;

  for (const job of completedJobs) {

    byJobType[job.jobType] = (byJobType[job.jobType] || 0) + 1;

    const result = job.result as Record<string, unknown> | null;
    if (result?.deletedCounts && typeof result.deletedCounts === "object") {
      const counts = result.deletedCounts as Record<string, number>;
      for (const [table, count] of Object.entries(counts)) {
        if (typeof count === "number") {
          deletionsByTable[table] = (deletionsByTable[table] || 0) + count;
          totalRecordsDeleted += count;
        }
      }
    }
  }

  return {
    totalJobsCompleted: completedJobs.length,
    byJobType,
    totalRecordsDeleted,
    deletionsByTable,
  };
}

