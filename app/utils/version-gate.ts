
/**
 * P0-5: v1.0 功能边界检查
 * 
 * 用于确保 v1.0 版本不会包含超出范围的功能。
 * 根据 v1.0 PRD，以下功能应该在 v1.1+ 版本才提供：
 * - Server-side conversion API（已在 v1.0 中实现，但通过 entitlement 控制）
 * - UpsellOffer UI 模块（应在 v1.1+）
 * - 第三方物流集成（AfterShip/17Track，应在 v2.0+）
 */

const APP_VERSION = "1.0";

export interface VersionGateResult {
  allowed: boolean;
  reason?: string;
  requiredVersion?: string;
}

/**
 * 检查功能是否在 v1.0 版本中可用
 */
export function checkV1FeatureBoundary(
  feature: "server_side" | "upsell" | "shipping_tracking_third_party"
): VersionGateResult {
  switch (feature) {
    case "server_side":
      // Server-side conversion API 在 v1.0 中通过 entitlement 控制，允许使用
      return { allowed: true };
      
    case "upsell":
      // UpsellOffer UI 模块在 v1.0 PRD 中不在范围，应在 v1.1+ 提供
      return {
        allowed: false,
        reason: "UpsellOffer 模块在 v1.0 版本中不可用，将在 v1.1+ 版本中提供",
        requiredVersion: "1.1",
      };
      
    case "shipping_tracking_third_party":
      // 第三方物流集成（AfterShip/17Track）在 v1.0 PRD 中不在范围，应在 v2.0+ 提供
      return {
        allowed: false,
        reason: "第三方物流集成（AfterShip/17Track）在 v1.0 版本中不可用，将在 v2.0+ 版本中提供",
        requiredVersion: "2.0",
      };
      
    default:
      return { allowed: true };
  }
}

/**
 * 检查模块是否在 v1.0 版本中可用
 */
export function isModuleAvailableInV1(moduleKey: string): boolean {
  // v1.0 可用的 UI 模块：survey, reorder, support, order_tracking (native only)
  // v1.0 不可用的模块：upsell
  const v1AvailableModules = ["survey", "reorder", "helpdesk", "order_tracking"];
  
  // order_tracking 在 v1.0 中只支持 native（Shopify 原生），不支持第三方集成
  if (moduleKey === "order_tracking") {
    return true; // 模块本身可用，但第三方集成需要通过其他方式限制
  }
  
  return v1AvailableModules.includes(moduleKey);
}

/**
 * 检查是否可以使用第三方物流追踪服务
 */
export function canUseThirdPartyTracking(provider: "native" | "aftership" | "17track"): VersionGateResult {
  if (provider === "native") {
    return { allowed: true };
  }
  
  // v1.0 不支持第三方物流追踪
  return checkV1FeatureBoundary("shipping_tracking_third_party");
}

