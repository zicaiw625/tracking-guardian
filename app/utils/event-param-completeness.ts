import { STANDARD_EVENT_MAPPINGS, type EventMapping } from "../services/event-mapping";

export interface ParamCompletenessResult {
  isComplete: boolean;
  completenessRate: number;
  requiredParams: string[];
  missingParams: string[];
  presentParams: string[];
}

export function checkParamCompleteness(
  eventType: string,
  platform: string,
  params?: Record<string, unknown>
): ParamCompletenessResult {
  const platformMapping = STANDARD_EVENT_MAPPINGS[platform];
  if (!platformMapping) {
    return {
      isComplete: true,
      completenessRate: 100,
      requiredParams: [],
      missingParams: [],
      presentParams: params ? Object.keys(params) : [],
    };
  }
  let mapping: EventMapping | undefined;
  mapping = platformMapping.mappings[eventType];
  if (!mapping) {
    for (const [shopifyEvent, m] of Object.entries(platformMapping.mappings)) {
      if (m.platformEvent === eventType) {
        mapping = m;
        break;
      }
    }
  }
  const isParamsObject = params !== null &&
                        params !== undefined &&
                        typeof params === "object" &&
                        !Array.isArray(params);
  const safeParams: Record<string, unknown> = isParamsObject ? params : {};
  if (!mapping) {
    const requiredParams = ["value", "currency"];
    const presentParams = Object.keys(safeParams);
    const missingParams = requiredParams.filter((p) => {
      const paramValue = safeParams[p];
      return paramValue === undefined || paramValue === null ||
             (typeof paramValue === "string" && paramValue.trim() === "");
    });
    return {
      isComplete: missingParams.length === 0,
      completenessRate: requiredParams.length > 0
        ? ((requiredParams.length - missingParams.length) / requiredParams.length) * 100
        : 100,
      requiredParams,
      missingParams,
      presentParams,
    };
  }
  const requiredParams = Array.isArray(mapping.requiredParams) ? mapping.requiredParams : [];
  const presentParams = Object.keys(safeParams);
  const missingParams = requiredParams.filter((param) => {
    if (typeof param !== "string") {
      return true;
    }
    const paramValue = safeParams[param];
    if (paramValue === undefined || paramValue === null) {
      return true;
    }
    if (typeof paramValue === "string" && paramValue.trim() === "") {
      return true;
    }
    if (Array.isArray(paramValue) && paramValue.length === 0) {
      return true;
    }
    return false;
  });
  const completenessRate =
    requiredParams.length > 0
      ? ((requiredParams.length - missingParams.length) / requiredParams.length) * 100
      : 100;
  return {
    isComplete: missingParams.length === 0,
    completenessRate: Math.round(completenessRate),
    requiredParams,
    missingParams,
    presentParams,
  };
}

export interface EventStats {
  totalCount: number;
  byEventType: Record<string, number>;
  byPlatform: Record<string, number>;
  byPlatformAndEventType: Record<string, Record<string, number>>;
  paramCompleteness: {
    overall: number;
    byEventType: Record<string, number>;
    byPlatform: Record<string, number>;
    completeCount: number;
    incompleteCount: number;
  };
}

export function calculateEventStats(
  events: Array<{
    eventType: string;
    platform: string;
    params?: Record<string, unknown>;
  }>
): EventStats {
  const stats: EventStats = {
    totalCount: events.length,
    byEventType: {},
    byPlatform: {},
    byPlatformAndEventType: {},
    paramCompleteness: {
      overall: 0,
      byEventType: {},
      byPlatform: {},
      completeCount: 0,
      incompleteCount: 0,
    },
  };
  let totalCompleteness = 0;
  const completenessByEventType: Record<string, number[]> = {};
  const completenessByPlatform: Record<string, number[]> = {};
  for (const event of events) {
    stats.byEventType[event.eventType] = (stats.byEventType[event.eventType] || 0) + 1;
    stats.byPlatform[event.platform] = (stats.byPlatform[event.platform] || 0) + 1;
    if (!stats.byPlatformAndEventType[event.platform]) {
      stats.byPlatformAndEventType[event.platform] = {};
    }
    stats.byPlatformAndEventType[event.platform][event.eventType] =
      (stats.byPlatformAndEventType[event.platform][event.eventType] || 0) + 1;
    const completeness = checkParamCompleteness(event.eventType, event.platform, event.params);
    totalCompleteness += completeness.completenessRate;
    if (!completenessByEventType[event.eventType]) {
      completenessByEventType[event.eventType] = [];
    }
    completenessByEventType[event.eventType].push(completeness.completenessRate);
    if (!completenessByPlatform[event.platform]) {
      completenessByPlatform[event.platform] = [];
    }
    completenessByPlatform[event.platform].push(completeness.completenessRate);
    if (completeness.isComplete) {
      stats.paramCompleteness.completeCount++;
    } else {
      stats.paramCompleteness.incompleteCount++;
    }
  }
  stats.paramCompleteness.overall =
    events.length > 0 ? Math.round(totalCompleteness / events.length) : 100;
  for (const [eventType, rates] of Object.entries(completenessByEventType)) {
    stats.paramCompleteness.byEventType[eventType] = Math.round(
      rates.reduce((sum, rate) => sum + rate, 0) / rates.length
    );
  }
  for (const [platform, rates] of Object.entries(completenessByPlatform)) {
    stats.paramCompleteness.byPlatform[platform] = Math.round(
      rates.reduce((sum, rate) => sum + rate, 0) / rates.length
    );
  }
  return stats;
}
