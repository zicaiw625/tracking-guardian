import prisma from "../db.server";
import type { MigrationStage, MigrationProgress } from "../types/dashboard";

export async function calculateMigrationProgress(shopId: string): Promise<MigrationProgress> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      ScanReports: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true },
      },
      pixelConfigs: {
        where: { isActive: true },
        select: { environment: true },
      },
      VerificationRun: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, completedAt: true },
      },
      _count: {
        select: {
          pixelConfigs: {
            where: { environment: "live", isActive: true },
          },
        },
      },
    },
  });
  const modulesEnabled = 0;
  const stages: MigrationProgress["stages"] = [
    { stage: "audit", label: "Audit", completed: false, inProgress: false },
    { stage: "pixel_test", label: "Pixel Test", completed: false, inProgress: false },
    { stage: "verification", label: "Verification", completed: false, inProgress: false },
    { stage: "live", label: "Go Live", completed: false, inProgress: false },
    { stage: "monitoring", label: "Monitoring", completed: false, inProgress: false },
  ];
  const scanReports = shop && "ScanReports" in shop ? (shop as typeof shop & { ScanReports: Array<{ status: string }> }).ScanReports : [];
  const hasCompletedAudit = scanReports[0]?.status === "completed";
  if (hasCompletedAudit) {
    stages[0].completed = true;
  } else if (scanReports[0]?.status === "scanning" || scanReports[0]?.status === "pending") {
    stages[0].inProgress = true;
  }
  const pixelConfigs = shop && "pixelConfigs" in shop ? (shop as typeof shop & { pixelConfigs: Array<{ environment: string }> }).pixelConfigs : [];
  const hasTestPixel = pixelConfigs.some((c: { environment: string }) => c.environment === "test");
  if (hasTestPixel) {
    stages[1].completed = true;
  }
  const verificationRuns = shop && "VerificationRun" in shop ? (shop as typeof shop & { VerificationRun: Array<{ status: string; completedAt: Date | null }> }).VerificationRun : [];
  const hasCompletedVerification = verificationRuns[0]?.status === "completed";
  if (hasCompletedVerification) {
    stages[2].completed = true;
  } else if (verificationRuns[0]?.status === "running") {
    stages[2].inProgress = true;
  }
  const pixelConfigsCount = shop && "_count" in shop ? (shop as typeof shop & { _count: { pixelConfigs: number } })._count.pixelConfigs : 0;
  const hasLivePixel = pixelConfigsCount > 0;
  if (hasLivePixel) {
    stages[3].completed = true;
  }
  if (hasLivePixel) {
    stages[4].completed = true;
  }
  let currentStage: MigrationStage = "audit";
  if (hasLivePixel) {
    currentStage = "monitoring";
  } else if (hasCompletedVerification) {
    currentStage = "live";
  } else if (hasTestPixel) {
    currentStage = "verification";
  } else if (hasCompletedAudit) {
    currentStage = "pixel_test";
  }
  const completedCount = stages.filter((s) => s.completed).length;
  const progressPercentage = Math.round((completedCount / stages.length) * 100);
    const auditStatus = scanReports[0]?.status;
  const auditCompletion = {
    completed: auditStatus === "completed",
    status: auditStatus === "completed" ? "completed" as const : (auditStatus === "scanning" || auditStatus === "pending" ? "in_progress" as const : "pending" as const),
  };
  const pixelsStatus = {
    test: pixelConfigs.filter((c: { environment: string }) => c.environment === "test").length,
    live: shop && "_count" in shop ? (shop as typeof shop & { _count: { pixelConfigs: number } })._count.pixelConfigs : 0,
  };
  const verificationLatest = verificationRuns[0] ? {
    status: verificationRuns[0].status === "completed" ? "completed" as const : (verificationRuns[0].status === "running" ? "running" as const : "pending" as const),
    completedAt: verificationRuns[0].completedAt,
  } : {
    status: null,
    completedAt: null,
  };
  return {
    currentStage,
    stages,
    progressPercentage,
    auditCompletion,
    pixelsStatus,
    modulesEnabled,
    verificationLatest,
  };
}
