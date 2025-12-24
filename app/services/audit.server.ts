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
  batchCreateAuditLogs as createAuditLogsBatch,
  getAuditLogsForShop,
  getAuditLogById,
  cleanupOldAuditLogs,
  countAuditLogsByAction,
  extractRequestContext,
  // Legacy compatibility
  auditLog,
  createAuditLog,
} from "./db/audit-repository.server";
