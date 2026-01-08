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

export {
  analyzeScriptContent as analyzeScript,
} from "../../services/scanner/content-analysis";

export {
  assessRisks,
  calculateRiskScore,
} from "../../services/scanner/risk-assessment";

export {
  generateMigrationActions,
} from "../../services/scanner/migration-actions";

export type {
  ScanError,
  GraphQLEdge,
  GraphQLPageInfo,
} from "../../services/scanner/types";

export {
  PLATFORM_PATTERNS,
  detectPlatforms,
} from "../../services/scanner/patterns";
