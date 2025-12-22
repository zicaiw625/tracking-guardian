// Scanner types

export interface WebPixelInfo {
    id: string;
    settings: string | null;
}

export interface MigrationAction {
    type: "delete_script_tag" | "configure_pixel" | "remove_duplicate" | "enable_capi";
    priority: "high" | "medium" | "low";
    platform?: string;
    title: string;
    description: string;
    scriptTagId?: number;
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

// Re-export types from main types module
export type { ScanResult, RiskItem, RiskSeverity, ScriptTag, CheckoutConfig } from "../../types";

export interface EnhancedScanResult extends import("../../types").ScanResult {
    webPixels: WebPixelInfo[];
    duplicatePixels: Array<{
        platform: string;
        count: number;
        ids: string[];
    }>;
    migrationActions: MigrationAction[];
}

