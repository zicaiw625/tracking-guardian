

import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { reconcilePixelVsCapi, type ReconciliationResult } from "./enhanced-reconciliation.server";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

export interface VerificationTestItem {
  id: string;
  name: string;
  description: string;
  eventType: string;
  required: boolean;
  platforms: string[];
}

export const VERIFICATION_TEST_ITEMS: VerificationTestItem[] = [
  {
    id: "purchase",
    name: "标准购买",
    description: "完成一个包含单个商品的标准订单",
    eventType: "purchase",
    required: true,
    platforms: ["google", "meta", "tiktok", "pinterest"],
  },
  {
    id: "purchase_multi",
    name: "多商品购买",
    description: "完成一个包含多个不同商品的订单",
    eventType: "purchase",
    required: false,
    platforms: ["google", "meta", "tiktok"],
  },
  {
    id: "purchase_discount",
    name: "折扣订单",
    description: "使用折扣码完成订单，验证金额计算正确",
    eventType: "purchase",
    required: false,
    platforms: ["google", "meta", "tiktok"],
  },
  {
    id: "purchase_shipping",
    name: "含运费订单",
    description: "完成一个包含运费的订单",
    eventType: "purchase",
    required: false,
    platforms: ["google", "meta"],
  },
  {
    id: "refund",
    name: "退款",
    description: "对已完成订单进行退款，验证退款事件",
    eventType: "refund",
    required: false,
    platforms: ["google", "meta"],
  },
];

export interface VerificationEventResult {
  testItemId: string;
  eventType: string;
  platform: string;
  orderId?: string;
  orderNumber?: string;
  status: "success" | "failed" | "missing_params" | "not_tested";
  triggeredAt?: Date;
  params?: {
    value?: number;
    currency?: string;
    items?: number;
    hasEventId?: boolean;
  };
  shopifyOrder?: {
    value: number;
    currency: string;
    itemCount: number;
  };
  discrepancies?: string[];
  errors?: string[];
}

export interface VerificationSummary {
  runId: string;
  shopId: string;
  runName: string;
  runType: "quick" | "full" | "custom";
  status: "pending" | "running" | "completed" | "failed";
  platforms: string[];
  startedAt?: Date;
  completedAt?: Date;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  missingParamTests: number;
  notTestedCount: number;
  parameterCompleteness: number;
  valueAccuracy: number;
  results: VerificationEventResult[];

  reconciliation?: {
    pixelVsCapi: {
      pixelOnly: number;
      capiOnly: number;
      both: number;
      consentBlocked: number;
    };
    consistencyIssues?: Array<{
      orderId: string;
      issue: string;
      type: "value_mismatch" | "currency_mismatch" | "missing" | "duplicate";
    }>;
    localConsistency?: {
      totalChecked: number;
      consistent: number;
      partial: number;
      inconsistent: number;
      issues: Array<{
        orderId: string;
        status: "consistent" | "partial" | "inconsistent";
        issues: string[];
      }>;
    };
  };
}

export async function createVerificationRun(
  shopId: string,
  options: {
    runName?: string;
    runType?: "quick" | "full" | "custom";
    platforms?: string[];
    testItems?: string[];
  }
): Promise<string> {
  const { runName = "验收测试", runType = "quick", platforms = [], testItems = [] } = options;

  let targetPlatforms = platforms;
  if (targetPlatforms.length === 0) {
    const configs = await prisma.pixelConfig.findMany({
      where: { shopId, isActive: true, serverSideEnabled: true },
      select: { platform: true },
    });
    targetPlatforms = configs.map((c) => c.platform);
  }

  const run = await prisma.verificationRun.create({
    data: {
      shopId,
      runName,
      runType,
      status: "pending",
      platforms: targetPlatforms,
      summaryJson: {
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        missingParamTests: 0,
      },
      eventsJson: [],
    },
  });

  logger.info("Created verification run", { runId: run.id, shopId, runType });
  return run.id;
}

export async function startVerificationRun(runId: string): Promise<void> {
  await prisma.verificationRun.update({
    where: { id: runId },
    data: {
      status: "running",
      startedAt: new Date(),
    },
  });
}

