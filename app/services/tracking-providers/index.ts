/**
 * 物流追踪服务提供商模块入口
 *
 * 使用方法：
 *
 * ```typescript
 * import { getTrackingProvider, initializeProvider } from "~/services/tracking-providers";
 *
 * // 初始化提供商
 * await initializeProvider("aftership", { apiKey: "your-api-key" });
 *
 * // 获取追踪信息
 * const provider = getTrackingProvider("aftership");
 * const result = await provider.getTracking("1234567890");
 * ```
 */

export * from "./types";
export * from "./aftership";

import type { ITrackingProvider, TrackingProviderCredentials } from "./types";
import { AfterShipProvider } from "./aftership";

// ============================================================
// Provider Registry
// ============================================================

type ProviderCode = "aftership" | "track17" | "shipstation";

const providers: Map<ProviderCode, ITrackingProvider> = new Map();

// 注册可用的提供商
const providerClasses: Record<ProviderCode, new () => ITrackingProvider> = {
  aftership: AfterShipProvider,
  // 以下为占位符，后续可以添加更多提供商
  track17: AfterShipProvider, // TODO: 实现 Track17Provider
  shipstation: AfterShipProvider, // TODO: 实现 ShipStationProvider
};

/**
 * 初始化追踪服务提供商
 */
export async function initializeProvider(
  code: ProviderCode,
  credentials: TrackingProviderCredentials
): Promise<ITrackingProvider> {
  const ProviderClass = providerClasses[code];
  if (!ProviderClass) {
    throw new Error(`Unknown tracking provider: ${code}`);
  }

  const provider = new ProviderClass();
  await provider.initialize(credentials);
  providers.set(code, provider);

  return provider;
}

/**
 * 获取已初始化的提供商
 */
export function getTrackingProvider(code: ProviderCode): ITrackingProvider | null {
  return providers.get(code) || null;
}

/**
 * 获取所有已初始化的提供商
 */
export function getAllProviders(): Map<ProviderCode, ITrackingProvider> {
  return providers;
}

/**
 * 获取支持的提供商列表
 */
export function getSupportedProviders(): Array<{ code: ProviderCode; name: string }> {
  return [
    { code: "aftership", name: "AfterShip" },
    { code: "track17", name: "17Track" },
    { code: "shipstation", name: "ShipStation" },
  ];
}

