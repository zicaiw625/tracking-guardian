import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";
import {
  getExistingWebPixels,
  updateWebPixel,
  isOurWebPixel,
} from "../../services/migration.server";
import { generateEncryptedIngestionSecret } from "../../utils/token-encryption.server";
import { logger } from "../../utils/logger.server";
import { invalidateAllShopCaches } from "../../services/shop-cache.server";

import {
  switchEnvironment,
  rollbackConfig,
  type PixelEnvironment,
} from "../../services/pixel-rollback.server";

export async function handleRotateIngestionSecret(
  shopId: string,
  sessionShop: string,
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"]
) {
  const currentShop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { ingestionSecret: true },
  });
  const { plain: newPlainSecret, encrypted: newEncryptedSecret } =
    generateEncryptedIngestionSecret();
  const graceWindowMinutes = 30;
  const graceWindowExpiry = new Date(
    Date.now() + graceWindowMinutes * 60 * 1000
  );
  await prisma.shop.update({
    where: { id: shopId },
    data: {
      ingestionSecret: newEncryptedSecret,
      previousIngestionSecret: currentShop?.ingestionSecret || null,
      previousSecretExpiry: graceWindowExpiry,
    },
  });
  await invalidateAllShopCaches(sessionShop, shopId);
  let pixelSyncResult = { success: false, message: "" };
  try {
    const existingPixels = await getExistingWebPixels(admin);
    const ourPixel = existingPixels.find((p) => {
      try {
        const settings = JSON.parse(p.settings || "{}");
        return isOurWebPixel(settings, sessionShop);
      } catch {
        return false;
      }
    });
    if (ourPixel) {
      const result = await updateWebPixel(admin, ourPixel.id, newPlainSecret, sessionShop);
      if (result.success) {
        pixelSyncResult = {
          success: true,
          message: "已自动同步到 Web Pixel 配置",
        };
      } else {
        pixelSyncResult = {
          success: false,
          message: `Web Pixel 同步失败: ${result.error}`,
        };
      }
    } else {
      pixelSyncResult = {
        success: false,
        message: "未找到已安装的 Web Pixel，请先在「迁移」页面安装像素",
      };
    }
  } catch (pixelError) {
    logger.error("Failed to sync ingestion token to Web Pixel", pixelError);
    pixelSyncResult = {
      success: false,
      message: "Web Pixel 同步失败，请手动重新配置",
    };
  }
  const baseMessage = "关联令牌已更新。";
  const graceMessage = ` 旧令牌将在 ${graceWindowMinutes} 分钟内继续有效。`;
  const syncMessage = pixelSyncResult.success
    ? pixelSyncResult.message
    : `⚠️ ${pixelSyncResult.message}`;
  return json({
    success: true,
    message: `${baseMessage}${graceMessage}${syncMessage}`,
    pixelSyncSuccess: pixelSyncResult.success,
    graceWindowExpiry: graceWindowExpiry.toISOString(),
  });
}

export async function handleUpdatePrivacySettings(
  formData: FormData,
  shopId: string,
  _sessionShop: string
) {
  const consentStrategy =
    (formData.get("consentStrategy") as string) || "strict";
  const dataRetentionDays =
    parseInt(formData.get("dataRetentionDays") as string) || 90;
  await prisma.shop.update({
    where: { id: shopId },
    data: {
      consentStrategy,
      dataRetentionDays,
    },
  });
  return json({
    success: true,
    message: "隐私设置已更新",
  });
}

export async function settingsAction({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  });
  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }
  const formData = await request.formData();
  const action = formData.get("_action");
  switch (action) {
    case "rotateIngestionSecret":
      return handleRotateIngestionSecret(shop.id, session.shop, admin);
    case "updatePrivacySettings":
      return handleUpdatePrivacySettings(formData, shop.id, session.shop);
    case "switchEnvironment": {
      const { checkV1FeatureBoundary } = await import("../../utils/version-gate");
      const gateResult = checkV1FeatureBoundary("server_side");
      if (!gateResult.allowed) {
        return json({ error: gateResult.reason || "此功能在当前版本中不可用" }, { status: 403 });
      }
      const platform = formData.get("platform") as string;
      const newEnvironment = formData.get("environment") as PixelEnvironment;
      if (!platform || !newEnvironment) {
        return json({
          success: false,
          error: "缺少 platform 或 environment 参数"
        }, { status: 400 });
      }
      if (!["test", "live"].includes(newEnvironment)) {
        return json({
          success: false,
          error: "无效的环境参数"
        }, { status: 400 });
      }
      const result = await switchEnvironment(shop.id, platform, newEnvironment);
      if (result.success) {
        try {
          const shopData = await prisma.shop.findUnique({
            where: { id: shop.id },
            select: { webPixelId: true, ingestionSecret: true, shopDomain: true },
          });
          if (shopData?.webPixelId) {
            const { decryptIngestionSecret } = await import("../../utils/token-encryption.server");
            const ingestionKey = shopData.ingestionSecret
              ? decryptIngestionSecret(shopData.ingestionSecret)
              : undefined;
            await updateWebPixel(
              admin,
              shopData.webPixelId,
              ingestionKey,
              shopData.shopDomain || session.shop,
              newEnvironment
            );
          }
        } catch (syncError) {
          logger.warn("Failed to sync environment to pixel settings", {
            shopId: shop.id,
            platform,
            environment: newEnvironment,
            error: syncError instanceof Error ? syncError.message : String(syncError),
          });
        }
        await invalidateAllShopCaches(session.shop, shop.id);
      }
      return json({
        success: result.success,
        message: result.message,
        previousEnvironment: result.previousEnvironment,
        newEnvironment: result.newEnvironment,
      });
    }
    case "rollbackEnvironment": {
      const { checkV1FeatureBoundary } = await import("../../utils/version-gate");
      const gateResult = checkV1FeatureBoundary("server_side");
      if (!gateResult.allowed) {
        return json({ error: gateResult.reason || "此功能在当前版本中不可用" }, { status: 403 });
      }
      const platform = formData.get("platform") as string;
      if (!platform) {
        return json({
          success: false,
          error: "缺少 platform 参数"
        }, { status: 400 });
      }
      const result = await rollbackConfig(shop.id, platform);
      if (result.success) {
        await invalidateAllShopCaches(session.shop, shop.id);
      }
      return json({
        success: result.success,
        message: result.message,
        previousVersion: result.previousVersion,
        currentVersion: result.currentVersion,
      });
    }
    default:
      return json({ error: "Unknown action" }, { status: 400 });
  }
}
