export interface WebPixelInfo {
    id: string;
    settings: string | null;
}

export interface MigrationAction {
    type: "migrate_script_tag" | "configure_pixel" | "remove_duplicate" | "enable_capi";
    priority: "high" | "medium" | "low";
    platform?: string;
    title: string;
    titleKey?: string;
    titleParams?: Record<string, any>;
    description: string;
    descriptionKey?: string;
    descriptionParams?: Record<string, any>;
    scriptTagId?: number;
    webPixelGid?: string;
    deadline?: string;
    estimatedTimeMinutes?: number;
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
    _partialRefresh?: boolean;
    _auditAssetSyncFailed?: boolean;
    _cachedAt?: Date;
    _refreshRecommended?: boolean;
    _additionalScriptsNote?: string;
}
