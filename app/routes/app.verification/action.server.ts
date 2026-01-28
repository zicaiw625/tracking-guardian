import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import {
  createVerificationRun,
  startVerificationRun,
  analyzeRecentEvents,
} from "../../services/verification.server";
import {
  checkFeatureAccess,
} from "../../services/billing/feature-gates.server";
import { normalizePlanId, type PlanId } from "../../services/billing/plans";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("_action");
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });
  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }
  if (actionType === "create_run" || actionType === "run_verification" || actionType === "verifyTestItem") {
    const planId = normalizePlanId(shop.plan || "free") as PlanId;
    const gateResult = checkFeatureAccess(planId, "verification");
    if (!gateResult.allowed) {
      return json({ success: false, error: gateResult.reason }, { status: 402 });
    }
  }
  if (actionType === "create_run") {
    const runType = (formData.get("runType") as "quick" | "full") || "quick";
    const runId = await createVerificationRun(shop.id, { runType });
    return json({ success: true, runId, actionType: "create_run" });
  }
  if (actionType === "run_verification") {
    const runId = formData.get("runId") as string;
    if (!runId) {
      const newRunId = await createVerificationRun(shop.id, { runType: "quick" });
      await startVerificationRun(newRunId);
      const result = await analyzeRecentEvents(shop.id, newRunId);
      return json({ success: true, result, actionType: "run_verification" });
    }
    await startVerificationRun(runId);
    const result = await analyzeRecentEvents(shop.id, runId);
    return json({ success: true, result, actionType: "run_verification" });
  }
  if (actionType === "verifyTestItem") {
    try {
      const itemId = formData.get("itemId") as string;
      const eventType = formData.get("eventType") as string;
      const expectedEventsStr = formData.get("expectedEvents") as string;
      if (!itemId || !eventType || !expectedEventsStr) {
        return json({ success: false, error: "缺少必要参数" }, { status: 400 });
      }
      const expectedEvents = JSON.parse(expectedEventsStr) as string[];
      const fiveMinutesAgo = new Date();
      fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);
      const receipts = await prisma.pixelEventReceipt.findMany({
        where: {
          shopId: shop.id,
          createdAt: { gte: fiveMinutesAgo },
          eventType: { in: expectedEvents.length > 0 ? expectedEvents : [eventType] },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      const foundEvents = new Set<string>();
      for (const receipt of receipts) {
        const eventName = receipt.eventType;
        const payload = receipt.payloadJson as Record<string, unknown> | null;
        const shopifyEventName = payload?.event_name as string | undefined;
        const hasValidPayload = !!payload && !!payload.data;
        if (hasValidPayload) {
          for (const expected of expectedEvents) {
            if (eventName.toLowerCase() === expected.toLowerCase() ||
                shopifyEventName?.toLowerCase() === expected.toLowerCase() ||
                eventName.toLowerCase().includes(expected.toLowerCase()) ||
                expected.toLowerCase().includes(eventName.toLowerCase()) ||
                shopifyEventName?.toLowerCase().includes(expected.toLowerCase()) ||
                expected.toLowerCase().includes(shopifyEventName?.toLowerCase() || "")) {
              foundEvents.add(expected);
            }
          }
        }
      }
      const verified = foundEvents.size === expectedEvents.length;
      const missingEvents = expectedEvents.filter((e) => !foundEvents.has(e));
      return json({
        success: true,
        itemId,
        verified,
        eventsFound: foundEvents.size,
        expectedEvents: expectedEvents.length,
        missingEvents,
        errors: verified ? undefined : [
          `未找到以下事件: ${missingEvents.join(", ")}`,
          "请确保已完成测试订单，并等待几秒钟后重试",
          missingEvents.some(e => e.toLowerCase().includes("checkout_completed")) 
            ? "常见原因：checkout_completed 事件通常在 Thank you 页触发，但有 upsell/post-purchase 时会在第一个 upsell 页触发且不会在 Thank you 页再次触发。如果触发页未加载成功，事件可能完全不触发。Web pixel 在需要 consent 的地区会 consent 后才执行并 replay 之前事件。查看上方「checkout_completed 事件的已知行为」了解更多。" 
            : undefined,
        ].filter(Boolean) as string[],
      });
    } catch (error) {
      logger.error("Failed to verify test item", { shopId: shop.id, error });
      return json({
        success: false,
        error: error instanceof Error ? error.message : "验证失败",
      }, { status: 500 });
    }
  }
  return json({ error: "Unknown action" }, { status: 400 });
};
