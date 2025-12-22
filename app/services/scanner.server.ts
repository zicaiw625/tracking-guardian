/**
 * Scanner Service
 * 
 * This module provides tracking script scanning and analysis functionality.
 * The implementation has been refactored into separate modules for better maintainability:
 * 
 * - scanner/types.ts - Type definitions
 * - scanner/patterns.ts - Platform detection patterns
 * - scanner/risk-assessment.ts - Risk assessment logic
 * - scanner/migration-actions.ts - Migration action generation
 * - scanner/content-analysis.ts - Script content analysis
 * - scanner/index.ts - Main entry point
 * 
 * This file re-exports the public API for backwards compatibility.
 */

// Re-export everything from the scanner module
export {
    scanShopTracking,
    getScanHistory,
    analyzeScriptContent,
} from "./scanner/index";

export type {
    WebPixelInfo,
    EnhancedScanResult,
    MigrationAction,
    ScriptAnalysisResult,
    ScanResult,
    RiskItem,
} from "./scanner/index";
