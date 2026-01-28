import type { PixelEventPayload } from "~/lib/pixel-events/types";
import { logger } from "~/utils/logger.server";

export interface PixelEventSendResult {
  success: boolean;
  ok: boolean;
  platform: string;
  error?: string;
  errorCode?: string;
  requestPayload?: unknown;
  httpStatus?: number;
  responseBody?: string;
  latencyMs?: number;
}

export async function sendPixelEventToPlatform(
  shopId: string,
  platform: string,
  payload: PixelEventPayload,
  eventId: string,
  configId?: string,
  platformId?: string,
  _environment: "test" | "live" = "live"
): Promise<PixelEventSendResult> {
  logger.info("Server-side conversions disabled in v1, skipping event send", {
    shopId,
    platform,
    eventName: payload.eventName,
  });
  return {
    success: false,
    ok: false,
    platform,
    error: "Server-side conversions disabled in v1",
    errorCode: "FEATURE_DISABLED",
  };
}
