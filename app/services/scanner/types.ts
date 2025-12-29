

export interface WebPixelInfo {
    id: string;
    settings: string | null;
}

export interface MigrationAction {

    type: "migrate_script_tag" | "configure_pixel" | "remove_duplicate" | "enable_capi";
    priority: "high" | "medium" | "low";
    platform?: string;
    title: string;
    description: string;

    scriptTagId?: number;

    webPixelGid?: string;
    deadline?: string;
}

export interface ScanError {
    stage: string;
    message: string;
    timestamp: Date;
}

export interface GraphQLEdge<T> {
    node: T;
    cursor: string;
}

export interface GraphQLPageInfo {
    hasNextPage: boolean;
    endCursor: string | null;
}

export interface ScriptAnalysisResult {
    identifiedPlatforms: string[];
    platformDetails: Array<{
        platform: string;
        type: string;
        confidence: "high" | "medium" | "low";
        matchedPattern: string;
    }>;
    risks: import("../../types").RiskItem[];
    riskScore: number;
    recommendations: string[];
}

export type { ScanResult, RiskItem, RiskSeverity, ScriptTag, CheckoutConfig } from "../../types";

import type { ScanResult } from "../../types";

export interface EnhancedScanResult extends ScanResult {
    webPixels: WebPixelInfo[];
    duplicatePixels: Array<{
        platform: string;
        count: number;
        ids: string[];
    }>;
    migrationActions: MigrationAction[];
    /**
     * 标记是否为部分刷新（缓存刷新失败时设置）
     * 当为 true 时，webPixels、duplicatePixels 和 migrationActions 可能不完整或过时
     */
    _partialRefresh?: boolean;
    /**
     * 标记 AuditAsset 同步是否失败
     * 当为 true 时，表示扫描结果未能成功同步到 AuditAsset 表
     */
    _auditAssetSyncFailed?: boolean;
}

