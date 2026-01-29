import prisma from "../../../db.server";
import { logger } from "../../../utils/logger.server";
import type {
  DataRequestPayload,
  DataRequestResult,
  ExportedPixelEventReceipt,
} from "../types";
import { createEmptyDataRequestResult } from "../types";

const BATCH_SIZE = 100;

const MAX_RECORDS_PER_TABLE = 10000;

function batchArray<T>(array: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    batches.push(array.slice(i, i + size));
  }
  return batches;
}


async function fetchPixelReceiptsBatch(
  shopId: string,
  orderIds: string[]
): Promise<Array<{
  id: string;
  orderId: string;
  eventType: string;
  eventId: string | null;
  consentState: unknown;
  isTrusted: boolean;
  pixelTimestamp: Date;
  createdAt: Date;
}>> {
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      orderKey: { in: orderIds },
    },
    select: {
      id: true,
      orderKey: true,
      eventType: true,
      eventId: true,
      pixelTimestamp: true,
      createdAt: true,
    },
    take: MAX_RECORDS_PER_TABLE,
  });
  return receipts.map((receipt) => ({
    id: receipt.id,
    orderId: receipt.orderKey || "",
    eventType: receipt.eventType,
    eventId: receipt.eventId,
    consentState: null,
    isTrusted: false,
    pixelTimestamp: receipt.pixelTimestamp,
    createdAt: receipt.createdAt,
  }));
}

export async function processDataRequest(
  shopDomain: string,
  payload: DataRequestPayload
): Promise<DataRequestResult> {
  const customerId = payload.customer_id;
  const ordersRequested = payload.orders_requested || [];
  const dataRequestId = payload.data_request_id;
  logger.info(`[GDPR] Processing data request for ${shopDomain}`, {
    dataRequestId,
    customerId,
    ordersCount: ordersRequested.length,
  });
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  if (!shop) {
    logger.warn(`[GDPR] Shop not found for data request: ${shopDomain}`);
    return createEmptyDataRequestResult(dataRequestId, customerId);
  }
  const orderIdStrings = ordersRequested.map((id) => String(id));
  const allOrderIdPatterns = orderIdStrings;
  const orderBatches = batchArray(allOrderIdPatterns, BATCH_SIZE);
  logger.debug(`[GDPR] Processing ${orderBatches.length} batches of orders`, {
    totalOrders: orderIdStrings.length,
    batchSize: BATCH_SIZE,
  });
  const allPixelReceipts: Awaited<ReturnType<typeof fetchPixelReceiptsBatch>> = [];
  for (const batch of orderBatches) {
    const [pixelReceipts] = await Promise.all([
      fetchPixelReceiptsBatch(shop.id, batch),
    ]);
    allPixelReceipts.push(...pixelReceipts);
    if (
      allPixelReceipts.length >= MAX_RECORDS_PER_TABLE
    ) {
      logger.warn(`[GDPR] Reached max records limit for data export`, {
        shopDomain,
        pixelReceipts: allPixelReceipts.length,
        maxLimit: MAX_RECORDS_PER_TABLE,
      });
      break;
    }
  }
  const pixelReceipts = allPixelReceipts.slice(0, MAX_RECORDS_PER_TABLE);
  const exportedPixelReceipts: ExportedPixelEventReceipt[] = pixelReceipts.map((receipt) => ({
    orderId: receipt.orderId,
    eventType: receipt.eventType,
    eventId: receipt.eventId || null,
    consentState: null,
    isTrusted: false,
    pixelTimestamp: receipt.pixelTimestamp ? receipt.pixelTimestamp.toISOString() : null,
    createdAt: receipt.createdAt.toISOString(),
  }));
  const result: DataRequestResult = {
    dataRequestId,
    customerId,
    ordersIncluded: ordersRequested,
    dataLocated: {
      conversionLogs: {
        count: 0,
        recordIds: [],
      },
      pixelEventReceipts: {
        count: pixelReceipts.length,
        recordIds: pixelReceipts.map((receipt) => receipt.id),
      },
    },
    exportedData: {
      conversionLogs: [],
      pixelEventReceipts: exportedPixelReceipts,
    },
    exportedAt: new Date().toISOString(),
    exportFormat: "json",
    exportVersion: "1.0",
  };
  logger.info(`[GDPR] Data request completed for ${shopDomain}`, {
    dataRequestId,
    conversionLogs: result.dataLocated.conversionLogs.count,
    pixelEventReceipts: result.dataLocated.pixelEventReceipts.count,
    exportFormat: result.exportFormat,
    exportVersion: result.exportVersion,
  });
  return result;
}
