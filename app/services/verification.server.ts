import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import type { Prisma } from "@prisma/client";
import { trackEvent } from "./analytics.server";
import { safeFireAndForget } from "../utils/helpers.server";
import { normalizePlanId } from "../services/billing/plans";
import { isPlanAtLeast } from "../utils/plans";
import { extractPlatformFromPayload } from "../utils/common";
import { randomUUID } from "crypto";

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
    description: "完成一个包含单个商品的标准订单，验证 purchase 事件触发",
    eventType: "purchase",
    required: true,
    platforms: ["google", "meta", "tiktok"],
  },
  {
    id: "purchase_multi",
    name: "多商品购买",
    description: "完成一个包含多个不同商品的订单，验证 items 数组完整性",
    eventType: "purchase",
    required: false,
    platforms: ["google", "meta", "tiktok"],
  },
  {
    id: "purchase_discount",
    name: "折扣订单",
    description: "使用折扣码完成订单，验证最终金额（原价 - 折扣）计算正确",
    eventType: "purchase",
    required: false,
    platforms: ["google", "meta", "tiktok"],
  },
  {
    id: "purchase_shipping",
    name: "含运费订单",
    description: "完成一个包含运费的订单，验证总金额（商品 + 运费）正确",
    eventType: "purchase",
    required: false,
    platforms: ["google", "meta", "tiktok"],
  },
  {
    id: "purchase_complex",
    name: "复杂订单（多商品 + 折扣 + 运费）",
    description: "完成一个包含多商品、折扣码和运费的完整订单，验证所有参数正确",
    eventType: "purchase",
    required: false,
    platforms: ["google", "meta", "tiktok"],
  },
  {
    id: "currency_test",
    name: "多币种测试",
    description: "使用非 USD 币种完成订单，验证 currency 参数正确",
    eventType: "purchase",
    required: false,
    platforms: ["google", "meta", "tiktok"],
  },
];

export interface VerificationEventResult {
  testItemId: string;
  eventType: string;
  platform: string;
  orderId?: string;
  orderNumber?: string;
  status: "success" | "failed" | "missing_params" | "not_tested" | "deduplicated" | "warning";
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
  const { since = new Date(Date.now() - 24 * 60 * 60 * 1000), platforms } = options;
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
    take: 1000,
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
  const orderKeysFromReceipts = [...new Set(receipts.map((r) => {
    if (r.orderKey) return r.orderKey;
    const payload = r.payloadJson as Record<string, unknown> | null;
    return (payload?.data as Record<string, unknown>)?.orderId as string | undefined;
  }).filter(Boolean) as string[])];
  const orderSummaries = orderKeysFromReceipts.length > 0
    ? await prisma.orderSummary.findMany({
        where: { shopId, orderId: { in: orderKeysFromReceipts } },
        select: { orderId: true, totalPrice: true, currency: true },
      })
    : [];
  const orderSummaryMap = new Map(
    orderSummaries.map((o) => [o.orderId, { totalPrice: Number(o.totalPrice), currency: o.currency }])
  );

  // Pre-fetch potential duplicates for purchase events (Fix N+1)
  const purchaseOrderKeys = receipts
    .filter((r) => r.eventType === "purchase" && r.orderKey)
    .map((r) => r.orderKey as string);
  
  const duplicateMap = new Map<string, Array<{ id: string; createdAt: Date; eventId: string }>>();
  
  if (purchaseOrderKeys.length > 0) {
    const potentialDuplicates = await prisma.pixelEventReceipt.findMany({
      where: {
        shopId,
        eventType: "purchase",
        orderKey: { in: purchaseOrderKeys },
      },
      select: { id: true, orderKey: true, createdAt: true, eventId: true },
      orderBy: { createdAt: "desc" },
    });
    
    for (const r of potentialDuplicates) {
      if (!r.orderKey) continue;
      const list = duplicateMap.get(r.orderKey) || [];
      list.push(r);
      duplicateMap.set(r.orderKey, list);
    }
  }

