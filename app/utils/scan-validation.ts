import { containsSensitiveInfo } from "./security";
import type { ShopTier } from "./deprecation-dates";

export type FetcherResult = {
    success?: boolean;
    message?: string;
    error?: string;
    details?: {
        message?: string;
        [key: string]: unknown;
    };
};

export function isFetcherResult(data: unknown): data is FetcherResult {
    return (
        typeof data === "object" &&
        data !== null &&
        ("success" in data || "error" in data || "message" in data)
    );
}

export function parseDateSafely(dateValue: unknown): Date | null {
    if (!dateValue) return null;
    try {
        const parsed = new Date(dateValue as string);
        return !isNaN(parsed.getTime()) ? parsed : null;
    } catch {
        return null;
    }
}

export function checkSensitiveInfoInData(obj: unknown, depth: number = 0): boolean {
    if (depth > 10) return false;
    if (typeof obj === "string") {
        return containsSensitiveInfo(obj);
    }
    if (Array.isArray(obj)) {
        return obj.some(item => checkSensitiveInfoInData(item, depth + 1));
    }
    if (obj && typeof obj === "object") {
        return Object.values(obj).some(value => checkSensitiveInfoInData(value, depth + 1));
    }
    return false;
}

export function isValidShopTier(tier: unknown): tier is ShopTier {
    return typeof tier === "string" &&
           (tier === "plus" || tier === "non_plus" || tier === "unknown");
}
