/**
 * Scan Module
 *
 * Handles script scanning and analysis:
 * - ScriptTag detection
 * - WebPixel discovery
 * - Additional Scripts analysis
 * - Platform identification
 * - Risk assessment
 *
 * P2-1: Centralized scanning and migration guidance.
 */

// Re-export from scanner services
export {
  scanShopTracking,
  getScanHistory,
  analyzeScriptContent,
  type WebPixelInfo,
  type EnhancedScanResult,
  type MigrationAction,
  type ScriptAnalysisResult,
  type ScanResult,
  type RiskItem,
} from "../../services/scanner.server";

// Content analysis utilities
export {
  analyzeScriptContent as analyzeScript,
} from "../../services/scanner/content-analysis";

// Risk assessment
export {
  assessRisks,
  calculateRiskScore,
} from "../../services/scanner/risk-assessment";

// Migration actions
export {
  generateMigrationActions,
} from "../../services/scanner/migration-actions";

// Scanner types
export type {
  ScanError,
  GraphQLEdge,
  GraphQLPageInfo,
} from "../../services/scanner/types";

// Pattern matching
export {
  PLATFORM_PATTERNS,
  detectPlatforms,
} from "../../services/scanner/patterns";

