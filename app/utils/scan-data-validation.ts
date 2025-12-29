/**
 * 扫描数据验证工具
 * 提供类型安全的运行时验证函数，用于验证从数据库或 API 获取的数据
 */

import type { ScriptTag, RiskItem } from "../types";

/**
 * 验证单个 ScriptTag 是否为有效结构
 * 严格验证：要求 id 为正整数，src 不为空
 */
export function isValidScriptTag(tag: unknown): tag is ScriptTag {
    if (typeof tag !== "object" || tag === null) {
        return false;
    }
    const t = tag as Record<string, unknown>;
    return (
        typeof t.id === "number" &&
        !isNaN(t.id) &&
        isFinite(t.id) &&
        t.id > 0 && // 确保 id 是正整数
        (typeof t.gid === "string" || t.gid === null || t.gid === undefined) &&
        typeof t.src === "string" &&
        t.src.length > 0 && // 确保 src 不为空
        (typeof t.display_scope === "string" || t.display_scope === undefined)
    );
}

/**
 * 验证并过滤 ScriptTag 数组
 * @param tags - 待验证的数据
 * @returns 验证通过的 ScriptTag 数组
 */
export function validateScriptTagsArray(tags: unknown): ScriptTag[] {
    if (!Array.isArray(tags)) {
        return [];
    }
    return tags.filter(isValidScriptTag);
}

/**
 * 验证单个 RiskItem 是否为有效结构
 */
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

/**
 * 验证并过滤 RiskItem 数组
 * @param items - 待验证的数据
 * @returns 验证通过的 RiskItem 数组
 */
export function validateRiskItemsArray(items: unknown): RiskItem[] {
    if (!Array.isArray(items)) {
        return [];
    }
    return items.filter(isValidRiskItem);
}

/**
 * 验证字符串数组
 * @param arr - 待验证的数据
 * @returns 验证通过的字符串数组
 */
export function validateStringArray(arr: unknown): string[] {
    if (!Array.isArray(arr)) {
        return [];
    }
    return arr.filter((item): item is string => typeof item === "string");
}

/**
 * 验证风险评分
 * @param score - 待验证的分数
 * @returns 有效的风险评分（0-100），无效时返回 0
 */
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

/**
 * 验证平台详情模式数组
 */
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

/**
 * 安全解析日期值
 * Remix json() 会将 Date 序列化为字符串，需要安全转换
 * @param dateValue - 可能是 Date、string、number 或 unknown 类型的日期值
 * @returns 有效的 Date 对象，无效时返回当前时间
 */
export function safeParseDate(dateValue: unknown): Date {
    if (dateValue instanceof Date) {
        // 检查日期是否有效
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

/**
 * 安全格式化日期为本地字符串
 * @param dateValue - 可能是 Date、string、number 或 unknown 类型的日期值
 * @param locale - 区域设置，默认为 "zh-CN"
 * @returns 格式化后的日期字符串
 */
export function safeFormatDate(dateValue: unknown, locale: string = "zh-CN"): string {
    const date = safeParseDate(dateValue);
    return date.toLocaleString(locale);
}

