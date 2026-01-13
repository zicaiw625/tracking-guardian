import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  rollbackConfig,
  switchEnvironment,
  type PixelEnvironment,
} from "../services/pixel-rollback.server";
import { logger } from "../utils/logger.server";
import { trackEvent } from "../services/analytics.server";
import { safeFireAndForget } from "../utils/helpers";
import { normalizePlanId } from "../services/billing/plans";
import { isPlanAtLeast } from "../utils/plans";
import { isV1SupportedPlatform, getV1Platforms } from "../utils/v1-platforms";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });
  if (!shop) {
    return json({ success: false, error: "Shop not found" }, { status: 404 });
  }
  const formData = await request.formData();
  const actionType = formData.get("_action") as string;
  const platform = formData.get("platform") as string;
  if (!platform) {
    return json({ success: false, error: "缺少 platform 参数" }, { status: 400 });
  }
  if (!isV1SupportedPlatform(platform)) {
    const v1Platforms = getV1Platforms();
    return json({
      success: false,
      error: `平台 ${platform} 在 v1.0 版本中不支持。v1.0 仅支持: ${v1Platforms.join(", ")}。`,
    }, { status: 400 });
  }
  try {
    switch (actionType) {
      case "rollback": {
        const result = await rollbackConfig(shop.id, platform);
        return json({
          success: result.success,
          message: result.message,
          previousVersion: result.previousVersion,
          currentVersion: result.currentVersion,
        });
      }
      case "switch_environment": {
        const newEnvironment = formData.get("environment") as PixelEnvironment;
        if (!newEnvironment || !["test", "live"].includes(newEnvironment)) {
          return json({
            success: false,
            error: "无效的环境参数"
          }, { status: 400 });
        }
        const result = await switchEnvironment(shop.id, platform, newEnvironment);
        if (
          result.success &&
          result.previousEnvironment !== "live" &&
          result.newEnvironment === "live"
        ) {
                    const planId = normalizePlanId(shop.plan ?? "free");
          const isAgency = isPlanAtLeast(planId, "agency");
                    let riskScore: number | undefined;
          let assetCount: number | undefined;
          try {
            const latestScan = await prisma.scanReport.findFirst({
              where: { shopId: shop.id },
              orderBy: { createdAt: "desc" },
              select: { riskScore: true },
            });
            if (latestScan) {
              riskScore = latestScan.riskScore;
              const assets = await prisma.auditAsset.count({
                where: { shopId: shop.id },
              });
              assetCount = assets;
            }
          } catch (error) {
                      }
          safeFireAndForget(
            trackEvent({
              shopId: shop.id,
              shopDomain,
              event: "cfg_pixel_live_enabled",
              metadata: {
                platform,
                previousEnvironment: result.previousEnvironment,
                newEnvironment: result.newEnvironment,
                                plan: shop.plan ?? "free",
                role: isAgency ? "agency" : "merchant",
                destination_type: platform,
                environment: result.newEnvironment,
                risk_score: riskScore,
                asset_count: assetCount,
                              },
            })
          );
        }
        return json({
          success: result.success,
          message: result.message,
          previousEnvironment: result.previousEnvironment,
          newEnvironment: result.newEnvironment,
        });
      }
      default:
        return json({ success: false, error: "未知操作" }, { status: 400 });
    }
  } catch (error) {
    logger.error("Pixel config action error", { actionType, platform, error });
    return json({
      success: false,
      error: "操作失败，请稍后重试"
    }, { status: 500 });
  }
};
