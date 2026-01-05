

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
        select: { status: true },
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

  const stages: MigrationProgress["stages"] = [
    { stage: "audit", label: "体检", completed: false, inProgress: false },
    { stage: "pixel_test", label: "像素测试", completed: false, inProgress: false },
    { stage: "verification", label: "验收", completed: false, inProgress: false },
    { stage: "live", label: "上线", completed: false, inProgress: false },
    { stage: "monitoring", label: "监控", completed: false, inProgress: false },
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

  const verificationRuns = shop && "VerificationRun" in shop ? (shop as typeof shop & { VerificationRun: Array<{ status: string }> }).VerificationRun : [];
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

  return {
    currentStage,
    stages,
    progressPercentage,
  };
}

