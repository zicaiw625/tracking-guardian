/**
 * 像素配置操作 API
 * 处理回滚、环境切换等操作
 */

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

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
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

