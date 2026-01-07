

const APP_VERSION = "1.0";

export interface VersionGateResult {
  allowed: boolean;
  reason?: string;
  requiredVersion?: string;
}

export function checkV1FeatureBoundary(
  feature: "server_side" | "upsell" | "shipping_tracking_third_party"
): VersionGateResult {
  switch (feature) {
    case "server_side":

      return { allowed: true };

    case "upsell":

      return {
        allowed: false,
        reason: "UpsellOffer 模块在 v1.0 版本中不可用，将在 v1.1+ 版本中提供",
        requiredVersion: "1.1",
      };

    case "shipping_tracking_third_party":

      return {
        allowed: false,
        reason: "第三方物流集成（AfterShip/17Track）在 v1.0 版本中不可用，将在 v2.0+ 版本中提供",
        requiredVersion: "2.0",
      };

    default:
      return { allowed: true };
  }
}

export function isModuleAvailableInV1(moduleKey: string): boolean {

  const v1AvailableModules = ["survey", "reorder", "helpdesk", "order_tracking"];

  if (moduleKey === "order_tracking") {
    return true;
  }

  return v1AvailableModules.includes(moduleKey);
}

export function canUseThirdPartyTracking(provider: "native" | "aftership" | "17track"): VersionGateResult {
  if (provider === "native") {
    return { allowed: true };
  }

  return checkV1FeatureBoundary("shipping_tracking_third_party");
}