export async function getVerificationRun(runId: string): Promise<VerificationSummary | null> {
  const run = await prisma.verificationRun.findUnique({
    where: { id: runId },
    include: {
      shop: {
        select: { shopDomain: true },
      },
    },
  });

  if (!run) return null;

  const summary = run.summaryJson as Record<string, unknown> | null;
  const events = (run.eventsJson as VerificationEventResult[]) || [];
  const reconciliation = summary?.reconciliation as VerificationSummary["reconciliation"] | undefined;

  return {
    runId: run.id,
    shopId: run.shopId,
    runName: run.runName,
    runType: run.runType as "quick" | "full" | "custom",
    status: run.status as "pending" | "running" | "completed" | "failed",
    platforms: run.platforms,
    startedAt: run.startedAt || undefined,
    completedAt: run.completedAt || undefined,
    totalTests: (summary?.totalTests as number) || 0,
    passedTests: (summary?.passedTests as number) || 0,
    failedTests: (summary?.failedTests as number) || 0,
    missingParamTests: (summary?.missingParamTests as number) || 0,
    notTestedCount: (summary?.notTestedCount as number) || 0,
    parameterCompleteness: (summary?.parameterCompleteness as number) || 0,
    valueAccuracy: (summary?.valueAccuracy as number) || 0,
    results: events,
    reconciliation,
  };
}

