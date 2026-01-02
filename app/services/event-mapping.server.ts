
import { logger } from "../utils/logger.server";
import type { PixelConfig } from "@prisma/client";


export type { EventMapping, PlatformEventMapping } from "./event-mapping";
export { STANDARD_EVENT_MAPPINGS, getPlatformEventMapping, getEventMapping, mergeEventMappings, validateEventMapping, getRecommendedMappings } from "./event-mapping";

export function getCustomEventMappings(pixelConfig: PixelConfig): Record<string, string> {
  if (!pixelConfig.eventMappings) return {};

  try {
    if (typeof pixelConfig.eventMappings === "object") {
      return pixelConfig.eventMappings as Record<string, string>;
    }
  } catch (error) {
    logger.warn("Failed to parse eventMappings from PixelConfig", {
      pixelConfigId: pixelConfig.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {};
}

