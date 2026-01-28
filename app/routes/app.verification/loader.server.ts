import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";
import {
  getVerificationHistory,
  generateTestOrderGuide,
  VERIFICATION_TEST_ITEMS,
} from "../../services/verification.server";
import {
  generateTestChecklist,
} from "../../services/verification-checklist.server";
import {
  checkFeatureAccess,
} from "../../services/billing/feature-gates.server";
import { normalizePlanId, type PlanId, planSupportsReportExport } from "../../services/billing/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      plan: true,
      pixelConfigs: {
        where: { isActive: true, serverSideEnabled: true },
        select: { platform: true },
      },
    },
  });
  if (!shop) {
    const pixelStrictOrigin = ["true", "1", "yes"].includes(
      (process.env.PIXEL_STRICT_ORIGIN ?? "").toLowerCase().trim()
    );
    return json({
      shop: null,
      configuredPlatforms: [],
      history: [],
      latestRun: null,
      testGuide: generateTestOrderGuide("quick"),
      testItems: VERIFICATION_TEST_ITEMS,
      testChecklist: generateTestChecklist("", "quick"),
      canAccessVerification: false,
      canExportReports: false,
      gateResult: undefined,
      currentPlan: "free" as PlanId,
      pixelStrictOrigin,
    });
  }
  const planId = normalizePlanId(shop.plan || "free") as PlanId;
  const gateResult = checkFeatureAccess(planId, "verification");
  const canAccessVerification = gateResult.allowed;
  const canExportReports = planSupportsReportExport(planId);
  const configuredPlatforms = shop.pixelConfigs.map((c) => c.platform);
  const history = await getVerificationHistory(shop.id, 5);
  const latestRun = history?.[0] ?? null;
  const testChecklist = generateTestChecklist(shop.id, "quick");
  const pixelStrictOrigin = ["true", "1", "yes"].includes(
    (process.env.PIXEL_STRICT_ORIGIN ?? "").toLowerCase().trim()
  );
  return json({
    shop: { id: shop.id, domain: shopDomain },
    configuredPlatforms,
    history,
    latestRun,
    testGuide: generateTestOrderGuide("quick"),
    testItems: VERIFICATION_TEST_ITEMS,
    testChecklist,
    canAccessVerification,
    canExportReports,
    gateResult: gateResult.allowed ? undefined : gateResult,
    currentPlan: planId,
    pixelStrictOrigin,
  });
};