export async function analyzeRecentEvents(
  shopId: string,
  runId: string,
  options: {
    since?: Date;
    platforms?: string[];
    admin?: AdminApiContext;
  } = {}
): Promise<VerificationSummary> {
  const { since = new Date(Date.now() - 24 * 60 * 60 * 1000), platforms, admin } = options;

  const run = await prisma.verificationRun.findUnique({
    where: { id: runId },
  });

  if (!run) {
    throw new Error("Verification run not found");
  }

  const targetPlatforms = platforms || run.platforms;

  const conversionLogs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: { gte: since },
      platform: { in: targetPlatforms },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const pixelReceipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const results: VerificationEventResult[] = [];
  let passedTests = 0;
  let failedTests = 0;
  let missingParamTests = 0;
  let totalValueAccuracy = 0;
  let valueChecks = 0;

  const orderIds = [...new Set(conversionLogs.map((l) => l.orderId))];

  for (const orderId of orderIds) {
    const orderLogs = conversionLogs.filter((l) => l.orderId === orderId);
    const receipt = pixelReceipts.find((r) => r.orderId === orderId);

    for (const log of orderLogs) {
      const discrepancies: string[] = [];
      const errors: string[] = [];

      if (log.status === "failed" || log.status === "dead_letter") {
        failedTests++;
        if (log.errorMessage) {
          errors.push(log.errorMessage);
        }
      } else if (log.status === "sent") {

        const hasValue = log.orderValue !== null;
        const hasCurrency = !!log.currency;
        const hasEventId = !!log.eventId;

        if (!hasValue || !hasCurrency) {
          missingParamTests++;
          if (!hasValue) discrepancies.push("缺少 value 参数");
          if (!hasCurrency) discrepancies.push("缺少 currency 参数");
        } else {
          passedTests++;
        }

        if (receipt && hasValue) {
          valueChecks++;
          totalValueAccuracy += 100;
        }

        results.push({
          testItemId: "purchase",
          eventType: log.eventType,
          platform: log.platform,
          orderId: log.orderId,
          orderNumber: log.orderNumber || undefined,
          status:
            log.status === "sent"
              ? discrepancies.length > 0
                ? "missing_params"
                : "success"
              : "failed",
          triggeredAt: log.sentAt || log.createdAt,
          params: {
            value: Number(log.orderValue),
            currency: log.currency,
            hasEventId: !!log.eventId,
          },
          discrepancies: discrepancies.length > 0 ? discrepancies : undefined,
          errors: errors.length > 0 ? errors : undefined,
        });
      }
    }
  }

  const totalTests = results.length;
  const parameterCompleteness =
    totalTests > 0 ? Math.round(((passedTests + missingParamTests) / totalTests) * 100) : 0;
  const valueAccuracy = valueChecks > 0 ? Math.round(totalValueAccuracy / valueChecks) : 100;

  let reconciliation: VerificationSummary["reconciliation"] | undefined;
  try {
    const endDate = new Date();
    const pixelVsCapi = await reconcilePixelVsCapi(shopId, since, endDate);

    const consistencyIssues: VerificationSummary["reconciliation"]["consistencyIssues"] = [];

    const orderPlatformMap = new Map<string, Map<string, number>>();
    for (const log of conversionLogs) {
      const key = `${log.orderId}_${log.platform}`;
      const count = orderPlatformMap.get(log.orderId)?.get(log.platform) || 0;
      if (!orderPlatformMap.has(log.orderId)) {
        orderPlatformMap.set(log.orderId, new Map());
      }
      orderPlatformMap.get(log.orderId)!.set(log.platform, count + 1);
    }

    for (const [orderId, platformMap] of orderPlatformMap) {
      for (const [platform, count] of platformMap) {
        if (count > 1) {
          consistencyIssues.push({
            orderId,
            issue: `${platform} 平台重复发送 ${count} 次`,
            type: "duplicate",
          });
        }
      }
    }

    // 执行本地一致性检查
    const localConsistencyChecks: Array<{
      orderId: string;
      status: "consistent" | "partial" | "inconsistent";
      issues: string[];
    }> = [];

    // 对前 10 个订单进行详细的一致性检查
    const sampleOrderIds = orderIds.slice(0, 10);
    for (const orderId of sampleOrderIds) {
      try {
        const { performChannelReconciliation } = await import("./enhanced-reconciliation.server");
        const checks = await performChannelReconciliation(shopId, [orderId], admin);
        if (checks.length > 0) {
          const check = checks[0];
          if (check.consistencyStatus !== "consistent" || check.issues.length > 0) {
            localConsistencyChecks.push({
              orderId: check.orderId,
              status: check.consistencyStatus,
              issues: check.issues,
            });
          }
        }
      } catch (error) {
        logger.warn("Failed to perform local consistency check", { orderId, error });
      }
    }

    // 将本地一致性检查结果添加到 consistencyIssues
    localConsistencyChecks.forEach((check) => {
      consistencyIssues.push({
        orderId: check.orderId,
        issue: check.issues.join("; "),
        type: check.status === "inconsistent" ? "error" : "warning",
      });
    });

    reconciliation = {
      pixelVsCapi,
      consistencyIssues: consistencyIssues.length > 0 ? consistencyIssues : undefined,
      localConsistency: localConsistencyChecks.length > 0
        ? {
            totalChecked: sampleOrderIds.length,
            consistent: sampleOrderIds.length - localConsistencyChecks.length,
            partial: localConsistencyChecks.filter((c) => c.status === "partial").length,
            inconsistent: localConsistencyChecks.filter((c) => c.status === "inconsistent").length,
            issues: localConsistencyChecks,
          }
        : undefined,
    };
  } catch (error) {
    logger.error("Failed to perform reconciliation during verification", { error, shopId, runId });

  }

  await prisma.verificationRun.update({
    where: { id: runId },
    data: {
      status: "completed",
      completedAt: new Date(),
      summaryJson: {
        totalTests,
        passedTests,
        failedTests,
        missingParamTests,
        notTestedCount: 0,
        parameterCompleteness,
        valueAccuracy,
        reconciliation,
      },
      eventsJson: results,
    },
  });

  return {
    runId,
    shopId,
    runName: run.runName,
    runType: run.runType as "quick" | "full" | "custom",
    status: "completed",
    platforms: targetPlatforms,
    startedAt: run.startedAt || undefined,
    completedAt: new Date(),
    totalTests,
    passedTests,
    failedTests,
    missingParamTests,
    notTestedCount: 0,
    parameterCompleteness,
    valueAccuracy,
    results,
    reconciliation,
  };
}

