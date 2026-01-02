


import prisma from "../db.server";
import type { MigrationStage, MigrationProgress } from "../types/dashboard";


export async function calculateMigrationProgress(shopId: string): Promise<MigrationProgress> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      scanReports: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true },
      },
      pixelConfigs: {
        where: { isActive: true },
        select: { environment: true },
      },
      verificationRuns: {
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

  
  const hasCompletedAudit = shop?.scanReports?.[0]?.status === "completed";
  if (hasCompletedAudit) {
    stages[0].completed = true;
  } else if (shop?.scanReports?.[0]?.status === "scanning" || shop?.scanReports?.[0]?.status === "pending") {
    stages[0].inProgress = true;
  }

  
  const hasTestPixel = shop?.pixelConfigs?.some((c) => c.environment === "test") || false;
  if (hasTestPixel) {
    stages[1].completed = true;
  }

  
  const hasCompletedVerification = shop?.verificationRuns?.[0]?.status === "completed";
  if (hasCompletedVerification) {
    stages[2].completed = true;
  } else if (shop?.verificationRuns?.[0]?.status === "running") {
    stages[2].inProgress = true;
  }

  
  const hasLivePixel = (shop?._count?.pixelConfigs || 0) > 0;
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

