

import type { ScriptTag, RiskItem } from "../types";

export function isValidScriptTag(tag: unknown): tag is ScriptTag {
    if (typeof tag !== "object" || tag === null) {
        return false;
    }
    const t = tag as Record<string, unknown>;
    return (
        typeof t.id === "number" &&
        !isNaN(t.id) &&
        isFinite(t.id) &&
        t.id > 0 &&
        (typeof t.gid === "string" || t.gid === null || t.gid === undefined) &&
        typeof t.src === "string" &&
        t.src.length > 0 &&
        (typeof t.display_scope === "string" || t.display_scope === undefined)
    );
}

export function validateScriptTagsArray(tags: unknown): ScriptTag[] {
    if (!Array.isArray(tags)) {
        return [];
    }
    return tags.filter(isValidScriptTag);
}

export function isValidRiskItem(item: unknown): item is RiskItem {
    if (typeof item !== "object" || item === null) {
        return false;
    }
    const r = item as Record<string, unknown>;
    return (
        typeof r.id === "string" &&
        typeof r.name === "string" &&
        typeof r.description === "string" &&
        (r.severity === "high" || r.severity === "medium" || r.severity === "low")
    );
}

export function validateRiskItemsArray(items: unknown): RiskItem[] {
    if (!Array.isArray(items)) {
        return [];
    }
    return items.filter(isValidRiskItem);
}

export function validateStringArray(arr: unknown): string[] {
    if (!Array.isArray(arr)) {
        return [];
    }
    return arr.filter((item): item is string => typeof item === "string");
}

export function validateRiskScore(score: unknown): number {
    if (
        typeof score === "number" &&
        !isNaN(score) &&
        isFinite(score) &&
        score >= 0 &&
        score <= 100
    ) {
        return score;
    }
    return 0;
}

export function validateAdditionalScriptsPatterns(
    patterns: unknown
): Array<{ platform: string; content: string }> {
    if (!Array.isArray(patterns)) {
        return [];
    }
    return patterns.filter((p: unknown): p is { platform: string; content: string } => {
        if (typeof p !== "object" || p === null) {
            return false;
        }
        const pattern = p as Record<string, unknown>;
        return (
            typeof pattern.platform === "string" &&
            typeof pattern.content === "string"
        );
    });
}

export function safeParseDate(dateValue: unknown): Date {
    if (dateValue instanceof Date) {

        if (!isNaN(dateValue.getTime())) {
            return dateValue;
        }
        console.warn("Invalid Date object, using current date");
        return new Date();
    }

    if (typeof dateValue === "string") {
        const date = new Date(dateValue);
        if (!isNaN(date.getTime())) {
            return date;
        }
        console.warn("Invalid date string, using current date:", dateValue);
        return new Date();
    }

    if (typeof dateValue === "number") {
        const date = new Date(dateValue);
        if (!isNaN(date.getTime())) {
            return date;
        }
        console.warn("Invalid date number, using current date:", dateValue);
        return new Date();
    }

    console.warn("Unexpected date type, using current date:", typeof dateValue, dateValue);
    return new Date();
}

export function safeFormatDate(dateValue: unknown, locale: string = "zh-CN"): string {
    const date = safeParseDate(dateValue);
    return date.toLocaleString(locale);
}

