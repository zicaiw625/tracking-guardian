/**
 * GDPR Data Request Handler
 *
 * Handles data request processing for GDPR compliance.
 * Exports customer data without deletion.
 */

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

// =============================================================================
// Data Request Processing
// =============================================================================

/**
 * Process a GDPR data request.
 * Collects and exports all data associated with the specified orders.
 *
 * @param shopDomain - The shop domain making the request
 * @param payload - Data request payload with customer/order info
 * @returns Exported data result
 */
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

  // Find the shop
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    logger.warn(`[GDPR] Shop not found for data request: ${shopDomain}`);
    return createEmptyDataRequestResult(dataRequestId, customerId);
  }

  // Convert order IDs to strings
  const orderIdStrings = ordersRequested.map((id) => String(id));

  // Fetch all related data
  const [conversionLogs, surveyResponses, pixelReceipts] = await Promise.all([
    prisma.conversionLog.findMany({
      where: {
        shopId: shop.id,
        orderId: { in: orderIdStrings },
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
    }),

    prisma.surveyResponse.findMany({
      where: {
        shopId: shop.id,
        orderId: { in: orderIdStrings },
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
    }),

    prisma.pixelEventReceipt.findMany({
      where: {
        shopId: shop.id,
        orderId: { in: orderIdStrings },
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
    }),
  ]);

  // Transform to export format
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

  // Build result
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

