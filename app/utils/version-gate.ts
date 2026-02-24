// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
      return {
        allowed: false,
        reason: "Server-side delivery is disabled by default in the current version (planned).",
      };
    case "upsell":
      return {
        allowed: false,
        reason: "The UpsellOffer module is not available in v1.0 and will be available in v1.1+.",
        requiredVersion: "1.1",
      };
    case "shipping_tracking_third_party":
      return {
        allowed: false,
        reason: "Third-party shipping tracking integrations (AfterShip/17Track) are not available in v1.0 and will be available in v2.0+.",
        requiredVersion: "2.0",
      };
    default:
      return { allowed: true };
  }
}

export function isModuleAvailableInV1(moduleKey: string): boolean {
  const v1AvailableModules: string[] = [];
  return v1AvailableModules.includes(moduleKey);
}

export function canUseThirdPartyTracking(provider: "native" | "aftership" | "17track"): VersionGateResult {
  if (provider === "native") {
    return { allowed: true };
  }
  return checkV1FeatureBoundary("shipping_tracking_third_party");
}