  const results: VerificationEventResult[] = [];
  let passedTests = 0;
  let failedTests = 0;
  let missingParamTests = 0;
  let totalValueAccuracy = 0;
  let valueChecks = 0;
  const orderIds = new Set<string>();
  const consistencyIssues: Array<{ orderId: string; issue: string; type: "value_mismatch" | "currency_mismatch" | "missing" | "duplicate" }> = [];
  const platformResults: Record<string, { sent: number; failed: number }> = {};
  for (const p of targetPlatforms) {
    platformResults[p] = { sent: 0, failed: 0 };
  }
  for (const receipt of receipts) {
    const payload = receipt.payloadJson as Record<string, unknown> | null;
    const platform = receipt.platform ?? extractPlatformFromPayload(payload);
    if (!platform || (targetPlatforms.length > 0 && !targetPlatforms.includes(platform))) {
      continue;
    }
    const orderId = receipt.orderKey || (payload?.data as Record<string, unknown>)?.orderId as string | undefined;
    if (orderId) {
      orderIds.add(orderId);
    }
    const discrepancies: string[] = [];
    const data = payload?.data as Record<string, unknown> | undefined;
    let value: number | undefined;
    let currency: string | undefined;
    let items: number | undefined;
    if (payload) {
      value = data?.value != null ? Number(data.value) : undefined;
      currency = data?.currency as string | undefined;
      const dataItems = data?.items as Array<unknown> | undefined;
      items = dataItems ? dataItems.length : undefined;
      if (platform === "google") {
        const events = payload.events as Array<Record<string, unknown>> | undefined;
        if (events && events.length > 0) {
          const params = events[0].params as Record<string, unknown> | undefined;
          value = params?.value != null ? Number(params.value) : undefined;
          currency = params?.currency as string | undefined;
          items = Array.isArray(params?.items) ? params.items.length : undefined;
        }
      } else if (platform === "meta" || platform === "facebook") {
        const eventsData = payload.data as Array<Record<string, unknown>> | undefined;
        if (eventsData && eventsData.length > 0) {
          const customData = eventsData[0].custom_data as Record<string, unknown> | undefined;
          value = customData?.value != null ? Number(customData.value) : undefined;
          currency = customData?.currency as string | undefined;
          items = Array.isArray(customData?.contents) ? customData.contents.length : undefined;
        }
      } else if (platform === "tiktok") {
        const eventsData = payload.data as Array<Record<string, unknown>> | undefined;
        if (eventsData && eventsData.length > 0) {
          const properties = eventsData[0].properties as Record<string, unknown> | undefined;
          value = properties?.value != null ? Number(properties.value) : undefined;
          currency = properties?.currency as string | undefined;
          items = Array.isArray(properties?.contents) ? properties.contents.length : undefined;
        }
      }
    }
    const hasValue = value !== undefined && value !== null;
    const hasCurrency = !!currency;
    const hasEventId = !!payload?.eventId || !!receipt.id;
    let dedupInfo: { existingEventId?: string; reason?: string } | undefined;
    if (receipt.eventType !== "purchase") {
      const hasBasicFields = !!payload?.eventId && !!(payload?.eventName ?? receipt.eventType);
      if (hasBasicFields) {
        passedTests++;
        const p = platform || "unknown";
        if (!platformResults[p]) platformResults[p] = { sent: 0, failed: 0 };
        platformResults[p].sent++;
        results.push({
          testItemId: receipt.eventType,
          eventType: receipt.eventType,
          platform: p,
          orderId: orderId || undefined,
          orderNumber: undefined,
          status: "success",
          triggeredAt: receipt.pixelTimestamp,
          params: { hasEventId },
          discrepancies: undefined,
          errors: undefined,
          dedupInfo: undefined,
        });
      } else {
        missingParamTests++;
        const p = platform || "unknown";
        if (!platformResults[p]) platformResults[p] = { sent: 0, failed: 0 };
        platformResults[p].failed++;
        const disc: string[] = [];
        if (!payload?.eventId) disc.push("缺少 eventId");
        if (!(payload?.eventName ?? receipt.eventType)) disc.push("缺少 eventName");
        results.push({
          testItemId: receipt.eventType,
          eventType: receipt.eventType,
          platform: p,
          orderId: orderId || undefined,
          orderNumber: undefined,
          status: "missing_params",
          triggeredAt: receipt.pixelTimestamp,
          params: { hasEventId },
          discrepancies: disc.length > 0 ? disc : undefined,
          errors: undefined,
          dedupInfo: undefined,
        });
      }
      continue;
    }
    if (orderId && receipt.eventType === "purchase") {
      const history = duplicateMap.get(orderId);
      if (history) {
        const existingReceipt = history.find(
          (h) => h.id !== receipt.id && h.createdAt < receipt.createdAt
        );
        if (existingReceipt) {
          dedupInfo = {
            existingEventId: existingReceipt.eventId,
            reason: `已在 ${existingReceipt.createdAt.toISOString()} 记录过相同订单事件`,
          };
        }
      }
    }
    const p = platform || "unknown";
    if (!platformResults[p]) platformResults[p] = { sent: 0, failed: 0 };
    if (hasValue && hasCurrency) {
      if (dedupInfo) {
        results.push({
          testItemId: "purchase",
          eventType: receipt.eventType,
          platform: p,
          orderId: orderId || undefined,
          orderNumber: undefined,
          status: "deduplicated",
          triggeredAt: receipt.pixelTimestamp,
          params: {
            value: value || undefined,
            currency: currency || undefined,
            items: items || undefined,
            hasEventId,
          },
          discrepancies: undefined,
          errors: undefined,
          dedupInfo,
        });
      } else {
        platformResults[p].sent++;
        const orderSummary = orderId ? orderSummaryMap.get(orderId) : undefined;
        let isFailed = false;
        let discrepancyNote: string | undefined;
        
        if (orderSummary) {
          valueChecks++;
          const valueMatch = Math.abs((value ?? 0) - orderSummary.totalPrice) < 0.01;
          const currencyMatch = (currency ?? "").toUpperCase() === (orderSummary.currency ?? "").toUpperCase();
          if (valueMatch && currencyMatch) {
            totalValueAccuracy += 100;
          } else {
            isFailed = true;
            if (!valueMatch && orderId) {
              consistencyIssues.push({
                orderId,
                issue: `payload value ${value} vs order total ${orderSummary.totalPrice}`,
                type: "value_mismatch",
              });
            }
            if (!currencyMatch && orderId) {
              consistencyIssues.push({
                orderId,
                issue: `payload currency ${currency} vs order currency ${orderSummary.currency}`,
                type: "currency_mismatch",
              });
            }
          }
        } else {
          // Fix P1-5: Do not default to 100% accuracy if order summary is missing.
          // We simply skip the value check and mark as "not verified" for value.
          discrepancyNote = "无法关联订单详情，跳过金额对账";
        }

        if (isFailed) {
          failedTests++;
          platformResults[p].failed++;
          results.push({
            testItemId: "purchase",
            eventType: receipt.eventType,
            platform: p,
            orderId: orderId || undefined,
            orderNumber: undefined,
            status: "failed",
            triggeredAt: receipt.pixelTimestamp,
            params: {
              value: value || undefined,
              currency: currency || undefined,
              items: items || undefined,
              hasEventId,
            },
            discrepancies: ["金额或币种与订单不一致"],
            errors: undefined,
            dedupInfo,
          });
        } else {
          passedTests++;
          results.push({
            testItemId: "purchase",
            eventType: receipt.eventType,
            platform: p,
            orderId: orderId || undefined,
            orderNumber: undefined,
            status: discrepancyNote ? "warning" : "success",
            triggeredAt: receipt.pixelTimestamp,
            params: {
              value: value || undefined,
              currency: currency || undefined,
              items: items || undefined,
              hasEventId,
            },
            discrepancies: discrepancyNote ? [discrepancyNote] : undefined,
            errors: undefined,
            dedupInfo,
          });

          // Check for specific test scenarios
          if (items && items > 1) {
             results.push({
              testItemId: "purchase_multi",
              eventType: "purchase (multi-item)",
              platform: p,
              orderId: orderId || undefined,
              status: "success",
              triggeredAt: receipt.pixelTimestamp,
              params: { items },
             });
             passedTests++; 
          }
          
          if (currency && currency !== "USD") { 
             results.push({
              testItemId: "currency_test",
              eventType: "purchase (currency)",
              platform: p,
              orderId: orderId || undefined,
              status: "success",
              triggeredAt: receipt.pixelTimestamp,
              params: { currency },
             });
             passedTests++;
          }
        }
      }
    } else {
      missingParamTests++;
      platformResults[p].failed++;
      if (!hasValue) discrepancies.push("缺少 value 参数");
      if (!hasCurrency) discrepancies.push("缺少 currency 参数");
      results.push({
        testItemId: "purchase",
        eventType: receipt.eventType,
        platform: p,
        orderId: orderId || undefined,
        orderNumber: undefined,
        status: "missing_params",
        triggeredAt: receipt.pixelTimestamp,
        params: {
          value: value || undefined,
          currency: currency || undefined,
          items: items || undefined,
          hasEventId,
        },
        discrepancies: discrepancies.length > 0 ? discrepancies : undefined,
        errors: undefined,
        dedupInfo,
      });
    }
  }
  const totalTests = results.length;
  const parameterCompleteness =
    totalTests > 0 ? Math.round(((passedTests + missingParamTests) / totalTests) * 100) : 0;
  // If no value checks were performed, default to 0 to avoid misleading 100% accuracy
  const valueAccuracy = valueChecks > 0 ? Math.round(totalValueAccuracy / valueChecks) : 0;
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
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { shopDomain: true },
  });
  if (shop) {
        const shopRecord = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { plan: true },
    });
    const planId = normalizePlanId(shopRecord?.plan ?? "free");
    const isAgency = isPlanAtLeast(planId, "agency");
    const verificationPassRate = totalTests > 0 ? (passedTests / totalTests) * 100 : 0;
        const pixelConfigs = await prisma.pixelConfig.findMany({
      where: {
        shopId,
        isActive: true,
        platform: { in: targetPlatforms },
      },
      select: {
        platform: true,
        environment: true,
      },
      take: 1,
    });
    const destinationType = pixelConfigs.length > 0 ? pixelConfigs[0].platform : targetPlatforms[0] || "none";
    const environment = pixelConfigs.length > 0 ? pixelConfigs[0].environment : "live";
        const firstEventName = receipts.length > 0 ? receipts[0].eventType : undefined;
        let riskScore: number | undefined;
    let assetCount: number | undefined;
    try {
      const latestScan = await prisma.scanReport.findFirst({
        where: { shopId },
        orderBy: { createdAt: "desc" },
        select: { riskScore: true },
      });
      if (latestScan) {
        riskScore = latestScan.riskScore;
        const assets = await prisma.auditAsset.count({
          where: { shopId },
        });
        assetCount = assets;
      }
    } catch {
      // no-op: ignore errors when counting assets
    }
        safeFireAndForget(
      trackEvent({
        shopId,
        shopDomain: shop.shopDomain,
        event: "ver_run_completed",
        eventId: `ver_run_completed_${runId}`,
        metadata: {
          run_id: runId,
          run_type: run.runType,
          platforms: targetPlatforms,
          plan: shopRecord?.plan ?? "free",
          role: isAgency ? "agency" : "merchant",
          verification_pass_rate: verificationPassRate,
          total_tests: totalTests,
          passed_tests: passedTests,
          failed_tests: failedTests,
          missing_param_tests: missingParamTests,
          parameter_completeness: parameterCompleteness,
          value_accuracy: valueAccuracy,
          destination_type: destinationType,
          environment: environment,
          first_event_name: firstEventName,
          risk_score: riskScore,
          asset_count: assetCount,
        },
      })
    );
  }
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

import { escapeCSV } from "../utils/csv.server";

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
      escapeCSV(r.testItemId),
      escapeCSV(r.eventType),
      escapeCSV(r.platform),
      escapeCSV(r.orderId || ""),
      escapeCSV(r.status),
      escapeCSV(r.params?.value?.toString() || ""),
      escapeCSV(r.params?.currency || ""),
      escapeCSV(r.discrepancies?.join("; ") || r.errors?.join("; ") || ""),
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
