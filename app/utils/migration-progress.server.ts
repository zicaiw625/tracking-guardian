
/**
 * 迁移进度计算工具
 * 
 * 计算用户在迁移流程中的当前位置：
 * Audit → Pixel Test → Verification → Live → Monitoring
 */

import prisma from "../db.server";
import type { MigrationStage, MigrationProgress } from "../types/dashboard";

/**
 * 计算迁移进度
 */
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

  // 1. Audit: 是否有完成的扫描报告
  const hasCompletedAudit = shop?.scanReports?.[0]?.status === "completed";
  if (hasCompletedAudit) {
    stages[0].completed = true;
  } else if (shop?.scanReports?.[0]?.status === "scanning" || shop?.scanReports?.[0]?.status === "pending") {
    stages[0].inProgress = true;
  }

  // 2. Pixel Test: 是否有test环境的像素配置
  const hasTestPixel = shop?.pixelConfigs?.some((c) => c.environment === "test") || false;
  if (hasTestPixel) {
    stages[1].completed = true;
  }

  // 3. Verification: 是否有完成的验收运行
  const hasCompletedVerification = shop?.verificationRuns?.[0]?.status === "completed";
  if (hasCompletedVerification) {
    stages[2].completed = true;
  } else if (shop?.verificationRuns?.[0]?.status === "running") {
    stages[2].inProgress = true;
  }

  // 4. Live: 是否有live环境的像素配置
  const hasLivePixel = (shop?._count?.pixelConfigs || 0) > 0;
  if (hasLivePixel) {
    stages[3].completed = true;
  }

  // 5. Monitoring: 如果有live像素，则认为进入监控阶段
  if (hasLivePixel) {
    stages[4].completed = true;
  }

  // 确定当前阶段
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

  // 计算进度百分比
  const completedCount = stages.filter((s) => s.completed).length;
  const progressPercentage = Math.round((completedCount / stages.length) * 100);

  return {
    currentStage,
    stages,
    progressPercentage,
  };
}

