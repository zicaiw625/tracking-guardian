import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { sanitizeFilename } from "../../utils/responses";
import { jsonApi, withSecurityHeaders } from "../../utils/security-headers";

type ExportType = "conversions" | "events";
type ExportFormat = "json" | "csv";

function isExportType(value: string | null): value is ExportType {
  return value === "conversions" || value === "events";
}

function isExportFormat(value: string | null): value is ExportFormat {
  return value === "json" || value === "csv";
}

function toCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "\"\"";
  }
  if (typeof value === "object") {
    return JSON.stringify(JSON.stringify(value));
  }
  return JSON.stringify(String(value));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const url = new URL(request.url);
    const typeParam = url.searchParams.get("type");
    const formatParam = url.searchParams.get("format");

    if (!isExportType(typeParam)) {
      return jsonApi({ error: "Invalid type" }, { status: 400 });
    }
    if (!isExportFormat(formatParam)) {
      return jsonApi({ error: "Invalid format" }, { status: 400 });
    }

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });
    if (!shop) {
      return jsonApi({ error: "Shop not found" }, { status: 404 });
    }

    if (typeParam === "conversions") {
      const rows = await prisma.pixelEventReceipt.findMany({
        where: { shopId: shop.id, eventType: "purchase" },
        orderBy: { createdAt: "desc" },
        take: 50000,
        select: {
          createdAt: true,
          pixelTimestamp: true,
          platform: true,
          environment: true,
          eventType: true,
          eventId: true,
          orderKey: true,
          altOrderKey: true,
          totalValue: true,
          currency: true,
          trustLevel: true,
          hmacMatched: true,
        },
      });

      if (formatParam === "json") {
        return jsonApi({ type: typeParam, count: rows.length, rows });
      }

      const header = [
        "createdAt",
        "pixelTimestamp",
        "platform",
        "environment",
        "eventType",
        "eventId",
        "orderKey",
        "altOrderKey",
        "totalValue",
        "currency",
        "trustLevel",
        "hmacMatched",
      ] as const;

      const csvRows = rows.map((row) =>
        [
          row.createdAt.toISOString(),
          row.pixelTimestamp.toISOString(),
          row.platform,
          row.environment,
          row.eventType,
          row.eventId,
          row.orderKey ?? "",
          row.altOrderKey ?? "",
          row.totalValue?.toString() ?? "",
          row.currency ?? "",
          row.trustLevel,
          row.hmacMatched,
        ]
          .map((v) => toCsvCell(v))
          .join(",")
      );

      const csv = [header.join(","), ...csvRows].join("\n");
      const filename = `conversions_export_${new Date().toISOString().slice(0, 10)}.csv`;
      return new Response("\uFEFF" + csv, {
        status: 200,
        headers: withSecurityHeaders({
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${sanitizeFilename(filename)}"`,
        }),
      });
    }

    const rows = await prisma.eventLog.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      take: 50000,
      select: {
        createdAt: true,
        occurredAt: true,
        source: true,
        eventName: true,
        eventId: true,
        normalizedEventJson: true,
      },
    });

    if (formatParam === "json") {
      return jsonApi({ type: typeParam, count: rows.length, rows });
    }

    const header = [
      "createdAt",
      "occurredAt",
      "source",
      "eventName",
      "eventId",
      "normalizedEventJson",
    ] as const;

    const csvRows = rows.map((row) =>
      [
        row.createdAt.toISOString(),
        row.occurredAt.toISOString(),
        row.source,
        row.eventName,
        row.eventId,
        JSON.stringify(row.normalizedEventJson),
      ]
        .map((v) => toCsvCell(v))
        .join(",")
    );

    const csv = [header.join(","), ...csvRows].join("\n");
    const filename = `events_export_${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response("\uFEFF" + csv, {
      status: 200,
      headers: withSecurityHeaders({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${sanitizeFilename(filename)}"`,
      }),
    });
  } catch (error) {
    logger.error("Failed to export data", { error });
    return jsonApi(
      { error: error instanceof Error ? error.message : "Failed to export data" },
      { status: 500 }
    );
  }
};