export async function getVerificationHistory(
  shopId: string,
  limit = 10
): Promise<VerificationSummary[]> {
  const runs = await prisma.verificationRun.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return runs.map((run) => {
    const summary = run.summaryJson as Record<string, unknown> | null;
    return {
      runId: run.id,
      shopId: run.shopId,
      runName: run.runName,
      runType: run.runType as "quick" | "full" | "custom",
      status: run.status as "pending" | "running" | "completed" | "failed",
      platforms: run.platforms,
      startedAt: run.startedAt || undefined,
      completedAt: run.completedAt || undefined,
      totalTests: (summary?.totalTests as number) || 0,
      passedTests: (summary?.passedTests as number) || 0,
      failedTests: (summary?.failedTests as number) || 0,
      missingParamTests: (summary?.missingParamTests as number) || 0,
      notTestedCount: (summary?.notTestedCount as number) || 0,
      parameterCompleteness: (summary?.parameterCompleteness as number) || 0,
      valueAccuracy: (summary?.valueAccuracy as number) || 0,
      results: [],
    };
  });
}

export function generateTestOrderGuide(runType: "quick" | "full" | "custom"): {
  steps: Array<{
    step: number;
    title: string;
    description: string;
    testItemId: string;
  }>;
  estimatedTime: string;
  tips: string[];
} {
  const quickSteps = [
    {
      step: 1,
      title: "创建测试订单",
      description: "在店铺前台添加商品到购物车，完成结账流程。建议使用 Bogus Gateway 或 Shopify Payments 测试模式。",
      testItemId: "purchase",
    },
    {
      step: 2,
      title: "等待事件处理",
      description: "等待 1-2 分钟，让系统处理订单 webhook 和像素事件。",
      testItemId: "purchase",
    },
    {
      step: 3,
      title: "刷新验收页面",
      description: "返回验收页面，点击「运行验收」查看结果。",
      testItemId: "purchase",
    },
  ];

  const fullSteps = [
    ...quickSteps,
    {
      step: 4,
      title: "测试多商品订单",
      description: "添加 2-3 个不同商品，完成结账。验证商品数量和总价正确。",
      testItemId: "purchase_multi",
    },
    {
      step: 5,
      title: "测试折扣订单",
      description: "使用折扣码完成订单，验证折扣后金额正确传递。",
      testItemId: "purchase_discount",
    },
    {
      step: 6,
      title: "测试退款",
      description: "对测试订单进行部分或全额退款，验证退款事件触发。",
      testItemId: "refund",
    },
  ];

  const steps = runType === "full" ? fullSteps : quickSteps;

  return {
    steps,
    estimatedTime: runType === "full" ? "15-20 分钟" : "5-10 分钟",
    tips: [
      "使用开发商店或测试模式，避免产生真实费用",
      "确保 Web Pixel 已安装且 CAPI 凭证已配置",
      "在 Shopify 后台启用 Bogus Gateway 或 Shopify Payments 测试模式",
      "如果使用隐身模式，确保接受 cookie 和追踪同意",
    ],
  };
}

export async function exportVerificationReport(
  runId: string,
  format: "json" | "csv" = "json"
): Promise<{ content: string; filename: string; mimeType: string }> {
  const summary = await getVerificationRun(runId);

  if (!summary) {
    throw new Error("Verification run not found");
  }

  const timestamp = new Date().toISOString().split("T")[0];
  const filename = `verification-report-${timestamp}`;

  if (format === "csv") {
    const headers = [
      "测试项",
      "事件类型",
      "平台",
      "订单ID",
      "状态",
      "金额",
      "币种",
      "问题",
    ];
    const rows = summary.results.map((r) => [
      r.testItemId,
      r.eventType,
      r.platform,
      r.orderId || "",
      r.status,
      r.params?.value?.toString() || "",
      r.params?.currency || "",
      r.discrepancies?.join("; ") || r.errors?.join("; ") || "",
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

    return {
      content: csvContent,
      filename: `${filename}.csv`,
      mimeType: "text/csv",
    };
  }

  return {
    content: JSON.stringify(summary, null, 2),
    filename: `${filename}.json`,
    mimeType: "application/json",
  };
}

