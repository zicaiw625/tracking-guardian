/**
 * Audit Repository
 *
 * Centralized data access layer for AuditLog entities.
 * Provides type-safe audit logging operations.
 */

import prisma from "../../db.server";
import { Prisma } from "@prisma/client";
import { logger } from "../../utils/logger.server";

// =============================================================================
// Types
// =============================================================================

export type ActorType = "user" | "webhook" | "cron" | "api" | "system";

export type AuditAction =
  | "token_updated"
  | "token_deleted"
  | "pixel_config_created"
  | "pixel_config_updated"
  | "pixel_config_deleted"
  | "alert_config_created"
  | "alert_config_updated"
  | "alert_config_deleted"
  | "threshold_changed"
  | "shop_settings_updated"
  | "web_pixel_created"
  | "web_pixel_updated"
  | "script_tag_deleted"
  | "conversion_retry_manual"
  | "dead_letter_retry"
  | "ingestion_secret_rotated"
  | "privacy_settings_updated"
  | "subscription_created"
  | "subscription_cancelled"
  | "subscription_activated"
  | "data_cleanup_completed"
  | "security_signature_invalid"
  | "security_signature_missing"
  | "security_replay_attack"
  | "security_rate_limit_exceeded"
  | "security_invalid_origin"
  | "security_jwt_validation_failed"
  | "security_shop_mismatch"
  | "capi_send_success"
  | "capi_send_failed"
  | "capi_retry_scheduled"
  | "capi_dead_lettered"
  | "gdpr_customer_redact";

export type ResourceType =
  | "pixel_config"
  | "alert_config"
  | "shop"
  | "web_pixel"
  | "script_tag"
  | "conversion_log"
  | "billing"
  | "pixel_event"
  | "survey"
  | "api_request"
  | "customer";

/**
 * Audit log entry input.
 */
export interface AuditLogEntry {
  actorType: ActorType;
  actorId?: string;
  action: AuditAction;
  resourceType: ResourceType;
  resourceId?: string;
  previousValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Query options for fetching audit logs.
 */
export interface AuditLogQueryOptions {
  limit?: number;
  action?: AuditAction;
  resourceType?: ResourceType;
  fromDate?: Date;
  toDate?: Date;
}

/**
 * Audit log summary entry.
 */
export interface AuditLogSummary {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  createdAt: Date;
}

/**
 * Full audit log entry.
 */
export interface AuditLogFull extends AuditLogSummary {
  shopId: string;
  previousValue: unknown;
  newValue: unknown;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
}

// =============================================================================
// Constants
// =============================================================================

const SENSITIVE_FIELDS = [
  "accessToken",
  "access_token",
  "apiSecret",
  "api_secret",
  "password",
  "token",
  "secret",
  "credentials",
  "credentialsEncrypted",
];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Redact sensitive fields from an object for safe logging.
 */
function redactSensitiveFields(
  obj: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!obj) return obj;

  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    if (SENSITIVE_FIELDS.some((f) => lowerKey.includes(f.toLowerCase()))) {
      redacted[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      redacted[key] = redactSensitiveFields(value as Record<string, unknown>);
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

/**
 * Extract request context for audit logging.
 */
export function extractRequestContext(request: Request): {
  ipAddress?: string;
  userAgent?: string;
} {
  return {
    ipAddress:
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      undefined,
    userAgent: request.headers.get("user-agent") || undefined,
  };
}

// =============================================================================
// Repository Functions
// =============================================================================

/**
 * Create an audit log entry.
 */
export async function createAuditLogEntry(
  shopId: string,
  entry: AuditLogEntry
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        shopId,
        actorType: entry.actorType,
        actorId: entry.actorId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        previousValue: redactSensitiveFields(entry.previousValue) as Prisma.InputJsonValue | undefined,
        newValue: redactSensitiveFields(entry.newValue) as Prisma.InputJsonValue | undefined,
        metadata: entry.metadata as Prisma.InputJsonValue | undefined,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
      },
    });

    logger.debug(`Audit log: ${entry.action} on ${entry.resourceType}`, {
      shopId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
    });
  } catch (error) {
    logger.error("Failed to write audit log", error, {
      shopId,
      action: entry.action,
    });
  }
}

/**
 * Batch create multiple audit log entries.
 */
export async function batchCreateAuditLogs(
  entries: Array<AuditLogEntry & { shopId: string }>
): Promise<number> {
  if (entries.length === 0) return 0;

  try {
    const result = await prisma.auditLog.createMany({
      data: entries.map((entry) => ({
        shopId: entry.shopId,
        actorType: entry.actorType,
        actorId: entry.actorId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        previousValue: redactSensitiveFields(entry.previousValue) as Prisma.InputJsonValue | undefined,
        newValue: redactSensitiveFields(entry.newValue) as Prisma.InputJsonValue | undefined,
        metadata: entry.metadata as Prisma.InputJsonValue | undefined,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
      })),
    });

    logger.debug(`Batch created ${result.count} audit log entries`);
    return result.count;
  } catch (error) {
    logger.error("Failed to batch create audit logs", error);
    return 0;
  }
}

/**
 * Get audit logs for a shop.
 */
export async function getAuditLogsForShop(
  shopId: string,
  options: AuditLogQueryOptions = {}
): Promise<AuditLogSummary[]> {
  const { limit = 100, action, resourceType, fromDate, toDate } = options;

  return prisma.auditLog.findMany({
    where: {
      shopId,
      ...(action && { action }),
      ...(resourceType && { resourceType }),
      ...(fromDate || toDate
        ? {
            createdAt: {
              ...(fromDate && { gte: fromDate }),
              ...(toDate && { lte: toDate }),
            },
          }
        : {}),
    },
    select: {
      id: true,
      actorType: true,
      actorId: true,
      action: true,
      resourceType: true,
      resourceId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * Get a single audit log entry by ID.
 */
export async function getAuditLogById(id: string): Promise<AuditLogFull | null> {
  return prisma.auditLog.findUnique({
    where: { id },
  });
}

/**
 * Cleanup old audit log entries.
 */
export async function cleanupOldAuditLogs(retentionDays = 90): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const result = await prisma.auditLog.deleteMany({
    where: {
      createdAt: { lt: cutoffDate },
    },
  });

  logger.info(`Cleaned up ${result.count} audit log entries older than ${retentionDays} days`);
  return result.count;
}

/**
 * Count audit logs by action type for a shop.
 */
export async function countAuditLogsByAction(
  shopId: string,
  fromDate?: Date
): Promise<Record<string, number>> {
  const results = await prisma.auditLog.groupBy({
    by: ["action"],
    where: {
      shopId,
      ...(fromDate && { createdAt: { gte: fromDate } }),
    },
    _count: true,
  });

  return results.reduce(
    (acc, { action, _count }) => {
      acc[action] = _count;
      return acc;
    },
    {} as Record<string, number>
  );
}

// =============================================================================
// Legacy Compatibility (auditLog object for existing code)
// =============================================================================

export const auditLog = {
  record: createAuditLogEntry,
  getForShop: getAuditLogsForShop,
  getEntry: getAuditLogById,
  cleanup: cleanupOldAuditLogs,
};

/**
 * Convenience function matching existing interface.
 */
export async function createAuditLog(
  entry: AuditLogEntry & { shopId: string }
): Promise<void> {
  const { shopId, ...logEntry } = entry;
  return createAuditLogEntry(shopId, logEntry);
}

