import { randomUUID } from "crypto";
import prisma from "~/db.server";

export interface ConnectorProviderDefinition {
  key: "GA4" | "META" | "TIKTOK";
  name: string;
  category: "measurement_protocol" | "conversion_api";
}

export const CONNECTOR_PROVIDERS: ConnectorProviderDefinition[] = [
  { key: "GA4", name: "GA4 Measurement Protocol", category: "measurement_protocol" },
  { key: "META", name: "Meta Conversions API", category: "conversion_api" },
  { key: "TIKTOK", name: "TikTok Events API", category: "conversion_api" },
];

export async function recordDispatchAudit(input: {
  shopId: string;
  destination: "GA4" | "META" | "TIKTOK";
  action: "dispatch_sent" | "dispatch_failed";
  eventId: string;
  statusCode?: number | null;
  error?: string | null;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      id: randomUUID(),
      shopId: input.shopId,
      actorType: "system",
      actorId: "dispatch_worker",
      action: input.action,
      resourceType: "server_side_connector",
      resourceId: input.destination,
      metadata: {
        destination: input.destination,
        eventId: input.eventId,
        statusCode: input.statusCode ?? null,
        error: input.error ?? null,
      },
    },
  });
}
