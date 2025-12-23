/**
 * Audit Service
 *
 * This module re-exports from the centralized audit repository.
 * For new code, prefer importing from ./db/audit-repository.server.ts directly.
 *
 * @deprecated Import from ./db/audit-repository.server.ts instead
 */

export {
  // Types
  type ActorType,
  type AuditAction,
  type ResourceType,
  type AuditLogEntry,
  type AuditLogQueryOptions,
  type AuditLogSummary,
  type AuditLogFull,
  // Functions
  createAuditLogEntry,
  batchCreateAuditLogs,
  getAuditLogsForShop,
  getAuditLogById,
  cleanupOldAuditLogs,
  countAuditLogsByAction,
  extractRequestContext,
  // Legacy compatibility
  auditLog,
  createAuditLog,
} from "./db/audit-repository.server";

// Re-export batch create with original name
export { batchCreateAuditLogs as createAuditLogsBatch } from "./db/audit-repository.server";
