import type { ConsentState } from "./types";

export function normalizeConsentState(consent: unknown): ConsentState | null {
  if (!consent || typeof consent !== "object") {
    return null;
  }
  const data = consent as Record<string, unknown>;
  const saleOfDataAllowed = data.saleOfDataAllowed !== undefined
    ? (typeof data.saleOfDataAllowed === "boolean" ? data.saleOfDataAllowed : undefined)
    : (typeof data.saleOfData === "boolean" ? data.saleOfData : undefined);
  return {
    marketing: typeof data.marketing === "boolean" ? data.marketing : undefined,
    analytics: typeof data.analytics === "boolean" ? data.analytics : undefined,
    saleOfDataAllowed,
  };
}
