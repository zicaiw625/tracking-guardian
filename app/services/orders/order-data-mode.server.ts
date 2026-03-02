import prisma from "~/db.server";

export type OrderDataMode = "none" | "manual_import" | "pcd_webhook";

interface ShopSettingsShape {
  orderDataMode?: unknown;
  [key: string]: unknown;
}

export interface OrderDataAvailability {
  mode: OrderDataMode;
  summaryCountLastNDays: number;
  enabled: boolean;
}

export class OrderDataUnavailableError extends Error {
  code: string;
  mode: OrderDataMode;

  constructor(code: string, mode: OrderDataMode, message: string) {
    super(message);
    this.code = code;
    this.mode = mode;
  }
}

function normalizeOrderDataMode(value: unknown): OrderDataMode {
  if (value === "manual_import" || value === "pcd_webhook") {
    return value;
  }
  return "none";
}

function parseSettings(settings: unknown): ShopSettingsShape {
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    return settings as ShopSettingsShape;
  }
  return {};
}

export function getOrderDataModeFromSettings(settings: unknown): OrderDataMode {
  const parsed = parseSettings(settings);
  return normalizeOrderDataMode(parsed.orderDataMode);
}

export async function getOrderDataAvailability(
  shopId: string,
  days: number = 7
): Promise<OrderDataAvailability> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { settings: true },
  });
  const mode = getOrderDataModeFromSettings(shop?.settings);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const summaryCountLastNDays = await prisma.orderSummary.count({
    where: {
      shopId,
      createdAt: { gte: since },
    },
  });
  return {
    mode,
    summaryCountLastNDays,
    enabled: mode !== "none" && summaryCountLastNDays > 0,
  };
}

export async function hasOrderData(shopId: string, days: number = 7): Promise<boolean> {
  const availability = await getOrderDataAvailability(shopId, days);
  return availability.enabled;
}

export async function setOrderDataMode(shopId: string, mode: OrderDataMode): Promise<void> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { settings: true },
  });
  const current = parseSettings(shop?.settings);
  const next = JSON.parse(JSON.stringify({ ...current, orderDataMode: mode }));
  await prisma.shop.update({
    where: { id: shopId },
    data: { settings: next },
  });
}

export function assertOrderDataAvailability(availability: OrderDataAvailability): void {
  if (availability.enabled) {
    return;
  }
  const baseCode = "PCD_ORDER_UNAVAILABLE_DATA_SOURCE_NOT_READY";
  if (availability.mode === "none") {
    throw new OrderDataUnavailableError(
      `${baseCode}_MODE_NONE`,
      availability.mode,
      "Order reconciliation is unavailable because order data source is not enabled."
    );
  }
  throw new OrderDataUnavailableError(
    `${baseCode}_EMPTY_SUMMARY`,
    availability.mode,
    "Order reconciliation is unavailable because no order summary data is available yet."
  );
}

export function isOrderDataUnavailableError(error: unknown): error is OrderDataUnavailableError {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    String((error as { code: string }).code).startsWith("PCD_ORDER_UNAVAILABLE_")
  );
}
