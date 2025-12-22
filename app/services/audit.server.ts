import prisma from "../db.server";
import { Prisma } from "@prisma/client";
import { logger } from "../utils/logger";
export type ActorType = "user" | "webhook" | "cron" | "api" | "system";
export type AuditAction = "token_updated" | "token_deleted" | "pixel_config_created" | "pixel_config_updated" | "pixel_config_deleted" | "alert_config_created" | "alert_config_updated" | "alert_config_deleted" | "threshold_changed" | "shop_settings_updated" | "web_pixel_created" | "web_pixel_updated" | "script_tag_deleted" | "conversion_retry_manual" | "dead_letter_retry" | "ingestion_secret_rotated" | "privacy_settings_updated" | "subscription_created" | "subscription_cancelled" | "subscription_activated" | "data_cleanup_completed" | "security_signature_invalid" | "security_signature_missing" | "security_replay_attack" | "security_rate_limit_exceeded" | "security_invalid_origin" | "security_jwt_validation_failed" | "security_shop_mismatch" | "capi_send_success" | "capi_send_failed" | "capi_retry_scheduled" | "capi_dead_lettered" | "gdpr_customer_redact";
export type ResourceType = "pixel_config" | "alert_config" | "shop" | "web_pixel" | "script_tag" | "conversion_log" | "billing" | "pixel_event" | "survey" | "api_request" | "customer";
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
function redactSensitiveFields(obj: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!obj)
        return obj;
    const sensitiveFields = [
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
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase();
        if (sensitiveFields.some((f) => lowerKey.includes(f.toLowerCase()))) {
            redacted[key] = "[REDACTED]";
        }
        else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
            redacted[key] = redactSensitiveFields(value as Record<string, unknown>);
        }
        else {
            redacted[key] = value;
        }
    }
    return redacted;
}
export function extractRequestContext(request: Request): {
    ipAddress?: string;
    userAgent?: string;
} {
    return {
        ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            request.headers.get("x-real-ip") ||
            undefined,
        userAgent: request.headers.get("user-agent") || undefined,
    };
}
export const auditLog = {
    async record(shopId: string, entry: AuditLogEntry): Promise<void> {
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
        }
        catch (error) {
            logger.error("Failed to write audit log", error, {
                shopId,
                action: entry.action,
            });
        }
    },
    async getForShop(shopId: string, options?: {
        limit?: number;
        action?: AuditAction;
        resourceType?: ResourceType;
        fromDate?: Date;
        toDate?: Date;
    }): Promise<Array<{
        id: string;
        actorType: string;
        actorId: string | null;
        action: string;
        resourceType: string;
        resourceId: string | null;
        createdAt: Date;
    }>> {
        const { limit = 100, action, resourceType, fromDate, toDate } = options || {};
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
    },
    async getEntry(id: string): Promise<{
        id: string;
        shopId: string;
        actorType: string;
        actorId: string | null;
        action: string;
        resourceType: string;
        resourceId: string | null;
        previousValue: unknown;
        newValue: unknown;
        metadata: unknown;
        ipAddress: string | null;
        userAgent: string | null;
        createdAt: Date;
    } | null> {
        return prisma.auditLog.findUnique({
            where: { id },
        });
    },
    async cleanup(retentionDays = 90): Promise<number> {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
        const result = await prisma.auditLog.deleteMany({
            where: {
                createdAt: { lt: cutoffDate },
            },
        });
        logger.info(`Cleaned up ${result.count} audit log entries older than ${retentionDays} days`);
        return result.count;
    },
};
export async function createAuditLog(entry: AuditLogEntry & {
    shopId: string;
}): Promise<void> {
    const { shopId, ...logEntry } = entry;
    return auditLog.record(shopId, logEntry);
}
