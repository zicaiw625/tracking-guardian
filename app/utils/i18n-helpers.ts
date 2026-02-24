import type { TFunction } from "i18next";

export const getT = (t: TFunction | undefined, key: string, options?: any, fallback?: string): string => {
  if (t) return t(key, options) as unknown as string;
  return fallback || key;
};
