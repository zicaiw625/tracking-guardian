import { randomUUID } from "crypto";
import prisma from "~/db.server";
import { setOrderDataMode } from "./order-data-mode.server";

interface ParsedOrderRow {
  orderId: string;
  totalPrice: number;
  currency: string;
  createdAt: Date;
}

export interface ManualImportResult {
  imported: number;
  skipped: number;
  total: number;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        current += "\"";
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  result.push(current.trim());
  return result;
}

function parseHeaderIndex(headerRow: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (let i = 0; i < headerRow.length; i++) {
    map[headerRow[i].toLowerCase()] = i;
  }
  return map;
}

function readCell(cells: string[], indexMap: Record<string, number>, key: string): string {
  const idx = indexMap[key];
  if (idx === undefined) {
    return "";
  }
  return (cells[idx] ?? "").trim();
}

function parseRow(cells: string[], indexMap: Record<string, number>): ParsedOrderRow | null {
  const orderId = readCell(cells, indexMap, "orderid");
  const totalRaw = readCell(cells, indexMap, "total");
  const currency = readCell(cells, indexMap, "currency").toUpperCase() || "USD";
  const createdAtRaw = readCell(cells, indexMap, "createdat");
  if (!orderId || !totalRaw || !createdAtRaw) {
    return null;
  }
  const totalPrice = Number(totalRaw);
  if (!Number.isFinite(totalPrice)) {
    return null;
  }
  const createdAt = new Date(createdAtRaw);
  if (Number.isNaN(createdAt.getTime())) {
    return null;
  }
  return {
    orderId,
    totalPrice,
    currency,
    createdAt,
  };
}

export async function importOrderSummariesFromCsv(
  shopId: string,
  csvText: string
): Promise<ManualImportResult> {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) {
    return { imported: 0, skipped: 0, total: 0 };
  }

  const header = parseCsvLine(lines[0]);
  const headerMap = parseHeaderIndex(header);
  const required = ["orderid", "total", "currency", "createdat"];
  const missing = required.filter((k) => headerMap[k] === undefined);
  if (missing.length > 0) {
    throw new Error(`Missing required columns: ${missing.join(", ")}`);
  }

  const seen = new Set<string>();
  const rows: ParsedOrderRow[] = [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const parsed = parseRow(parseCsvLine(lines[i]), headerMap);
    if (!parsed) {
      skipped++;
      continue;
    }
    if (seen.has(parsed.orderId)) {
      skipped++;
      continue;
    }
    seen.add(parsed.orderId);
    rows.push(parsed);
  }

  if (rows.length === 0) {
    return { imported: 0, skipped, total: lines.length - 1 };
  }

  await prisma.$transaction(
    rows.map((row) =>
      prisma.orderSummary.upsert({
        where: {
          shopId_orderId: {
            shopId,
            orderId: row.orderId,
          },
        },
        update: {
          totalPrice: row.totalPrice,
          currency: row.currency,
          createdAt: row.createdAt,
        },
        create: {
          id: randomUUID(),
          shopId,
          orderId: row.orderId,
          totalPrice: row.totalPrice,
          currency: row.currency,
          createdAt: row.createdAt,
        },
      })
    )
  );

  await setOrderDataMode(shopId, "manual_import");

  return {
    imported: rows.length,
    skipped,
    total: lines.length - 1,
  };
}
