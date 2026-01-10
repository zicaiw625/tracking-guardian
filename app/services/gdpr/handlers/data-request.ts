import prisma from "../../../db.server";
import { logger } from "../../../utils/logger.server";
import type {
  DataRequestPayload,
  DataRequestResult,
  ExportedConversionLog,
  ExportedSurveyResponse,
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

async function fetchConversionLogsBatch(
  shopId: string,
  orderIds: string[]
): Promise<Array<{
  id: string;
  orderId: string;
  orderNumber: string | null;
  orderValue: unknown;
  currency: string;
  platform: string;
  eventType: string;
  status: string;
  clientSideSent: boolean;
  serverSideSent: boolean;
  createdAt: Date;
  sentAt: Date | null;
}>> {
  return prisma.conversionLog.findMany({
    where: {
      shopId,
      orderId: { in: orderIds },
    },
    select: {
      id: true,
      orderId: true,
      orderNumber: true,
      orderValue: true,
      currency: true,
      platform: true,
      eventType: true,
      status: true,
      clientSideSent: true,
      serverSideSent: true,
      createdAt: true,
      sentAt: true,
    },
    take: MAX_RECORDS_PER_TABLE,
  });
}

async function fetchSurveyResponsesBatch(
  shopId: string,
  orderIds: string[]
): Promise<Array<{
  id: string;
  orderId: string;
  orderNumber: string | null;
  rating: number | null;
  source: string | null;
  feedback: string | null;
  createdAt: Date;
}>> {
  return prisma.surveyResponse.findMany({
    where: {
      shopId,
      orderId: { in: orderIds },
    },
    select: {
      id: true,
      orderId: true,
      orderNumber: true,
      rating: true,
      source: true,
      feedback: true,
      createdAt: true,
    },
    take: MAX_RECORDS_PER_TABLE,
  });
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
  return prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      orderId: { in: orderIds },
    },
    select: {
      id: true,
      orderId: true,
      eventType: true,
      eventId: true,
      consentState: true,
      isTrusted: true,
      pixelTimestamp: true,
      createdAt: true,
    },
    take: MAX_RECORDS_PER_TABLE,
  });
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
  const orderBatches = batchArray(orderIdStrings, BATCH_SIZE);
  logger.debug(`[GDPR] Processing ${orderBatches.length} batches of orders`, {
    totalOrders: orderIdStrings.length,
    batchSize: BATCH_SIZE,
  });
  const allConversionLogs: Awaited<ReturnType<typeof fetchConversionLogsBatch>> = [];
  const allSurveyResponses: Awaited<ReturnType<typeof fetchSurveyResponsesBatch>> = [];
  const allPixelReceipts: Awaited<ReturnType<typeof fetchPixelReceiptsBatch>> = [];
  for (const batch of orderBatches) {
    const [conversionLogs, surveyResponses, pixelReceipts] = await Promise.all([
      fetchConversionLogsBatch(shop.id, batch),
      fetchSurveyResponsesBatch(shop.id, batch),
      fetchPixelReceiptsBatch(shop.id, batch),
    ]);
    allConversionLogs.push(...conversionLogs);
    allSurveyResponses.push(...surveyResponses);
    allPixelReceipts.push(...pixelReceipts);
    if (
      allConversionLogs.length >= MAX_RECORDS_PER_TABLE ||
      allSurveyResponses.length >= MAX_RECORDS_PER_TABLE ||
      allPixelReceipts.length >= MAX_RECORDS_PER_TABLE
    ) {
      logger.warn(`[GDPR] Reached max records limit for data export`, {
        shopDomain,
        conversionLogs: allConversionLogs.length,
        surveyResponses: allSurveyResponses.length,
        pixelReceipts: allPixelReceipts.length,
        maxLimit: MAX_RECORDS_PER_TABLE,
      });
      break;
    }
  }
  const conversionLogs = allConversionLogs.slice(0, MAX_RECORDS_PER_TABLE);
  const surveyResponses = allSurveyResponses.slice(0, MAX_RECORDS_PER_TABLE);
  const pixelReceipts = allPixelReceipts.slice(0, MAX_RECORDS_PER_TABLE);
  const exportedConversionLogs: ExportedConversionLog[] = conversionLogs.map((log) => ({
    orderId: log.orderId,
    orderNumber: log.orderNumber,
    orderValue: Number(log.orderValue),
    currency: log.currency,
    platform: log.platform,
    eventType: log.eventType,
    status: log.status,
    clientSideSent: log.clientSideSent,
    serverSideSent: log.serverSideSent,
    createdAt: log.createdAt.toISOString(),
    sentAt: log.sentAt?.toISOString() ?? null,
  }));
  const exportedSurveyResponses: ExportedSurveyResponse[] = surveyResponses.map((survey) => ({
    orderId: survey.orderId,
    orderNumber: survey.orderNumber,
    rating: survey.rating,
    source: survey.source,
    feedback: survey.feedback,
    createdAt: survey.createdAt.toISOString(),
  }));
  const exportedPixelReceipts: ExportedPixelEventReceipt[] = pixelReceipts.map((receipt) => ({
    orderId: receipt.orderId,
    eventType: receipt.eventType,
    eventId: receipt.eventId,
    consentState: receipt.consentState as { marketing?: boolean; analytics?: boolean } | null,
    isTrusted: receipt.isTrusted,
    pixelTimestamp: receipt.pixelTimestamp?.toISOString() ?? null,
    createdAt: receipt.createdAt.toISOString(),
  }));
  const result: DataRequestResult = {
    dataRequestId,
    customerId,
    ordersIncluded: ordersRequested,
    dataLocated: {
      conversionLogs: {
        count: conversionLogs.length,
        recordIds: conversionLogs.map((log) => log.id),
      },
      surveyResponses: {
        count: surveyResponses.length,
        recordIds: surveyResponses.map((survey) => survey.id),
      },
      pixelEventReceipts: {
        count: pixelReceipts.length,
        recordIds: pixelReceipts.map((receipt) => receipt.id),
      },
    },
    exportedData: {
      conversionLogs: exportedConversionLogs,
      surveyResponses: exportedSurveyResponses,
      pixelEventReceipts: exportedPixelReceipts,
    },
    exportedAt: new Date().toISOString(),
    exportFormat: "json",
    exportVersion: "1.0",
  };
  logger.info(`[GDPR] Data request completed for ${shopDomain}`, {
    dataRequestId,
    conversionLogs: result.dataLocated.conversionLogs.count,
    surveyResponses: result.dataLocated.surveyResponses.count,
    pixelEventReceipts: result.dataLocated.pixelEventReceipts.count,
    exportFormat: result.exportFormat,
    exportVersion: result.exportVersion,
  });
  return result;
}
