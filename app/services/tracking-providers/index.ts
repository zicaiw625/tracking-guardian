export * from "./types";
export * from "./aftership";

import type { ITrackingProvider, TrackingProviderCredentials } from "./types";
import { AfterShipProvider } from "./aftership";

type ProviderCode = "aftership" | "track17" | "shipstation";

const providers: Map<ProviderCode, ITrackingProvider> = new Map();

const providerClasses: Record<ProviderCode, new () => ITrackingProvider> = {
  aftership: AfterShipProvider,

  track17: AfterShipProvider,
  shipstation: AfterShipProvider,
};

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

export function getTrackingProvider(code: ProviderCode): ITrackingProvider | null {
  return providers.get(code) || null;
}

export function getAllProviders(): Map<ProviderCode, ITrackingProvider> {
  return providers;
}

export function getSupportedProviders(): Array<{ code: ProviderCode; name: string }> {
  return [
    { code: "aftership", name: "AfterShip" },
    { code: "track17", name: "17Track" },
    { code: "shipstation", name: "ShipStation" },
  ];
}
