import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import type { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { Platform, EventType, VerificationDefaults } from "../utils/constants";
import { processReceipt } from "./verification/receipt-processor.server";

export interface VerificationTestItem {
  id: string;
  name: string;
  description: string;
  eventType: string;
  required: boolean;
  platforms: string[];
  steps: string[];
  expectedEvents: string[];
}

export const VERIFICATION_TEST_ITEMS: VerificationTestItem[] = [
  {
    id: "purchase",
    name: "标准购买",
    description: "完成一个包含单个商品的标准订单，验证 purchase 事件触发",
    eventType: EventType.PURCHASE,
    required: true,
    platforms: [Platform.GOOGLE, Platform.META, Platform.TIKTOK],
    steps: [
      "在店铺前台浏览商品详情页",
      "点击「添加到购物车」或「立即购买」",
      "进入结账页面，填写测试地址",
      "使用 Bogus Gateway 或测试卡完成支付",
    ],
    expectedEvents: ["checkout_completed", "purchase"],
  },
  {
    id: "purchase_multi",
    name: "多商品购买",
    description: "完成一个包含多个不同商品的订单，验证 items 数组完整性",
    eventType: EventType.PURCHASE,
    required: false,
    platforms: [Platform.GOOGLE, Platform.META, Platform.TIKTOK],
    steps: [
      "添加商品 A 到购物车",
      "添加商品 B 到购物车",
      "进入结账页面完成支付",
    ],
    expectedEvents: ["checkout_completed", "purchase"],
  },
  {
    id: "purchase_discount",
    name: "折扣订单",
    description: "使用折扣码完成订单，验证最终金额（原价 - 折扣）计算正确",
    eventType: EventType.PURCHASE,
    required: false,
    platforms: [Platform.GOOGLE, Platform.META, Platform.TIKTOK],
    steps: [
      "添加商品到购物车",
      "在结账页面输入折扣码（如 SAVE10）",
      "确认金额已更新",
      "完成支付",
    ],
    expectedEvents: ["checkout_completed", "purchase"],
  },
  {
    id: "purchase_shipping",
    name: "含运费订单",
    description: "完成一个包含运费的订单，验证总金额（商品 + 运费）正确",
    eventType: EventType.PURCHASE,
    required: false,
    platforms: [Platform.GOOGLE, Platform.META, Platform.TIKTOK],
    steps: [
      "添加商品到购物车",
      "选择需要运费的配送方式",
      "完成支付",
    ],
    expectedEvents: ["checkout_completed", "purchase"],
  },
  {
    id: "purchase_complex",
    name: "复杂订单（多商品 + 折扣 + 运费）",
    description: "完成一个包含多商品、折扣码和运费的完整订单，验证所有参数正确",
    eventType: EventType.PURCHASE,
    required: false,
    platforms: [Platform.GOOGLE, Platform.META, Platform.TIKTOK],
    steps: [
      "添加多个商品",
      "应用折扣码",
      "选择付费配送",
      "完成支付",
    ],
    expectedEvents: ["checkout_completed", "purchase"],
  },
  {
    id: "currency_test",
    name: "多币种测试",
    description: "使用非 USD 币种完成订单，验证 currency 参数正确",
    eventType: EventType.PURCHASE,
    required: false,
    platforms: [Platform.GOOGLE, Platform.META, Platform.TIKTOK],
    steps: [
      "切换店铺币种（如果支持）或修改测试订单币种",
      "完成支付",
    ],
    expectedEvents: ["checkout_completed", "purchase"],
  },
];

export interface VerificationEventResult {
  testItemId: string;
  eventType: string;
  platform: string;
  orderId?: string;
  orderNumber?: string;
  status: "success" | "failed" | "missing_params" | "not_tested" | "deduplicated";
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
  dedupInfo?: {
    existingEventId?: string;
    reason?: string;
  };
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
  platformResults?: Record<string, { sent: number; failed: number }>;
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
  const { runName = "验收测试", runType = "quick", platforms = [] } = options;
  let targetPlatforms = platforms;
  if (targetPlatforms.length === 0) {
    const configs = await prisma.pixelConfig.findMany({
      where: { shopId, isActive: true },
      select: { platform: true },
    });
    targetPlatforms = configs.map((c: { platform: string }) => c.platform);
  }
  const run = await prisma.verificationRun.create({
    data: {
      id: randomUUID(),
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
    select: {
      id: true,
      shopId: true,
      runName: true,
      runType: true,
      status: true,
      platforms: true,
      summaryJson: true,
      eventsJson: true,
      startedAt: true,
      completedAt: true,
      Shop: {
        select: { shopDomain: true },
      },
    },
  });
  if (!run) return null;
  const summary = run.summaryJson as Record<string, unknown> | null;
  const events = ((run.eventsJson as unknown) as VerificationEventResult[]) || [];
  const reconciliation = summary?.reconciliation as VerificationSummary["reconciliation"] | undefined;
  const platformResults = (summary?.platformResults as Record<string, { sent: number; failed: number }>) || undefined;
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
    platformResults,
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
  const { since = new Date(Date.now() - VerificationDefaults.WINDOW_MS), platforms } = options;
  const run = await prisma.verificationRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      shopId: true,
      platforms: true,
      runType: true,
      runName: true,
      startedAt: true,
    },
  });
  if (!run) {
    throw new Error("Verification run not found");
  }
  const targetPlatforms = platforms || run.platforms;
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      pixelTimestamp: { gte: since },
    },
    orderBy: { pixelTimestamp: "desc" },
    take: VerificationDefaults.MAX_RECEIPTS,
    select: {
      id: true,
      eventType: true,
      platform: true,
      payloadJson: true,
      pixelTimestamp: true,
      createdAt: true,
      orderKey: true,
    },
  });

  // Prepare Order Summaries
  const orderKeysFromReceipts = [...new Set(receipts.map((r) => r.orderKey).filter(Boolean) as string[])];
  const orderSummaries = orderKeysFromReceipts.length > 0
    ? await prisma.orderSummary.findMany({
        where: { shopId, orderId: { in: orderKeysFromReceipts } },
        select: { orderId: true, totalPrice: true, currency: true },
      })
    : [];
  const orderSummaryMap = new Map(
    orderSummaries.map((o) => [o.orderId, { totalPrice: Number(o.totalPrice), currency: o.currency }])
  );

  // Prepare Deduplication Data (Bulk Fetch)
  const purchaseOrderKeys = [...new Set(receipts
    .filter(r => r.eventType === EventType.PURCHASE && r.orderKey)
    .map(r => r.orderKey as string)
  )];

  const historicalReceiptsMap = new Map<string, { eventId: string; createdAt: Date }>();
  
  if (purchaseOrderKeys.length > 0) {
    const minCreatedAt = receipts.reduce((min, r) => r.createdAt < min ? r.createdAt : min, new Date());
    
    const historical = await prisma.pixelEventReceipt.findMany({
      where: {
        shopId,
        orderKey: { in: purchaseOrderKeys },
        eventType: EventType.PURCHASE,
        createdAt: { lt: minCreatedAt }, 
      },
      select: { orderKey: true, eventId: true, createdAt: true },
    });

    for (const h of historical) {
      const key = h.orderKey!;
      if (!historicalReceiptsMap.has(key) || h.createdAt < historicalReceiptsMap.get(key)!.createdAt) {
        historicalReceiptsMap.set(key, { eventId: h.eventId, createdAt: h.createdAt });
      }
    }
  }

  // Processing
  const results: VerificationEventResult[] = [];
  let passedTests = 0;
  const failedTests = 0;
  let missingParamTests = 0;
  let totalValueAccuracy = 0;
  let valueChecks = 0;
  
  const consistencyIssues: Array<{ orderId: string; issue: string; type: "value_mismatch" | "currency_mismatch" | "missing" | "duplicate" }> = [];
  const platformResults: Record<string, { sent: number; failed: number }> = {};
  for (const p of targetPlatforms) {
    platformResults[p] = { sent: 0, failed: 0 };
  }
  
  const sortedReceipts = [...receipts].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  for (const receipt of sortedReceipts) {
    const orderId = receipt.orderKey;
    let dedupInfo: { existingEventId?: string; reason?: string } | undefined;

    if (orderId && receipt.eventType === EventType.PURCHASE) {
      if (historicalReceiptsMap.has(orderId)) {
        const h = historicalReceiptsMap.get(orderId)!;
        dedupInfo = {
          existingEventId: h.eventId,
          reason: `已在 ${h.createdAt.toISOString()} 记录过相同订单事件`,
        };
      } else {
        const payload = receipt.payloadJson as Record<string, unknown> | null;
        historicalReceiptsMap.set(orderId, { eventId: (payload?.eventId as string) || receipt.id, createdAt: receipt.createdAt });
      }
    }

    const orderSummary = orderId ? orderSummaryMap.get(orderId) : undefined;
    
    const processed = processReceipt(
      receipt,
      orderSummary,
      dedupInfo,
      targetPlatforms
    );

    if (processed) {
      results.push(processed.result);
      
      const p = processed.result.platform;
      if (!platformResults[p]) platformResults[p] = { sent: 0, failed: 0 };

      if (processed.stats.passed) {
        passedTests++;
        platformResults[p].sent++;
      }
      if (processed.stats.missingParams || processed.stats.failed) {
        missingParamTests++; 
        platformResults[p].failed++;
      }
      if (processed.stats.valueMatched && processed.stats.currencyMatched) {
        valueChecks++;
        totalValueAccuracy += 100;
      }
      
      if (processed.consistencyIssues.length > 0) {
        consistencyIssues.push(...processed.consistencyIssues);
      }
    }
  }

  // Restore result order to Newest First (standard for UI)
  results.sort((a, b) => (b.triggeredAt?.getTime() || 0) - (a.triggeredAt?.getTime() || 0));

  const totalTests = results.length;
  const parameterCompleteness =
    totalTests > 0 ? Math.round(((passedTests + missingParamTests) / totalTests) * 100) : 0;
  const valueAccuracy = valueChecks > 0 ? Math.round(totalValueAccuracy / valueChecks) : 100;
  const reconciliation: VerificationSummary["reconciliation"] | undefined =
    consistencyIssues.length > 0
      ? {
          pixelVsCapi: { pixelOnly: 0, capiOnly: 0, both: 0, consentBlocked: 0 },
          consistencyIssues,
        }
      : undefined;
      
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
        platformResults,
        reconciliation,
      },
      eventsJson: results as unknown as Prisma.InputJsonValue,
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
    platformResults,
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
    select: {
      id: true,
      shopId: true,
      runName: true,
      runType: true,
      status: true,
      platforms: true,
      summaryJson: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
    },
  });
  return runs.map((run) => {
    const summary = run.summaryJson as Record<string, unknown> | null;
    return {
      runId: run.id,
      shopId: run.shopId,
      runName: run.runName,
      runType: (run.runType || "quick") as "quick" | "full" | "custom",
      status: (run.status || "pending") as "pending" | "running" | "completed" | "failed",
      platforms: run.platforms || [],
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
  ];
  const steps = runType === "full" ? fullSteps : quickSteps;
  return {
    steps,
    estimatedTime: runType === "full" ? "15-20 分钟" : "5-10 分钟",
    tips: [
      "使用开发商店或测试模式，避免产生真实费用",
      "确保 Web Pixel 已安装并完成测试订单验收",
      "在 Shopify 后台启用 Bogus Gateway 或 Shopify Payments 测试模式",
      "如果使用隐身模式，确保接受 cookie 和追踪同意",
    ],
  };
}

export async function exportVerificationReport(
  runId: string,
  _format: "json" | "csv" = "json"
): Promise<{ content: string; filename: string; mimeType: string }> {
  // Only JSON is supported in V1
  const summary = await getVerificationRun(runId);
  if (!summary) {
    throw new Error("Verification run not found");
  }
  const timestamp = new Date().toISOString().split("T")[0];
  const filename = `verification-report-${timestamp}`;
  
  return {
    content: JSON.stringify(summary, null, 2),
    filename: `${filename}.json`,
    mimeType: "application/json",
  };
}
