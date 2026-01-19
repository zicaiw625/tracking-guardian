import { randomUUID } from "crypto";
import prisma from "../../db.server";
import { Prisma } from "@prisma/client";
import { logger } from "../../utils/logger.server";

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
  | "gdpr_customer_redact"
  | "one_time_purchase_created"
  | "one_time_purchase_activated";

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

export interface AuditLogEntry {
  actorType: ActorType;
  actorId?: string;
  action: AuditAction;
  resourceType: ResourceType;
  resourceId?: string;
  previousValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface AuditLogQueryOptions {
  limit?: number;
  action?: AuditAction;
  resourceType?: ResourceType;
  fromDate?: Date;
  toDate?: Date;
}

export interface AuditLogSummary {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  createdAt: Date;
}

export interface AuditLogFull extends AuditLogSummary {
  shopId: string;
  previousValue: unknown;
  newValue: unknown;
  metadata: unknown;
}

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

export function extractRequestContext(request: Request): Record<string, never> {
  return {};
}

export async function createAuditLogEntry(
  shopId: string,
  entry: AuditLogEntry
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        id: randomUUID(),
        shopId,
        actorType: entry.actorType,
        actorId: entry.actorId || null,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId || null,
        previousValue: (entry.previousValue ? (redactSensitiveFields(entry.previousValue) as Prisma.JsonValue) : Prisma.JsonNull) as Prisma.InputJsonValue,
        newValue: (entry.newValue ? (redactSensitiveFields(entry.newValue) as Prisma.JsonValue) : Prisma.JsonNull) as Prisma.InputJsonValue,
        metadata: (entry.metadata != null ? (entry.metadata as Prisma.JsonValue) : Prisma.JsonNull) as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    logger.error("Failed to create audit log entry", {
      shopId,
      action: entry.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function batchCreateAuditLogs(
  entries: Array<AuditLogEntry & { shopId: string }>
): Promise<number> {
  if (entries.length === 0) return 0;
  try {
    const data = entries.map(entry => ({
      id: randomUUID(),
      shopId: entry.shopId,
      actorType: entry.actorType,
      actorId: entry.actorId || null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId || null,
      previousValue: (entry.previousValue ? (redactSensitiveFields(entry.previousValue) as Prisma.JsonValue) : Prisma.JsonNull) as Prisma.InputJsonValue,
      newValue: (entry.newValue ? (redactSensitiveFields(entry.newValue) as Prisma.JsonValue) : Prisma.JsonNull) as Prisma.InputJsonValue,
      metadata: (entry.metadata != null ? (entry.metadata as Prisma.JsonValue) : Prisma.JsonNull) as Prisma.InputJsonValue,
    }));
    await prisma.auditLog.createMany({
      data,
      skipDuplicates: true,
    });
    return entries.length;
  } catch (error) {
    logger.error("Failed to batch create audit logs", {
      count: entries.length,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

export async function getAuditLogsForShop(
  shopId: string,
  options: AuditLogQueryOptions = {}
): Promise<AuditLogSummary[]> {
  try {
    const where: Prisma.AuditLogWhereInput = {
      shopId,
    };
    if (options.action) {
      where.action = options.action;
    }
    if (options.resourceType) {
      where.resourceType = options.resourceType;
    }
    if (options.fromDate || options.toDate) {
      where.createdAt = {};
      if (options.fromDate) {
        where.createdAt.gte = options.fromDate;
      }
      if (options.toDate) {
        where.createdAt.lte = options.toDate;
      }
    }
    const logs = await prisma.auditLog.findMany({
      where,
      take: options.limit || 100,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        actorType: true,
        actorId: true,
        action: true,
        resourceType: true,
        resourceId: true,
        createdAt: true,
      },
    });
    return logs.map(log => ({
      id: log.id,
      actorType: log.actorType,
      actorId: log.actorId,
      action: log.action,
      resourceType: log.resourceType,
      resourceId: log.resourceId,
      createdAt: log.createdAt,
    }));
  } catch (error) {
    logger.error("Failed to get audit logs for shop", {
      shopId,
      options,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function getAuditLogById(id: string): Promise<AuditLogFull | null> {
  try {
    const log = await prisma.auditLog.findUnique({
      where: { id },
    });
    if (!log) {
      return null;
    }
    return {
      id: log.id,
      shopId: log.shopId,
      actorType: log.actorType,
      actorId: log.actorId,
      action: log.action,
      resourceType: log.resourceType,
      resourceId: log.resourceId,
      previousValue: log.previousValue,
      newValue: log.newValue,
      metadata: log.metadata,
      createdAt: log.createdAt,
    };
  } catch (error) {
    logger.error("Failed to get audit log by id", {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function cleanupOldAuditLogs(retentionDays = 90): Promise<number> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const result = await prisma.auditLog.deleteMany({
      where: {
        createdAt: {
          lt: cutoffDate,
        },
      },
    });
    return result.count;
  } catch (error) {
    logger.error("Failed to cleanup old audit logs", {
      retentionDays,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

export async function countAuditLogsByAction(
  shopId: string,
  fromDate?: Date
): Promise<Record<string, number>> {
  try {
    const where: Prisma.AuditLogWhereInput = {
      shopId,
    };
    if (fromDate) {
      where.createdAt = {
        gte: fromDate,
      };
    }
    const logs = await prisma.auditLog.groupBy({
      by: ["action"],
      where,
      _count: true,
    });
    const counts: Record<string, number> = {};
    for (const group of logs) {
      counts[group.action] = group._count;
    }
    return counts;
  } catch (error) {
    logger.error("Failed to count audit logs by action", {
      shopId,
      fromDate,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

export const auditLog = {
  record: createAuditLogEntry,
  getForShop: getAuditLogsForShop,
  getEntry: getAuditLogById,
  cleanup: cleanupOldAuditLogs,
};

export async function createAuditLog(
  entry: AuditLogEntry & { shopId: string }
): Promise<void> {
  const { shopId, ...logEntry } = entry;
  return createAuditLogEntry(shopId, logEntry);
}
